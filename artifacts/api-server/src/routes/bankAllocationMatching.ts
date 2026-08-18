/**
 * Bank Allocation & Auto-Matching Foundation — Sprint 4 Phase 2
 *
 * Flow: bank_mutations -> scoring -> bank_allocation_matches (CANDIDATE, maybe
 * is_auto_suggested) -> finance selects (MATCHED) -> finance confirms
 * (CONFIRMED, creates a DRAFT allocation_headers/lines row) -> finance runs the
 * normal Allocation Center submit/approve/post flow (routes/allocation.ts,
 * unchanged) -> Posted tab here reflects allocation_headers.status = 'posted'.
 *
 * RULE (Sprint 4 spec): AI hanya merekomendasikan, TIDAK PERNAH posting
 * otomatis. This module NEVER calls AdvanceJournalService and NEVER inserts
 * accounting_entries — it only ever creates DRAFT allocation_headers/lines,
 * exactly like a human would via POST /api/allocation.
 *
 * Security patches applied:
 *  P0  - Confirm/split/merge status check moved inside db.transaction() with
 *        SELECT FOR UPDATE row lock to prevent concurrent double-confirm race.
 *        DB-level backstop: partial unique index
 *        idx_bam_one_confirmed_per_mutation (bank_mutation_id WHERE status='CONFIRMED')
 *        added in bankAllocationMigration.ts.
 *  P0b - sql.raw() removed from merge handler; other_mutation_ids validated as
 *        positive integers and used via drizzle parameterized sql`` template.
 *  P0c - All mutating endpoints (select/confirm/split/merge/reject) enforce
 *        company_id ownership: match.company_id must equal req.user.companyId
 *        when the requester's companyId is set (super-admins without a bound
 *        company pass through).
 *  P1b - Split and merge per-line amount must be > 0 and finite.
 *  P1  - Tab "matched" now also surfaces CONFIRMED + non-posted allocations so
 *        finance can track confirmed-but-not-yet-posted work.
 *  P2  - fetchAllocationCandidates now receives company_id so the scoring engine
 *        filters candidates at the SQL level (see bankAllocationScoring.ts).
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import {
  fetchAllocationCandidates,
  scoreAllocationCandidate,
  classifyAllocationMatch,
  getActiveWeights,
  type AllocationMutationInput,
} from "../lib/reconciliation/bankAllocationScoring.js";
import { normalizeCompanyId } from "../lib/services/portalCompanyScopeUtils.js";

const router = Router();

router.use(async (req: Request, res: Response, next: NextFunction) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── Helpers ─────────────────────────────────────────────────────────────────────

async function writeMatchLog(
  mutationId: number,
  matchId: number | null,
  action: string,
  actor: string | null,
  actorId: number | null,
  fromStatus: string | null,
  toStatus: string | null,
  notes?: string,
  snapshot?: unknown,
  client: { execute: typeof db["execute"] } = db,
) {
  await client.execute(sql`
    INSERT INTO bank_allocation_match_logs
      (bank_mutation_id, match_id, action, actor, actor_id, from_status, to_status, notes, snapshot)
    VALUES
      (${mutationId}, ${matchId}, ${action}, ${actor}, ${actorId}, ${fromStatus}, ${toStatus},
       ${notes ?? null}, ${snapshot ? JSON.stringify(snapshot) : null})
  `).catch(() => {});
}

async function generateAllocationNo(companyId: number): Promise<string> {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rows = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) AS count FROM allocation_headers
    WHERE company_id = ${companyId}
      AND TO_CHAR(created_at, 'YYYYMM') = ${ym}
  `).then((r) => r.rows);
  const seq = (parseInt(rows[0]?.count ?? "0") + 1).toString().padStart(4, "0");
  return `BAM-${ym}-${seq}`;
}

/**
 * P0c — company ownership guard.
 * Returns true when the requester is allowed to act on this match.
 * Fails-closed: denies if requester has a companyId and it doesn't match the match row.
 */
