/**
 * Allocation Engine — Sprint 3 Phase 1
 *
 * POST /api/allocation                    create header + lines
 * GET  /api/allocation                    list with filters
 * GET  /api/allocation/dashboard-stats    stats for dashboard
 * GET  /api/allocation/:id                single detail with lines
 * PATCH /api/allocation/:id               update (draft only)
 * POST /api/allocation/:id/submit         draft → submitted
 * POST /api/allocation/:id/approve        submitted → approved
 * POST /api/allocation/:id/reject         submitted → draft
 * POST /api/allocation/:id/post           approved → posted (journal via AdvanceJournalService)
 * POST /api/allocation/:id/reverse        posted → reversed (reversal journal)
 *
 * RULE: journal hanya melalui AdvanceJournalService.postAllocationEngineJournal
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { AdvanceJournalService } from "../lib/advance/AdvanceJournalService.js";
import { createReversalJournal } from "../lib/accountingPostingGuard.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Auth guard: semua route butuh admin. requireAdmin tidak memanggil next() ──
// sehingga dipakai via wrapper agar request tidak hang setelah auth sukses.
router.use(async (req: Request, res: Response, next: NextFunction) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── Helper: generate allocation number ───────────────────────────────────────

async function generateAllocationNo(companyId: number): Promise<string> {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rows = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) AS count FROM allocation_headers
    WHERE company_id = ${companyId}
      AND TO_CHAR(created_at, 'YYYYMM') = ${ym}
  `).then((r) => r.rows);
  const seq = (parseInt(rows[0]?.count ?? "0") + 1).toString().padStart(4, "0");
  return `ALLOC-${ym}-${seq}`;
}

// ── Helper: audit log ─────────────────────────────────────────────────────────
// Accepts an optional `client` so the log can run inside a db.transaction(tx).
// Defaults to the module-level `db` for callers outside a transaction.
// Always swallows errors (.catch(()=>{})) so a log failure never rolls back data.

async function writeAuditLog(
  headerId: number,
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
    INSERT INTO allocation_audit_logs
      (allocation_header_id, action, actor, actor_id, from_status, to_status, notes, snapshot)
    VALUES
      (${headerId}, ${action}, ${actor}, ${actorId}, ${fromStatus}, ${toStatus},
       ${notes ?? null}, ${snapshot ? JSON.stringify(snapshot) : null})
  `).catch(() => {});
}

// ── Helper: resolve COA for known allocation types ────────────────────────────
// For ADVANCE_PRINCIPAL, SALES_INVOICE, etc. that need a COA but none is provided,
// fall back to a sensible default from the company's accounting settings.

async function resolveLineCoa(
  allocationType: string,
  coaId: number | null | undefined,
  companyId: number,
): Promise<number | null> {
  if (coaId) return Number(coaId);

  // For types where COA is required but not supplied, try accounting_settings defaults
  const settingsRows = await db.execute<{
    ar_account_id: number | null;
    ap_account_id: number | null;
    revenue_account_id: number | null;
  }>(sql`
    SELECT ar_account_id, ap_account_id, revenue_account_id
    FROM accounting_settings
    WHERE company_id = ${companyId}
    LIMIT 1
  `).then((r) => r.rows).catch(() => [] as any[]);

  const s = settingsRows[0];

  switch (allocationType) {
    case "ADVANCE_PRINCIPAL":
    case "OTHER_RECEIVABLE":
    case "SALES_INVOICE":
      return s?.ar_account_id ?? null;
    case "DIRECT_REVENUE":
      return s?.revenue_account_id ?? null;
    case "CUSTOMER_DEPOSIT":
      // Look for a "customer deposit" liability COA by code pattern
      const depositRows = await db.execute<{ id: number }>(sql`
        SELECT id FROM chart_of_accounts
        WHERE (company_id = ${companyId} OR company_id IS NULL)
          AND (code LIKE '2-2%' OR LOWER(name) LIKE '%deposit%')
        ORDER BY company_id DESC NULLS LAST, id LIMIT 1
      `).then((r) => r.rows).catch(() => []);
      return depositRows[0]?.id ?? s?.ap_account_id ?? null;
    default:
      return null;
  }
}

// ── Validate line sum = received_amount ───────────────────────────────────────

function validateAllocationBalance(
  receivedAmount: number,
  lines: Array<{ amount: number | string }>,
): { ok: boolean; sum: number; diff: number } {
  const sum = lines.reduce((acc, l) => acc + Number(l.amount ?? 0), 0);
  const diff = Math.abs(sum - Number(receivedAmount));
  return { ok: diff < 0.01, sum, diff };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /dashboard-stats
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/dashboard-stats", async (req, res) => {
  try {
    const companyId = (req as any).user?.companyId ?? null;
    const companyFilter = companyId ? sql`AND ah.company_id = ${companyId}` : sql``;
    const companyFilterSimple = companyId ? sql`AND company_id = ${companyId}` : sql``;

    const [
      outstandingRows,
      pendingRows,
      depositRows,
      recoveredTodayRows,
      avgDaysRows,
    ] = await Promise.all([
      db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(remaining_amount), 0) AS total
        FROM allocation_headers
        WHERE status NOT IN ('posted', 'closed', 'reversed') ${companyFilterSimple}
      `).then((r) => r.rows),
      db.execute<{ count: string; total: string }>(sql`
        SELECT COUNT(*) AS count, COALESCE(SUM(received_amount), 0) AS total
        FROM allocation_headers
        WHERE status IN ('draft', 'submitted') ${companyFilterSimple}
      `).then((r) => r.rows),
      db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(al.amount), 0) AS total
        FROM allocation_lines al
        JOIN allocation_headers ah ON ah.id = al.allocation_header_id
        WHERE al.allocation_type = 'CUSTOMER_DEPOSIT'
          AND ah.status = 'posted' ${companyFilter}
      `).then((r) => r.rows),
      db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(allocated_amount), 0) AS total
        FROM allocation_headers
        WHERE status = 'posted'
          AND DATE(updated_at) = CURRENT_DATE ${companyFilterSimple}
      `).then((r) => r.rows).catch(() => [{ total: "0" }]),
      db.execute<{ avg_days: string }>(sql`
        SELECT ROUND(AVG(
          EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400
        ), 1) AS avg_days
        FROM allocation_headers
        WHERE status = 'posted' ${companyFilterSimple}
      `).then((r) => r.rows).catch(() => [{ avg_days: "0" }]),
    ]);

    res.json({
      outstanding_amount: parseFloat(outstandingRows[0]?.total ?? "0"),
      pending_count: parseInt(pendingRows[0]?.count ?? "0"),
      pending_amount: parseFloat(pendingRows[0]?.total ?? "0"),
      customer_deposit: parseFloat(depositRows[0]?.total ?? "0"),
      recovered_today: parseFloat(recoveredTodayRows[0]?.total ?? "0"),
      avg_recovery_days: parseFloat(avgDaysRows[0]?.avg_days ?? "0"),
    });
  } catch (err) {
    logger.error({ err }, "[allocation] dashboard-stats error");
    res.status(500).json({ error: "Gagal mengambil statistik" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /  — list
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/", async (req, res) => {
  try {
    const {
      status,
      companyId: qCompanyId,
      search,
      page = "1",
      limit = "50",
    } = req.query as Record<string, string>;

    const userCompanyId = (req as any).user?.companyId ?? null;
    const companyId = qCompanyId ? parseInt(qCompanyId) : userCompanyId;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions: any[] = [];
    if (companyId) conditions.push(sql`ah.company_id = ${companyId}`);
    if (status && status !== "all") conditions.push(sql`ah.status = ${status}`);
    if (search) {
      conditions.push(sql`(
        ah.allocation_no ILIKE ${"%" + search + "%"}
        OR ah.reference_no ILIKE ${"%" + search + "%"}
        OR ah.notes ILIKE ${"%" + search + "%"}
      )`);
    }

    const whereClause =
      conditions.length > 0
        ? sql`WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
        : sql``;

    const rows = await db.execute<{
      id: number;
      allocation_no: string;
      allocation_date: string;
      company_id: number;
      bank_account_id: number | null;
      bank_name: string | null;
      received_amount: string;
      allocated_amount: string;
      remaining_amount: string;
      status: string;
      reference_no: string | null;
      notes: string | null;
      created_by: string | null;
      approved_by: string | null;
      posted_by: string | null;
      journal_entry_id: number | null;
      created_at: string;
      line_count: string;
    }>(sql`
      SELECT
        ah.*,
        cba.bank_name,
        COUNT(al.id) AS line_count
      FROM allocation_headers ah
      LEFT JOIN company_bank_accounts cba ON cba.id = ah.bank_account_id
      LEFT JOIN allocation_lines al ON al.allocation_header_id = ah.id
      ${whereClause}
      GROUP BY ah.id, cba.bank_name
      ORDER BY ah.created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `).then((r) => r.rows);

    const totalRows = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count FROM allocation_headers ah ${whereClause}
    `).then((r) => r.rows);

    res.json({
      data: rows.map((r) => ({
        ...r,
        received_amount: parseFloat(r.received_amount),
        allocated_amount: parseFloat(r.allocated_amount),
        remaining_amount: parseFloat(r.remaining_amount),
        line_count: parseInt(r.line_count),
      })),
      total: parseInt(totalRows[0]?.count ?? "0"),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    logger.error({ err }, "[allocation] list error");
    res.status(500).json({ error: "Gagal mengambil daftar alokasi" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /  — create
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/", async (req, res) => {
  try {
    const user = (req as any).user;
    const {
      company_id,
      bank_transaction_id,
      bank_account_id,
      currency = "IDR",
      exchange_rate = 1,
      received_amount,
      reference_no,
      customer_id,
      vendor_id,
      project_id,
      notes,
      allocation_date,
      lines = [],
    } = req.body as {
      company_id: number;
      bank_transaction_id?: number;
      bank_account_id?: number;
      currency?: string;
      exchange_rate?: number;
      received_amount: number;
      reference_no?: string;
      customer_id?: number;
      vendor_id?: number;
      project_id?: string;
      notes?: string;
      allocation_date?: string;
      lines: Array<{
        allocation_type: string;
        reference_type?: string;
        reference_id?: number;
        coa_id?: number;
        amount: number;
        remarks?: string;
        sort_order?: number;
      }>;
    };

    if (!company_id || !received_amount || received_amount <= 0) {
      return res.status(400).json({ error: "company_id dan received_amount wajib diisi" });
    }

    // Enforce company isolation: non-superadmin hanya boleh create untuk company sendiri
    const userCompanyId = (req as any).user?.companyId ?? null;
    if (userCompanyId && Number(company_id) !== Number(userCompanyId)) {
      return res.status(403).json({ error: "Tidak diizinkan membuat allocation untuk company lain" });
    }

    if (!lines || lines.length === 0) {
      return res.status(400).json({ error: "Minimal satu allocation line diperlukan" });
    }

    // Validate balance
    const balance = validateAllocationBalance(received_amount, lines);
    if (!balance.ok) {
      return res.status(400).json({
        error: `Total alokasi (${balance.sum.toLocaleString()}) tidak sama dengan received amount (${Number(received_amount).toLocaleString()}). Selisih: ${balance.diff.toLocaleString()}`,
      });
    }

    const allocationNo = await generateAllocationNo(company_id);
    const allocatedAmount = balance.sum;
    const remainingAmount = Number(received_amount) - allocatedAmount;
    const dateStr = allocation_date ?? new Date().toISOString().substring(0, 10);

    // ── Atomic: header + lines + audit log all-or-nothing ────────────────────
    const headerId = await db.transaction(async (tx) => {
      const headerRows = await tx.execute<{ id: number }>(sql`
        INSERT INTO allocation_headers
          (company_id, allocation_no, bank_transaction_id, bank_account_id,
           currency, exchange_rate, received_amount, allocated_amount, remaining_amount,
           status, reference_no, customer_id, vendor_id, project_id, notes,
           allocation_date, created_by)
        VALUES
          (${company_id}, ${allocationNo}, ${bank_transaction_id ?? null},
           ${bank_account_id ?? null}, ${currency}, ${exchange_rate},
           ${received_amount}, ${allocatedAmount}, ${remainingAmount},
           'draft', ${reference_no ?? null}, ${customer_id ?? null},
           ${vendor_id ?? null}, ${project_id ?? null}, ${notes ?? null},
           ${dateStr}, ${user?.email ?? null})
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
            (${hId}, ${l.allocation_type}, ${l.reference_type ?? null},
             ${l.reference_id ?? null}, ${l.coa_id ?? null}, ${l.amount},
             ${l.remarks ?? null}, ${l.sort_order ?? i}, 'pending')
        `);
      }

      // Audit log inside transaction — swallows own errors, never rolls back data
      await writeAuditLog(hId, "create", user?.email ?? null, user?.id ?? null, null, "draft", undefined, undefined, tx);

      return hId;
    });

    res.status(201).json({ id: headerId, allocation_no: allocationNo, status: "draft" });
  } catch (err) {
    logger.error({ err }, "[allocation] create error");
    res.status(500).json({ error: "Gagal membuat alokasi" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /:id
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userCompanyId = (req as any).user?.companyId ?? null;

    const headerRows = await db.execute<any>(sql`
      SELECT ah.*, cba.bank_name, cba.account_number
      FROM allocation_headers ah
      LEFT JOIN company_bank_accounts cba ON cba.id = ah.bank_account_id
      WHERE ah.id = ${id}
        AND (${userCompanyId}::integer IS NULL OR ah.company_id = ${userCompanyId})
    `).then((r) => r.rows);

    if (!headerRows.length) return res.status(404).json({ error: "Allocation tidak ditemukan" });

    const lineRows = await db.execute<any>(sql`
      SELECT al.*, coa.code AS coa_code, coa.name AS coa_name
      FROM allocation_lines al
      LEFT JOIN chart_of_accounts coa ON coa.id = al.coa_id
      WHERE al.allocation_header_id = ${id}
      ORDER BY al.sort_order, al.id
    `).then((r) => r.rows);

    const auditRows = await db.execute<any>(sql`
      SELECT * FROM allocation_audit_logs
      WHERE allocation_header_id = ${id}
      ORDER BY created_at ASC
    `).then((r) => r.rows);

    const h = headerRows[0];
    res.json({
      ...h,
      received_amount: parseFloat(h.received_amount),
      allocated_amount: parseFloat(h.allocated_amount),
      remaining_amount: parseFloat(h.remaining_amount),
      lines: lineRows.map((l: any) => ({
        ...l,
        amount: parseFloat(l.amount),
      })),
      audit_logs: auditRows,
    });
  } catch (err) {
    logger.error({ err }, "[allocation] get detail error");
    res.status(500).json({ error: "Gagal mengambil detail alokasi" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /:id  — update (draft only)
// ═══════════════════════════════════════════════════════════════════════════════

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const userCompanyId = (req as any).user?.companyId ?? null;

    const headerRows = await db.execute<{ id: number; status: string; company_id: number; received_amount: string }>(sql`
      SELECT id, status, company_id, received_amount FROM allocation_headers
      WHERE id = ${id}
        AND (${userCompanyId}::integer IS NULL OR company_id = ${userCompanyId})
    `).then((r) => r.rows);

    if (!headerRows.length) return res.status(404).json({ error: "Allocation tidak ditemukan" });
    if (headerRows[0].status !== "draft") {
      return res.status(400).json({ error: "Hanya allocation berstatus draft yang dapat diedit" });
    }

    const {
      bank_transaction_id,
      bank_account_id,
      received_amount,
      reference_no,
      customer_id,
      vendor_id,
      project_id,
      notes,
      allocation_date,
      lines,
    } = req.body as any;

    // Effective received_amount: from body or from existing DB row
    const effReceivedAmount =
      received_amount != null
        ? Number(received_amount)
        : parseFloat(headerRows[0].received_amount ?? "0");

    // Validate balance if lines provided
    if (lines && lines.length > 0) {
      const balance = validateAllocationBalance(effReceivedAmount, lines);
      if (!balance.ok) {
        return res.status(400).json({
          error: `Total alokasi (${balance.sum.toLocaleString()}) tidak sama dengan received amount (${effReceivedAmount.toLocaleString()})`,
        });
      }
    }

    const allocatedAmount = lines
      ? lines.reduce((a: number, l: any) => a + Number(l.amount ?? 0), 0)
      : undefined;
    // Recompute remaining using effReceivedAmount (existing or provided) whenever lines change
    const remainingAmount =
      allocatedAmount != null
        ? effReceivedAmount - allocatedAmount
        : received_amount != null
          ? Number(received_amount) - (parseFloat(headerRows[0].received_amount ?? "0"))
          : undefined;

    // ── Atomic: header update + line replacement + audit log all-or-nothing ──
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE allocation_headers SET
          bank_transaction_id = COALESCE(${bank_transaction_id ?? null}, bank_transaction_id),
          bank_account_id     = COALESCE(${bank_account_id ?? null}, bank_account_id),
          received_amount     = COALESCE(${received_amount ?? null}, received_amount),
          allocated_amount    = COALESCE(${allocatedAmount ?? null}, allocated_amount),
          remaining_amount    = COALESCE(${remainingAmount ?? null}, remaining_amount),
          reference_no        = COALESCE(${reference_no ?? null}, reference_no),
          customer_id         = COALESCE(${customer_id ?? null}, customer_id),
          vendor_id           = COALESCE(${vendor_id ?? null}, vendor_id),
          project_id          = COALESCE(${project_id ?? null}, project_id),
          notes               = COALESCE(${notes ?? null}, notes),
          allocation_date     = COALESCE(${allocation_date ?? null}, allocation_date),
          updated_at          = NOW()
        WHERE id = ${id}
          AND (${userCompanyId}::integer IS NULL OR company_id = ${userCompanyId})
      `);

      // Replace lines if provided — delete + insert inside the same transaction
      // so a failed line insert rolls back the header update and the delete together
      if (lines) {
        await tx.execute(sql`DELETE FROM allocation_lines WHERE allocation_header_id = ${id}`);
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          await tx.execute(sql`
            INSERT INTO allocation_lines
              (allocation_header_id, allocation_type, reference_type, reference_id,
               coa_id, amount, remarks, sort_order, allocation_status)
            VALUES
              (${id}, ${l.allocation_type}, ${l.reference_type ?? null},
               ${l.reference_id ?? null}, ${l.coa_id ?? null}, ${l.amount},
               ${l.remarks ?? null}, ${l.sort_order ?? i}, 'pending')
          `);
        }
      }

      // Audit log inside transaction — swallows own errors, never rolls back data
      await writeAuditLog(id, "edit", user?.email ?? null, user?.id ?? null, "draft", "draft", undefined, undefined, tx);
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[allocation] update error");
    res.status(500).json({ error: "Gagal memperbarui alokasi" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:id/submit
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/:id/submit", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const userCompanyId = (req as any).user?.companyId ?? null;

    const rows = await db.execute<{ id: number; status: string; received_amount: string }>(sql`
      SELECT id, status, received_amount FROM allocation_headers
      WHERE id = ${id}
        AND (${userCompanyId}::integer IS NULL OR company_id = ${userCompanyId})
    `).then((r) => r.rows);

    if (!rows.length) return res.status(404).json({ error: "Allocation tidak ditemukan" });
    if (rows[0].status !== "draft") {
      return res.status(400).json({ error: "Hanya draft yang dapat disubmit" });
    }

    // Revalidate balance
    const lineRows = await db.execute<{ amount: string }>(sql`
      SELECT amount FROM allocation_lines WHERE allocation_header_id = ${id}
    `).then((r) => r.rows);
    const balance = validateAllocationBalance(
      parseFloat(rows[0].received_amount),
      lineRows.map((l) => ({ amount: parseFloat(l.amount) })),
    );
    if (!balance.ok) {
      return res.status(400).json({ error: `Total alokasi tidak balance. Selisih: ${balance.diff}` });
    }

    await db.execute(sql`
      UPDATE allocation_headers SET status = 'submitted', updated_at = NOW()
      WHERE id = ${id}
        AND (${userCompanyId}::integer IS NULL OR company_id = ${userCompanyId})
    `);
    await writeAuditLog(id, "submit", user?.email ?? null, user?.id ?? null, "draft", "submitted");
    res.json({ ok: true, status: "submitted" });
  } catch (err) {
    logger.error({ err }, "[allocation] submit error");
    res.status(500).json({ error: "Gagal submit alokasi" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:id/approve
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/:id/approve", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const userCompanyId = (req as any).user?.companyId ?? null;
    const { notes } = req.body as { notes?: string };

    const rows = await db.execute<{ id: number; status: string }>(sql`
      SELECT id, status FROM allocation_headers
      WHERE id = ${id}
        AND (${userCompanyId}::integer IS NULL OR company_id = ${userCompanyId})
    `).then((r) => r.rows);

    if (!rows.length) return res.status(404).json({ error: "Allocation tidak ditemukan" });
    if (rows[0].status !== "submitted") {
      return res.status(400).json({ error: "Hanya submitted yang dapat diapprove" });
    }

    await db.execute(sql`
      UPDATE allocation_headers
      SET status = 'approved', approved_by = ${user?.email ?? null}, updated_at = NOW()
      WHERE id = ${id}
        AND (${userCompanyId}::integer IS NULL OR company_id = ${userCompanyId})
    `);
    await writeAuditLog(id, "approve", user?.email ?? null, user?.id ?? null, "submitted", "approved", notes);
    res.json({ ok: true, status: "approved" });
  } catch (err) {
    logger.error({ err }, "[allocation] approve error");
    res.status(500).json({ error: "Gagal approve alokasi" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:id/reject  — back to draft
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/:id/reject", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const userCompanyId = (req as any).user?.companyId ?? null;
    const { notes } = req.body as { notes?: string };

    const rows = await db.execute<{ id: number; status: string }>(sql`
      SELECT id, status FROM allocation_headers
      WHERE id = ${id}
        AND (${userCompanyId}::integer IS NULL OR company_id = ${userCompanyId})
    `).then((r) => r.rows);

    if (!rows.length) return res.status(404).json({ error: "Allocation tidak ditemukan" });
    if (!["submitted", "approved"].includes(rows[0].status)) {
      return res.status(400).json({ error: "Hanya submitted/approved yang dapat direject" });
    }

    await db.execute(sql`
      UPDATE allocation_headers SET status = 'draft', updated_at = NOW()
      WHERE id = ${id}
        AND (${userCompanyId}::integer IS NULL OR company_id = ${userCompanyId})
    `);
    await writeAuditLog(id, "reject", user?.email ?? null, user?.id ?? null, rows[0].status, "draft", notes);
    res.json({ ok: true, status: "draft" });
  } catch (err) {
    logger.error({ err }, "[allocation] reject error");
    res.status(500).json({ error: "Gagal reject alokasi" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:id/post  — approved → posted (JOURNAL via AdvanceJournalService)
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/:id/post", async (req, res) => {
  const id = parseInt(req.params.id);
  const user = (req as any).user;
  const userCompanyId = (req as any).user?.companyId ?? null;

  // ── Sentinel error untuk HTTP status dari dalam transaction ────────────────
  class PostError extends Error {
    constructor(public readonly httpStatus: number, message: string) { super(message); }
  }

  let entryId!: number;
  try {
    await db.transaction(async (tx) => {
      // ── FOR UPDATE: mencegah double-post concurrent ──────────────────────
      const lockedRows = await tx.execute<{
        id: number; status: string; company_id: number; allocation_no: string;
        bank_account_id: number | null; received_amount: string;
        allocation_date: string; journal_entry_id: number | null;
      }>(sql`
        SELECT id, status, company_id, allocation_no, bank_account_id,
               received_amount, allocation_date, journal_entry_id
        FROM allocation_headers
        WHERE id = ${id}
          AND (${userCompanyId}::integer IS NULL OR company_id = ${userCompanyId})
        FOR UPDATE
      `);

      if (!lockedRows.rows.length)
        throw new PostError(404, "Allocation tidak ditemukan");

      const h = lockedRows.rows[0];

      // Re-validate di dalam lock — state bisa sudah berubah sebelum dapat lock
      if (h.status !== "approved")
        throw new PostError(400, "Hanya allocation berstatus approved yang dapat diposting");
      if (h.journal_entry_id)
        throw new PostError(400, "Journal sudah pernah dibuat untuk allocation ini (double posting dicegah)");
      if (!h.bank_account_id)
        throw new PostError(400, "Bank account wajib dipilih sebelum posting");

      // Load lines (di dalam tx — konsisten dengan lock)
      const lineRows = await tx.execute<{
        id: number; allocation_type: string; coa_id: number | null;
        amount: string; remarks: string | null;
      }>(sql`
        SELECT id, allocation_type, coa_id, amount, remarks
        FROM allocation_lines WHERE allocation_header_id = ${id}
        ORDER BY sort_order, id
      `).then((r) => r.rows);

      // Resolve COA per line (read-only, menggunakan global db — tidak masalah)
      const journalLines: Array<{
        allocation_type: string; coa_id: number; amount: number; remarks?: string | null;
      }> = [];
      for (const l of lineRows) {
        const resolvedCoa = await resolveLineCoa(l.allocation_type, l.coa_id, h.company_id);
        if (!resolvedCoa)
          throw new PostError(400, `COA tidak ditemukan untuk line allocation_type=${l.allocation_type}. Silakan pilih COA secara manual.`);
        journalLines.push({ allocation_type: l.allocation_type, coa_id: resolvedCoa, amount: parseFloat(l.amount), remarks: l.remarks });
      }

      // Post via AdvanceJournalService — menggunakan global db (commit independen)
      // Lock sudah dipegang: thread concurrent akan antri di SELECT FOR UPDATE di atas
      const result = await AdvanceJournalService.postAllocationEngineJournal({
        companyId: h.company_id,
        allocationNo: h.allocation_no,
        receivedAmount: parseFloat(h.received_amount),
        date: h.allocation_date,
        bankAccountId: h.bank_account_id,
        lines: journalLines,
        actor: user?.email ?? null,
      });
      entryId = result.entryId;

      // Update di dalam tx — atomic dengan lock
      await tx.execute(sql`
        UPDATE allocation_headers
        SET status = 'posted',
            journal_entry_id = ${entryId},
            posted_by = ${user?.email ?? null},
            updated_at = NOW()
        WHERE id = ${id}
      `);
      await tx.execute(sql`
        UPDATE allocation_lines SET allocation_status = 'posted'
        WHERE allocation_header_id = ${id}
      `);
    });
  } catch (err: any) {
    if (err instanceof PostError)
      return res.status(err.httpStatus).json({ error: err.message });
    logger.error({ err }, "[allocation] post error");
    return res.status(500).json({ error: err?.message ?? "Gagal posting alokasi" });
  }

  await writeAuditLog(
    id, "post", user?.email ?? null, user?.id ?? null,
    "approved", "posted",
    `Journal entry #${entryId} dibuat`,
    { entryId },
  );

  res.json({ ok: true, status: "posted", journal_entry_id: entryId });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:id/reverse  — posted → reversed
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/:id/reverse", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const user = (req as any).user;
    const userCompanyId = (req as any).user?.companyId ?? null;
    const { reason } = req.body as { reason?: string };

    const rows = await db.execute<{
      id: number;
      status: string;
      company_id: number;
      allocation_no: string;
      journal_entry_id: number | null;
    }>(sql`
      SELECT id, status, company_id, allocation_no, journal_entry_id
      FROM allocation_headers
      WHERE id = ${id}
        AND (${userCompanyId}::integer IS NULL OR company_id = ${userCompanyId})
    `).then((r) => r.rows);

    if (!rows.length) return res.status(404).json({ error: "Allocation tidak ditemukan" });
    const h = rows[0];

    if (h.status !== "posted") {
      return res.status(400).json({ error: "Hanya allocation posted yang dapat direverse" });
    }
    if (!h.journal_entry_id) {
      return res.status(400).json({ error: "Tidak ada journal entry untuk direverse" });
    }

    // Reverse via accountingPostingGuard (same pattern as AdvanceJournalService.postVoidReversal)
    const result = await createReversalJournal({
      originalEntryId: h.journal_entry_id,
      companyId: h.company_id,
      actor: user?.email ?? null,
      reason: reason ?? `Reversal allocation ${h.allocation_no}`,
      tag: `[REVERSE ${h.allocation_no}]`,
    });

    if (!result.ok) {
      return res.status(500).json({ error: result.error ?? "Reversal journal gagal" });
    }

    await db.execute(sql`
      UPDATE allocation_headers SET status = 'reversed', updated_at = NOW() WHERE id = ${id}
    `);
    await db.execute(sql`
      UPDATE allocation_lines SET allocation_status = 'reversed'
      WHERE allocation_header_id = ${id}
    `);

    await writeAuditLog(
      id, "reverse", user?.email ?? null, user?.id ?? null,
      "posted", "reversed",
      reason ?? "Manual reversal",
      { reversalEntryId: result.entryId },
    );

    res.json({ ok: true, status: "reversed", reversal_entry_id: result.entryId });
  } catch (err: any) {
    logger.error({ err }, "[allocation] reverse error");
    res.status(500).json({ error: err?.message ?? "Gagal reverse alokasi" });
  }
});

export default router;
export { router as allocationRouter };