function ownershipAllowed(m: any, userCompanyId: number | null): boolean {
  const matchCompanyId = normalizeCompanyId(m.company_id);
  if (matchCompanyId == null) return false;
  if (!userCompanyId) return true;           // super-admin: no company bound
  return matchCompanyId === normalizeCompanyId(userCompanyId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /run  — score one mutation (or all unmatched) against candidates
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/run", async (req, res) => {
  try {
    const user = (req as any).user;
    const { bank_mutation_id } = req.body as { bank_mutation_id?: number };

    // P0c fix for /run: restrict to the requester's company when a company is bound.
    // Super-admins (no companyId) can still process any unmatched mutation.
    const userCompanyId = (req as any).user?.companyId ?? null;

    const mutRows = await db.execute<any>(sql`
      SELECT id, amount, transaction_date::text AS transaction_date, mutation_key,
             provider_order_id, normalized_description, company_id
      FROM bank_mutations
      WHERE status = 'unmatched'
        ${bank_mutation_id ? sql`AND id = ${bank_mutation_id}` : sql``}
        ${userCompanyId ? sql`AND company_id = ${userCompanyId}` : sql``}
      ORDER BY transaction_date DESC
      LIMIT 200
    `).then((r) => r.rows);

    let scoredCount = 0;
    let autoSuggestCount = 0;
    let exceptionCount = 0;

    for (const m of mutRows) {
      const mutation: AllocationMutationInput = {
        id: Number(m.id),
        amount: Number(m.amount),
        transaction_date: m.transaction_date,
        mutation_key: m.mutation_key,
        provider_order_id: m.provider_order_id,
        normalized_description: m.normalized_description,
        company_id: m.company_id != null ? Number(m.company_id) : null,
      };

      const weights = await getActiveWeights(mutation.company_id ?? null);
      // P2: pass company_id so fetchAllocationCandidates filters by company at SQL level
      const candidates = await fetchAllocationCandidates({
        amount: mutation.amount,
        transaction_date: mutation.transaction_date,
        company_id: mutation.company_id,
      });

      if (!candidates.length) {
        await db.execute(sql`
          INSERT INTO bank_allocation_exceptions (bank_mutation_id, company_id, exception_type, details)
          VALUES (${mutation.id}, ${mutation.company_id}, 'NO_CANDIDATE', ${JSON.stringify({ amount: mutation.amount })})
        `).catch(() => {});
        exceptionCount++;
        continue;
      }

      const scored = candidates
        .map((c) => scoreAllocationCandidate(mutation, c, weights))
        .sort((a, b) => b.score - a.score);

      for (const s of scored) {
        const classification = classifyAllocationMatch(s.score, weights);
        if (classification === "unmatched") continue; // below manual review floor, don't clutter tabs

        const isAutoSuggest = classification === "auto_suggest";
        await db.execute(sql`
          INSERT INTO bank_allocation_matches
            (bank_mutation_id, company_id, candidate_type, candidate_id, candidate_ref,
             candidate_name, candidate_amount, match_score, score_breakdown, status,
             is_auto_suggested, matched_amount)
          VALUES
            (${mutation.id}, ${mutation.company_id}, ${s.candidate.type}, ${s.candidate.id},
             ${s.candidate.ref}, ${s.candidate.name}, ${s.candidate.amount}, ${s.score},
             ${JSON.stringify(s.breakdown)}, 'CANDIDATE', ${isAutoSuggest},
             ${Math.min(mutation.amount, s.candidate.amount)})
          ON CONFLICT (bank_mutation_id, candidate_type, candidate_id)
          DO UPDATE SET match_score = EXCLUDED.match_score,
                        score_breakdown = EXCLUDED.score_breakdown,
                        is_auto_suggested = EXCLUDED.is_auto_suggested,
                        updated_at = NOW()
        `).catch(() => {});

        if (isAutoSuggest) autoSuggestCount++;
      }

      // Overpayment / underpayment detection against the best candidate
      const best = scored[0];
      if (best) {
        if (mutation.amount > best.candidate.amount + 0.01) {
          await db.execute(sql`
            INSERT INTO bank_allocation_exceptions (bank_mutation_id, company_id, exception_type, details)
            VALUES (${mutation.id}, ${mutation.company_id}, 'OVERPAYMENT',
              ${JSON.stringify({ mutation_amount: mutation.amount, candidate_amount: best.candidate.amount, suggestion: "Customer Deposit" })})
          `).catch(() => {});
        } else if (mutation.amount < best.candidate.amount - 0.01) {
          await db.execute(sql`
            INSERT INTO bank_allocation_exceptions (bank_mutation_id, company_id, exception_type, details)
            VALUES (${mutation.id}, ${mutation.company_id}, 'UNDERPAYMENT',
              ${JSON.stringify({ mutation_amount: mutation.amount, candidate_amount: best.candidate.amount, note: "Outstanding tetap" })})
          `).catch(() => {});
        }
      }

      await db.execute(sql`
        UPDATE bank_mutations SET status = 'matched', updated_at = NOW() WHERE id = ${mutation.id}
      `).catch(() => {});

      await writeMatchLog(mutation.id, null, "MATCH_GENERATED", user?.email ?? null, user?.id ?? null, "UNMATCHED", "CANDIDATE", undefined, {
        candidate_count: scored.length,
        best_score: best?.score ?? null,
      });

      scoredCount++;
    }

    res.json({ ok: true, scored: scoredCount, auto_suggest: autoSuggestCount, exceptions: exceptionCount });
  } catch (err) {
    logger.error({ err }, "[bankAllocation] run matching error");
    res.status(500).json({ error: "Gagal menjalankan matching engine" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /tabs/:tab  — unmatched | suggested | matched | posted | exceptions
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/tabs/:tab", async (req, res) => {
  try {
    const { tab } = req.params;
    const userCompanyId = (req as any).user?.companyId ?? null;
    const companyFilter = userCompanyId ? sql`AND bm.company_id = ${userCompanyId}` : sql``;

    if (tab === "exceptions") {
      const rows = await db.execute<any>(sql`
        SELECT bae.*, bm.amount AS mutation_amount, bm.description AS mutation_description,
               bm.transaction_date::text AS transaction_date
        FROM bank_allocation_exceptions bae
        JOIN bank_mutations bm ON bm.id = bae.bank_mutation_id
        WHERE bae.status = 'open' ${userCompanyId ? sql`AND bae.company_id = ${userCompanyId}` : sql``}
        ORDER BY bae.created_at DESC
        LIMIT 200
      `).then((r) => r.rows);
      return res.json({ tab, rows });
    }

    if (tab === "unmatched") {
      const rows = await db.execute<any>(sql`
        SELECT bm.id AS bank_mutation_id, bm.amount, bm.description, bm.transaction_date::text AS transaction_date,
               bm.company_id, bm.status
        FROM bank_mutations bm
        WHERE bm.status = 'unmatched' ${companyFilter}
        ORDER BY bm.transaction_date DESC
        LIMIT 200
      `).then((r) => r.rows);
      return res.json({ tab, rows });
    }

    // suggested | matched | posted -> query bank_allocation_matches
    let statusFilter = sql``;
    if (tab === "suggested") {
      statusFilter = sql`AND bam.status = 'CANDIDATE' AND bam.is_auto_suggested = TRUE`;
    } else if (tab === "matched") {
      // P1 fix: "matched" tab shows:
      //   (a) CANDIDATE/MATCHED rows that finance has manually selected (not auto-suggested)
      //   (b) CONFIRMED rows whose allocation has not yet been posted — i.e. the finance
      //       team confirmed the match but hasn't run the Allocation Center post flow yet.
      // This prevents confirmed-but-unposted allocations from disappearing from the UI.
      statusFilter = sql`AND (
        (bam.status IN ('CANDIDATE', 'MATCHED') AND (bam.is_auto_suggested = FALSE OR bam.status = 'MATCHED'))
        OR (bam.status = 'CONFIRMED' AND (ah.status IS NULL OR ah.status NOT IN ('posted')))
      )`;
    } else if (tab === "posted") {
      statusFilter = sql`AND bam.status = 'CONFIRMED'`;
    } else {
      return res.status(400).json({ error: "Tab tidak dikenal" });
    }

    const rows = await db.execute<any>(sql`
      SELECT bam.*, bm.amount AS mutation_amount, bm.description AS mutation_description,
             bm.transaction_date::text AS transaction_date,
             ah.status AS allocation_status, ah.allocation_no, ah.journal_entry_id
      FROM bank_allocation_matches bam
      JOIN bank_mutations bm ON bm.id = bam.bank_mutation_id
      LEFT JOIN allocation_headers ah ON ah.id = bam.allocation_header_id
      WHERE 1=1 ${statusFilter}
        ${userCompanyId ? sql`AND bam.company_id = ${userCompanyId}` : sql``}
      ORDER BY bam.match_score DESC, bam.created_at DESC
      LIMIT 200
    `).then((r) => r.rows);

    let filteredRows = rows;
    if (tab === "posted") {
      filteredRows = rows.filter((r: any) => r.allocation_status === "posted");
    }
    // "matched" tab: no additional JS filter — the SQL WHERE clause already
    // handles inclusion/exclusion correctly (CONFIRMED+posted excluded by SQL).

    res.json({ tab, rows: filteredRows });
  } catch (err) {
    logger.error({ err }, "[bankAllocation] tabs error");
    res.status(500).json({ error: "Gagal mengambil data tab" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /mutation/:id  — detail: mutation | candidates | score breakdown
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/mutation/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userCompanyId = (req as any).user?.companyId ?? null;

    const mutRows = await db.execute<any>(sql`
      SELECT * FROM bank_mutations WHERE id = ${id}
    `).then((r) => r.rows);
    if (!mutRows.length) return res.status(404).json({ error: "Mutasi tidak ditemukan" });

    // P0c IDOR fix: company-bound admins may only read their own company's mutations.
    const mut = mutRows[0];
    if (userCompanyId && mut.company_id && Number(mut.company_id) !== userCompanyId) {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    const matchRows = await db.execute<any>(sql`
      SELECT * FROM bank_allocation_matches
      WHERE bank_mutation_id = ${id}
      ORDER BY match_score DESC
    `).then((r) => r.rows);

    const logRows = await db.execute<any>(sql`
      SELECT * FROM bank_allocation_match_logs
      WHERE bank_mutation_id = ${id}
      ORDER BY created_at ASC
    `).then((r) => r.rows);

    res.json({
      mutation: { ...mutRows[0], amount: parseFloat(mutRows[0].amount) },
      candidates: matchRows.map((m: any) => ({
        ...m,
        match_score: parseFloat(m.match_score),
        candidate_amount: m.candidate_amount != null ? parseFloat(m.candidate_amount) : null,
        matched_amount: m.matched_amount != null ? parseFloat(m.matched_amount) : null,
      })),
      logs: logRows,
    });
  } catch (err) {
    logger.error({ err }, "[bankAllocation] mutation detail error");
    res.status(500).json({ error: "Gagal mengambil detail mutasi" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /match/:matchId/select  — CANDIDATE -> MATCHED (finance picks this candidate)
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/match/:matchId/select", async (req, res) => {
  try {
    const matchId = parseInt(req.params.matchId);
    const user = (req as any).user;
    const userCompanyId = (req as any).user?.companyId ?? null;

    const rows = await db.execute<any>(sql`SELECT * FROM bank_allocation_matches WHERE id = ${matchId}`).then((r) => r.rows);
    if (!rows.length) return res.status(404).json({ error: "Match tidak ditemukan" });
    const m = rows[0];

    // P0c — ownership check
    if (!ownershipAllowed(m, userCompanyId)) {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    if (m.status !== "CANDIDATE") {
      return res.status(400).json({ error: "Hanya kandidat berstatus CANDIDATE yang dapat dipilih" });
    }

    await db.execute(sql`
      UPDATE bank_allocation_matches
      SET status = 'MATCHED', selected_by = ${user?.email ?? null}, selected_at = NOW(), updated_at = NOW()
      WHERE id = ${matchId}
    `);
    await writeMatchLog(m.bank_mutation_id, matchId, "SELECT", user?.email ?? null, user?.id ?? null, "CANDIDATE", "MATCHED");
    res.json({ ok: true, status: "MATCHED" });
  } catch (err) {
    logger.error({ err }, "[bankAllocation] select error");
    res.status(500).json({ error: "Gagal memilih kandidat" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /match/:matchId/confirm  — MATCHED -> CONFIRMED; creates DRAFT allocation
//
// P0 fix: status check is now INSIDE db.transaction() with SELECT FOR UPDATE.
// This serialises concurrent requests at the database level — the second request
// blocks at the SELECT FOR UPDATE until the first transaction commits, then sees
// status='CONFIRMED' and returns the idempotency error.
// A partial unique index (idx_bam_one_confirmed_per_mutation) in the migration
// provides the final DB-level backstop.
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/match/:matchId/confirm", async (req, res) => {
  const matchId = parseInt(req.params.matchId);
  const user = (req as any).user;
  const userCompanyId = (req as any).user?.companyId ?? null;
  const { coa_id, bank_account_id } = req.body as { coa_id?: number; bank_account_id?: number };

  let allocationNo: string | null = null;
  let savedMutationId: number | null = null;
  let savedFromStatus: string | null = null;

  try {
    const headerId = await db.transaction(async (tx) => {
      // P0: Lock the row for the duration of this transaction.
      // Concurrent confirms for the same matchId will queue here and the second
      // one will observe status='CONFIRMED' after the first commits.
      const rows = await tx.execute<any>(sql`
        SELECT * FROM bank_allocation_matches WHERE id = ${matchId} FOR UPDATE
      `).then((r) => r.rows);

      if (!rows.length) throw Object.assign(new Error("Match tidak ditemukan"), { httpStatus: 404 });
      const m = rows[0];
      savedMutationId = Number(m.bank_mutation_id);
      savedFromStatus = m.status;

      // P0c — ownership check
      if (!ownershipAllowed(m, userCompanyId)) {
        throw Object.assign(new Error("Akses ditolak"), { httpStatus: 403 });
      }

      if (!["MATCHED", "CANDIDATE"].includes(m.status)) {
        throw Object.assign(new Error("Match sudah diproses sebelumnya"), { httpStatus: 400 });
      }
      if (!m.company_id) {
        throw Object.assign(new Error("company_id mutasi tidak diketahui — tidak dapat membuat alokasi"), { httpStatus: 400 });
      }

      const mutRows = await tx.execute<any>(sql`
        SELECT id, amount, transaction_date::text AS transaction_date, bank_account_id
        FROM bank_mutations WHERE id = ${m.bank_mutation_id}
      `).then((r) => r.rows);
      if (!mutRows.length) throw Object.assign(new Error("Mutasi tidak ditemukan"), { httpStatus: 404 });
      const mut = mutRows[0];

      const receivedAmount = Number(mut.amount);
      const candidateAmount = Number(m.candidate_amount);
      const primaryAmount = Math.min(receivedAmount, candidateAmount);
      const overAmount = receivedAmount - candidateAmount;

      const allocationType = m.candidate_type === "invoice" ? "SALES_INVOICE" : "ADVANCE_PRINCIPAL";
      const lines: Array<{ allocation_type: string; reference_type: string; reference_id: number; amount: number; remarks: string }> = [
        {
          allocation_type: allocationType,
          reference_type: m.candidate_type,
          reference_id: m.candidate_id,
          amount: primaryAmount,
          remarks: `Auto-match score ${m.match_score} — ${m.candidate_ref ?? m.candidate_name ?? ""}`,
        },
      ];

      if (overAmount > 0.01) {
        lines.push({
          allocation_type: "CUSTOMER_DEPOSIT",
          reference_type: "customer_deposit",
          reference_id: 0,
          amount: overAmount,
          remarks: "Overpayment — suggested Customer Deposit",
        });
      }

      allocationNo = await generateAllocationNo(Number(m.company_id));
      const bankAccountId = bank_account_id ?? mut.bank_account_id ?? null;

      const headerRows = await tx.execute<{ id: number }>(sql`
        INSERT INTO allocation_headers
          (company_id, allocation_no, bank_transaction_id, bank_account_id,
           currency, exchange_rate, received_amount, allocated_amount, remaining_amount,
           status, reference_no, allocation_date, created_by, notes)
        VALUES
          (${m.company_id}, ${allocationNo}, ${mut.id}, ${bankAccountId},
           'IDR', 1, ${receivedAmount}, ${receivedAmount}, 0,
           'draft', ${m.candidate_ref ?? null}, ${mut.transaction_date}, ${user?.email ?? null},
           ${`Bank Allocation auto-match (score ${m.match_score})`})
        RETURNING id
      `).then((r) => r.rows);

      const hId = headerRows[0]?.id;
      if (!hId) throw new Error("Failed to create allocation header");

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await tx.execute(sql`
          INSERT INTO allocation_lines
            (allocation_header_id, allocation_type, reference_type, reference_id,
             coa_id, amount, remarks, sort_order, allocation_status)
          VALUES
            (${hId}, ${l.allocation_type}, ${l.reference_type}, ${l.reference_id},
             ${coa_id ?? null}, ${l.amount}, ${l.remarks}, ${i}, 'pending')
        `);
      }

      // This UPDATE also triggers the partial unique index constraint if another
      // concurrent transaction has already set status='CONFIRMED' for this mutation.
      await tx.execute(sql`
        UPDATE bank_allocation_matches
        SET status = 'CONFIRMED', allocation_header_id = ${hId},
            confirmed_by = ${user?.email ?? null}, confirmed_at = NOW(), updated_at = NOW()
        WHERE id = ${matchId}
      `);

      return hId;
    });

    await writeMatchLog(savedMutationId!, matchId, "CONFIRM", user?.email ?? null, user?.id ?? null, savedFromStatus, "CONFIRMED", undefined, { allocation_header_id: headerId });
    res.json({ ok: true, status: "CONFIRMED", allocation_header_id: headerId, allocation_no: allocationNo });
  } catch (err: any) {
    const status = err?.httpStatus ?? 500;
    if (status < 500) return res.status(status).json({ error: err.message });
    logger.error({ err }, "[bankAllocation] confirm error");
    res.status(500).json({ error: err?.message ?? "Gagal konfirmasi alokasi" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /match/:matchId/split  — one mutation -> multiple allocation lines
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/match/:matchId/split", async (req, res) => {
  const matchId = parseInt(req.params.matchId);
  const user = (req as any).user;
  const userCompanyId = (req as any).user?.companyId ?? null;
  const { lines, bank_account_id } = req.body as {
    lines: Array<{ allocation_type: string; reference_type?: string; reference_id?: number; coa_id?: number; amount: number; remarks?: string }>;
    bank_account_id?: number;
  };

  let allocationNo: string | null = null;
  let savedMutationId: number | null = null;
  let savedFromStatus: string | null = null;

  try {
    const headerId = await db.transaction(async (tx) => {
      // P0: row lock to serialise concurrent split/confirm attempts.
      // Ownership check MUST come before body validation so cross-company users
      // always get 403 regardless of body shape (prevents match-existence info leak).
      const rows = await tx.execute<any>(sql`
        SELECT * FROM bank_allocation_matches WHERE id = ${matchId} FOR UPDATE
      `).then((r) => r.rows);
      if (!rows.length) throw Object.assign(new Error("Match tidak ditemukan"), { httpStatus: 404 });
      const m = rows[0];
      savedMutationId = Number(m.bank_mutation_id);
      savedFromStatus = m.status;

      // P0c — ownership check (before any body validation)
      if (!ownershipAllowed(m, userCompanyId)) {
        throw Object.assign(new Error("Akses ditolak"), { httpStatus: 403 });
      }

      if (!["CANDIDATE", "MATCHED"].includes(m.status)) {
        throw Object.assign(new Error("Match sudah diproses sebelumnya"), { httpStatus: 400 });
      }

      // Body validation after ownership is confirmed
      if (!Array.isArray(lines) || lines.length < 2) {
        throw Object.assign(new Error("Split membutuhkan minimal 2 lines"), { httpStatus: 400 });
      }

      // P1b — validate per-line amount
      for (let i = 0; i < lines.length; i++) {
        const amt = Number(lines[i].amount ?? 0);
        if (!Number.isFinite(amt) || amt <= 0) {
          throw Object.assign(new Error(`Line ${i + 1}: amount harus lebih dari 0`), { httpStatus: 400 });
        }
      }

      const mutRows = await tx.execute<any>(sql`
        SELECT id, amount, transaction_date::text AS transaction_date, bank_account_id
        FROM bank_mutations WHERE id = ${m.bank_mutation_id}
      `).then((r) => r.rows);
      if (!mutRows.length) throw Object.assign(new Error("Mutasi tidak ditemukan"), { httpStatus: 404 });
      const mut = mutRows[0];

      const sum = lines.reduce((acc, l) => acc + Number(l.amount), 0);
      const diff = Math.abs(sum - Number(mut.amount));
      if (diff >= 0.01) {
        throw Object.assign(
          new Error(`Total split (${sum.toLocaleString()}) tidak sama dengan nominal mutasi (${Number(mut.amount).toLocaleString()}). Selisih: ${diff.toLocaleString()}`),
          { httpStatus: 400 },
        );
      }

      allocationNo = await generateAllocationNo(Number(m.company_id));
      const bankAccountId = bank_account_id ?? mut.bank_account_id ?? null;

      const headerRows = await tx.execute<{ id: number }>(sql`
        INSERT INTO allocation_headers
          (company_id, allocation_no, bank_transaction_id, bank_account_id,
           currency, exchange_rate, received_amount, allocated_amount, remaining_amount,
           status, allocation_date, created_by, notes)
        VALUES
          (${m.company_id}, ${allocationNo}, ${mut.id}, ${bankAccountId},
           'IDR', 1, ${mut.amount}, ${sum}, 0,
           'draft', ${mut.transaction_date}, ${user?.email ?? null}, 'Bank Allocation manual SPLIT')
        RETURNING id
      `).then((r) => r.rows);

      const hId = headerRows[0]?.id;
      if (!hId) throw new Error("Failed to create allocation header");

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await tx.execute(sql`
          INSERT INTO allocation_lines
            (allocation_header_id, allocation_type, reference_type, reference_id,
             coa_id, amount, remarks, sort_order, allocation_status)
          VALUES
            (${hId}, ${l.allocation_type}, ${l.reference_type ?? null}, ${l.reference_id ?? null},
             ${l.coa_id ?? null}, ${l.amount}, ${l.remarks ?? null}, ${i}, 'pending')
        `);
      }

      await tx.execute(sql`
        UPDATE bank_allocation_matches
        SET status = 'CONFIRMED', allocation_header_id = ${hId},
            confirmed_by = ${user?.email ?? null}, confirmed_at = NOW(), updated_at = NOW()
        WHERE id = ${matchId}
      `);

      return hId;
    });

    await writeMatchLog(savedMutationId!, matchId, "SPLIT", user?.email ?? null, user?.id ?? null, savedFromStatus, "CONFIRMED", undefined, { allocation_header_id: headerId, line_count: lines.length });
    res.json({ ok: true, status: "CONFIRMED", allocation_header_id: headerId, allocation_no: allocationNo, line_count: lines.length });
  } catch (err: any) {
    const status = err?.httpStatus ?? 500;
    if (status < 500) return res.status(status).json({ error: err.message });
    logger.error({ err }, "[bankAllocation] split error");
    res.status(500).json({ error: err?.message ?? "Gagal split alokasi" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /match/:matchId/merge  — multiple mutations -> one allocation
//
// P0b fix: other_mutation_ids validated as positive integers; parameterized
// drizzle sql`` template used — sql.raw() is gone from user-supplied data.
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/match/:matchId/merge", async (req, res) => {
  const matchId = parseInt(req.params.matchId);
  const user = (req as any).user;
  const userCompanyId = (req as any).user?.companyId ?? null;
  const { other_mutation_ids, bank_account_id } = req.body as { other_mutation_ids: unknown; bank_account_id?: number };

  // P0b — strict validation of the user-supplied ID list.
  // We require each element to be either a positive JS number or a string that is
  // purely decimal digits with no extra characters — this rejects injection strings
  // like "1; DROP TABLE..." even though the parameterized query would have been safe.
  if (!Array.isArray(other_mutation_ids) || other_mutation_ids.length === 0) {
    return res.status(400).json({ error: "Merge membutuhkan minimal 1 mutasi lain (other_mutation_ids harus array tidak kosong)" });
  }
  const safeOtherIds: number[] = [];
  for (const raw of other_mutation_ids) {
    // Accept only plain numbers or pure-digit strings — reject anything else
    const isPlainNumber = typeof raw === "number" && Number.isFinite(raw);
    const isPureDigitString = typeof raw === "string" && /^\d+$/.test(raw);
    if (!isPlainNumber && !isPureDigitString) {
      return res.status(400).json({ error: `other_mutation_ids berisi nilai tidak valid: ${JSON.stringify(raw)}` });
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      return res.status(400).json({ error: `other_mutation_ids berisi nilai tidak valid: ${raw}` });
    }
    safeOtherIds.push(n);
  }

  let allocationNo: string | null = null;
  let savedFromStatus: string | null = null;

  try {
    const { headerId, totalAmount, mergedCount } = await db.transaction(async (tx) => {
      // P0: row lock on the primary match
      const rows = await tx.execute<any>(sql`
        SELECT * FROM bank_allocation_matches WHERE id = ${matchId} FOR UPDATE
      `).then((r) => r.rows);
      if (!rows.length) throw Object.assign(new Error("Match tidak ditemukan"), { httpStatus: 404 });
      const primary = rows[0];
      savedFromStatus = primary.status;

      // P0c — ownership check
      if (!ownershipAllowed(primary, userCompanyId)) {
        throw Object.assign(new Error("Akses ditolak"), { httpStatus: 403 });
      }

      if (!["CANDIDATE", "MATCHED"].includes(primary.status)) {
        throw Object.assign(new Error("Match sudah diproses sebelumnya"), { httpStatus: 400 });
      }

      // P0b — build parameterized ANY() array using drizzle sql`` fragments
      // Each ${id} is a separate bind parameter — NO sql.raw() on user data.
      const primaryMutId = Number(primary.bank_mutation_id);
      const allMutIds = [primaryMutId, ...safeOtherIds];
      const idFragments = allMutIds.map((id) => sql`${id}`);
      const idList = sql.join(idFragments, sql`, `);

      const mutRows = await tx.execute<any>(sql`
        SELECT id, amount, transaction_date::text AS transaction_date, bank_account_id, company_id
        FROM bank_mutations
        WHERE id = ANY(ARRAY[${idList}]::int[])
      `).then((r) => r.rows);

      if (mutRows.length !== allMutIds.length) {
        throw Object.assign(new Error("Salah satu mutasi tidak ditemukan"), { httpStatus: 404 });
      }

      // Ensure all merged mutations belong to the same company as the primary match
      for (const mr of mutRows) {
        if (mr.company_id && primary.company_id && Number(mr.company_id) !== Number(primary.company_id)) {
          throw Object.assign(new Error(`Mutasi id=${mr.id} bukan milik company yang sama`), { httpStatus: 400 });
        }
      }

      const totalAmt = mutRows.reduce((acc: number, r: any) => acc + Number(r.amount), 0);
      const primaryMut = mutRows.find((r: any) => Number(r.id) === primaryMutId);

      allocationNo = await generateAllocationNo(Number(primary.company_id));
      const bankAccountId = bank_account_id ?? primaryMut?.bank_account_id ?? null;

      const headerRows = await tx.execute<{ id: number }>(sql`
        INSERT INTO allocation_headers
          (company_id, allocation_no, bank_transaction_id, bank_account_id,
           currency, exchange_rate, received_amount, allocated_amount, remaining_amount,
           status, allocation_date, created_by, notes)
        VALUES
          (${primary.company_id}, ${allocationNo}, ${primaryMutId}, ${bankAccountId},
           'IDR', 1, ${totalAmt}, ${primary.candidate_amount ?? totalAmt}, 0,
           'draft', ${primaryMut?.transaction_date}, ${user?.email ?? null},
           ${`Bank Allocation manual MERGE (${allMutIds.length} mutasi)`})
        RETURNING id
      `).then((r) => r.rows);

      const hId = headerRows[0]?.id;
      if (!hId) throw new Error("Failed to create allocation header");

      const allocationType = primary.candidate_type === "invoice" ? "SALES_INVOICE" : "ADVANCE_PRINCIPAL";
      await tx.execute(sql`
        INSERT INTO allocation_lines
          (allocation_header_id, allocation_type, reference_type, reference_id,
           coa_id, amount, remarks, sort_order, allocation_status)
        VALUES
          (${hId}, ${allocationType}, ${primary.candidate_type}, ${primary.candidate_id},
           NULL, ${totalAmt}, ${`Merged from ${allMutIds.length} bank mutations`}, 0, 'pending')
      `);

      // Mark exactly ONE match row per mutation as CONFIRMED.
      //
      // Regression fix: the previous code used `WHERE bank_mutation_id = ${mid}` which
      // updates ALL candidate rows for the mutation. A mutation can have multiple
      // CANDIDATE rows (one per scored candidate), so trying to set multiple to CONFIRMED
      // violates idx_bam_one_confirmed_per_mutation (only 1 CONFIRMED per bank_mutation_id).
      //
      // Fix: for the primary match, update by exact `id = ${matchId}`.
      // For other mutations, update only the BEST-scored MATCHED/CANDIDATE row using a
      // subquery that selects the single highest-score row with LIMIT 1.
      await tx.execute(sql`
        UPDATE bank_allocation_matches
        SET status = 'CONFIRMED', allocation_header_id = ${hId},
            confirmed_by = ${user?.email ?? null}, confirmed_at = NOW(), updated_at = NOW()
        WHERE id = ${matchId}
      `);

      for (const mid of safeOtherIds) {
        await tx.execute(sql`
          UPDATE bank_allocation_matches
          SET status = 'CONFIRMED', allocation_header_id = ${hId},
              confirmed_by = ${user?.email ?? null}, confirmed_at = NOW(), updated_at = NOW()
          WHERE id = (
            SELECT id FROM bank_allocation_matches
            WHERE bank_mutation_id = ${mid}
              AND status IN ('CANDIDATE', 'MATCHED')
            ORDER BY match_score DESC
            LIMIT 1
          )
        `);
      }

      return { headerId: hId, totalAmount: totalAmt, mergedCount: allMutIds.length };
    });

    const allMutIdsForLog = [Number((await db.execute<any>(sql`SELECT bank_mutation_id FROM bank_allocation_matches WHERE id = ${matchId}`).then(r => r.rows[0]))?.bank_mutation_id ?? 0), ...safeOtherIds];
    for (const mid of allMutIdsForLog) {
      await writeMatchLog(mid, matchId, "MERGE", user?.email ?? null, user?.id ?? null, savedFromStatus, "CONFIRMED", undefined, { allocation_header_id: headerId, merged_mutation_ids: allMutIdsForLog });
    }

    res.json({ ok: true, status: "CONFIRMED", allocation_header_id: headerId, allocation_no: allocationNo, merged_count: mergedCount, total_amount: totalAmount });
  } catch (err: any) {
    const status = err?.httpStatus ?? 500;
    if (status < 500) return res.status(status).json({ error: err.message });
    logger.error({ err }, "[bankAllocation] merge error");
    res.status(500).json({ error: err?.message ?? "Gagal merge alokasi" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /match/:matchId/reject
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/match/:matchId/reject", async (req, res) => {
  try {
    const matchId = parseInt(req.params.matchId);
    const user = (req as any).user;
    const userCompanyId = (req as any).user?.companyId ?? null;
    const { reason } = req.body as { reason?: string };
    if (!reason) return res.status(400).json({ error: "Alasan reject wajib diisi" });

    const rows = await db.execute<any>(sql`SELECT * FROM bank_allocation_matches WHERE id = ${matchId}`).then((r) => r.rows);
    if (!rows.length) return res.status(404).json({ error: "Match tidak ditemukan" });
    const m = rows[0];

    // P0c — ownership check
    if (!ownershipAllowed(m, userCompanyId)) {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    if (!["CANDIDATE", "MATCHED"].includes(m.status)) {
      return res.status(400).json({ error: "Hanya kandidat CANDIDATE/MATCHED yang dapat direject" });
    }

    await db.execute(sql`
      UPDATE bank_allocation_matches
      SET status = 'REJECTED', reject_reason = ${reason}, updated_at = NOW()
      WHERE id = ${matchId}
    `);
    await writeMatchLog(m.bank_mutation_id, matchId, "REJECT", user?.email ?? null, user?.id ?? null, m.status, "REJECTED", reason);
    res.json({ ok: true, status: "REJECTED" });
  } catch (err) {
    logger.error({ err }, "[bankAllocation] reject error");
    res.status(500).json({ error: "Gagal reject kandidat" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /reports/summary
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/reports/summary", async (req, res) => {
  try {
    const userCompanyId = (req as any).user?.companyId ?? null;
    const cf = userCompanyId ? sql`AND bam.company_id = ${userCompanyId}` : sql``;

    const mutCf = userCompanyId ? sql`AND company_id = ${userCompanyId}` : sql``;

    const [totals, byStatus, exceptions, recovery, mutTotals] = await Promise.all([
      db.execute<any>(sql`
        SELECT COUNT(*)::int AS total FROM bank_allocation_matches bam WHERE 1=1 ${cf}
      `).then((r) => r.rows[0]),
      db.execute<any>(sql`
        SELECT status, COUNT(*)::int AS count FROM bank_allocation_matches bam WHERE 1=1 ${cf} GROUP BY status
      `).then((r) => r.rows),
      db.execute<any>(sql`
        SELECT COUNT(*)::int AS count FROM bank_allocation_exceptions bae
        WHERE bae.status = 'open' ${userCompanyId ? sql`AND bae.company_id = ${userCompanyId}` : sql``}
      `).then((r) => r.rows[0]),
      db.execute<any>(sql`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (confirmed_at - created_at)) / 3600), 1) AS avg_hours
        FROM bank_allocation_matches bam
        WHERE confirmed_at IS NOT NULL ${cf}
      `).then((r) => r.rows[0]),
      db.execute<any>(sql`
        SELECT COUNT(*)::int AS total FROM bank_mutations bm
        WHERE bm.status != 'unmatched' ${mutCf}
      `).then((r) => r.rows[0]),
    ]);

    const statusMap: Record<string, number> = {};
    for (const row of byStatus) statusMap[row.status] = Number(row.count);

    const total = Number(totals?.total ?? 0) || 1;
    const totalMutationsProcessed = Math.max(Number(mutTotals?.total ?? 0), 1);
    const autoSuggestRow = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS count FROM bank_allocation_matches bam
      WHERE bam.is_auto_suggested = TRUE ${cf}
    `).then((r) => r.rows[0]);
    const confirmedCount = statusMap["CONFIRMED"] ?? 0;
    const rejectedCount = statusMap["REJECTED"] ?? 0;
    const matchedCount = statusMap["MATCHED"] ?? 0;
    const autoSuggestCount = Number(autoSuggestRow?.count ?? 0);

    res.json({
      match_rate: Number((((confirmedCount + matchedCount) / total) * 100).toFixed(1)),
      manual_rate: Number((((matchedCount + confirmedCount - autoSuggestCount > 0 ? matchedCount : matchedCount) / total) * 100).toFixed(1)),
      auto_suggest_rate: Number(((autoSuggestCount / total) * 100).toFixed(1)),
      exception_rate: Number((((Number(exceptions?.count ?? 0)) / totalMutationsProcessed) * 100).toFixed(1)),
      recovery_time_hours: recovery?.avg_hours != null ? Number(recovery.avg_hours) : null,
      allocation_accuracy: Number((((confirmedCount) / Math.max(confirmedCount + rejectedCount, 1)) * 100).toFixed(1)),
      by_status: statusMap,
      open_exceptions: Number(exceptions?.count ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "[bankAllocation] reports summary error");
    res.status(500).json({ error: "Gagal mengambil report" });
  }
});

export default router;
export { router as bankAllocationMatchingRouter };
