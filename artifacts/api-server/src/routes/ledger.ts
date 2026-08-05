/**
 * /api/accounting/ledger — Immutable Ledger API
 *
 * fleet_ledger_entries is the SINGLE SOURCE OF TRUTH for all financial data.
 * - Reads  → dari ledger langsung (tidak dari journal/accounting_entry_lines)
 * - Writes → hanya via accounting_entry_lines trigger (tidak boleh direct INSERT)
 * - Void   → buat counter-entry (tidak boleh DELETE)
 * - Events → setiap perubahan dicatat ke ledger_events (POST/REVERSE/ADJUST/CLOSE_PERIOD)
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { postLedgerEvent } from "../lib/accounting.js";

const router = Router();

// ── GET /api/accounting/ledger ────────────────────────────────────────────────
// Query raw ledger entries
router.get("/", async (req, res) => {
  try {
    const companyId  = req.query.company_id ? Number(req.query.company_id) : null;
    const period     = req.query.period     ? String(req.query.period)     : null;
    const accountId  = req.query.account_id ? Number(req.query.account_id) : null;
    const sourceType = req.query.source_type ? String(req.query.source_type) : null;
    const isVoided   = req.query.is_voided === "true";
    const limit      = Math.min(Number(req.query.limit  ?? 500), 2000);
    const offset     = Number(req.query.offset ?? 0);

    const conditions: string[] = ["1=1"];
    if (companyId)  conditions.push(`fle.company_id = ${companyId}`);
    if (period)     conditions.push(`fle.period = '${period.replace(/'/g, "''")}'`);
    if (accountId)  conditions.push(`fle.account_id = ${accountId}`);
    if (sourceType) conditions.push(`fle.source_type = '${sourceType.replace(/'/g, "''")}'`);
    if (!isVoided)  conditions.push(`fle.is_voided = false`);

    const { rows } = await db.execute(sql.raw(`
      SELECT fle.*
      FROM fleet_ledger_entries fle
      WHERE ${conditions.join(" AND ")}
      ORDER BY fle.ledger_date DESC, fle.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `));

    return res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /accounting/ledger failed");
    return res.status(500).json({ message: "Gagal memuat ledger entries" });
  }
});

// ── GET /api/accounting/ledger/balance ────────────────────────────────────────
// Account balances per period — derived from v_ledger_balance_view
router.get("/balance", async (req, res) => {
  try {
    const companyId  = req.query.company_id ? Number(req.query.company_id) : null;
    const period     = req.query.period     ? String(req.query.period)     : null;
    const accountType = req.query.account_type ? String(req.query.account_type) : null;

    if (!companyId) return res.status(400).json({ message: "company_id wajib diisi" });

    const conditions: string[] = [`company_id = ${companyId}`];
    if (period)      conditions.push(`period = '${period.replace(/'/g, "''")}'`);
    if (accountType) conditions.push(`account_type = '${accountType.replace(/'/g, "''")}'`);

    const { rows } = await db.execute(sql.raw(`
      SELECT * FROM v_ledger_balance_view
      WHERE ${conditions.join(" AND ")}
      ORDER BY account_code, period
    `));

    return res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /accounting/ledger/balance failed");
    return res.status(500).json({ message: "Gagal memuat ledger balance" });
  }
});

// ── GET /api/accounting/ledger/summary ────────────────────────────────────────
// Summary totals (debit/credit) per period from ledger
router.get("/summary", async (req, res) => {
  try {
    const companyId = req.query.company_id ? Number(req.query.company_id) : null;
    const period    = req.query.period     ? String(req.query.period)     : null;

    if (!companyId) return res.status(400).json({ message: "company_id wajib diisi" });

    const periodFilter = period
      ? `AND period = '${period.replace(/'/g, "''")}'`
      : "";

    const { rows } = await db.execute(sql.raw(`
      SELECT
        period,
        COUNT(DISTINCT source_id)                  AS entry_count,
        COUNT(id)                                  AS line_count,
        SUM(debit)::numeric(15,2)                  AS total_debit,
        SUM(credit)::numeric(15,2)                 AS total_credit,
        (SUM(debit) - SUM(credit))::numeric(15,2)  AS net_balance,
        MIN(ledger_date)                           AS first_date,
        MAX(ledger_date)                           AS last_date
      FROM fleet_ledger_entries
      WHERE company_id = ${companyId}
        AND is_voided = false
        ${periodFilter}
      GROUP BY period
      ORDER BY period DESC
    `));

    return res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /accounting/ledger/summary failed");
    return res.status(500).json({ message: "Gagal memuat ledger summary" });
  }
});

// ── POST /api/accounting/ledger/void ─────────────────────────────────────────
// Create a counter-entry to void a ledger line (never deletes)
router.post("/void", requireAdmin, async (req, res) => {
  try {
    const { ledger_entry_id, reason } = req.body as {
      ledger_entry_id: number;
      reason?: string;
    };

    if (!ledger_entry_id) {
      return res.status(400).json({ message: "ledger_entry_id wajib diisi" });
    }

    const actor = (req as any).user?.email ?? "admin";

    const result = await db.transaction(async (tx) => {
      // Cek entry asli
      const { rows: origRows } = await tx.execute(sql.raw(`
        SELECT * FROM fleet_ledger_entries WHERE id = ${ledger_entry_id} FOR UPDATE
      `));
      const orig = origRows[0] as any;
      if (!orig) throw new Error(`Entry ${ledger_entry_id} tidak ditemukan`);
      if (orig.is_voided) throw new Error(`Entry ${ledger_entry_id} sudah di-void`);

      // Cek period tidak closed
      const [yearStr, monthStr] = String(orig.period).split("-");
      const { rows: periodRows } = await tx.execute(sql.raw(`
        SELECT period_status, is_closed FROM financial_periods
        WHERE company_id = ${orig.company_id}
          AND year = ${yearStr} AND month = ${monthStr}
      `));
      const period = periodRows[0] as any;
      if (period?.period_status === 'closed' || period?.is_closed) {
        throw new Error(`PERIOD_LOCKED: Period ${orig.period} sudah ditutup, tidak bisa void`);
      }

      // Buat counter-entry (debit↔credit dibalik, is_voided=false — ini entri void-nya sendiri)
      const { rows: voidRows } = await tx.execute(sql.raw(`
        INSERT INTO fleet_ledger_entries (
          company_id, ledger_date, period,
          source_type, source_id, source_ref,
          account_id, account_code, account_name, account_type,
          debit, credit, description, cost_center_id,
          is_voided, void_ref_id, created_by
        ) VALUES (
          ${orig.company_id},
          '${orig.ledger_date}',
          '${orig.period}',
          'void',
          ${orig.source_id ?? 'NULL'},
          ${orig.source_ref ? `'${String(orig.source_ref).replace(/'/g, "''")}'` : 'NULL'},
          ${orig.account_id},
          '${orig.account_code}',
          '${String(orig.account_name).replace(/'/g, "''")}',
          '${orig.account_type}',
          ${orig.credit},
          ${orig.debit},
          'VOID: ${(reason ?? '').replace(/'/g, "''")} (ref #${ledger_entry_id})',
          ${orig.cost_center_id ?? 'NULL'},
          false,
          ${ledger_entry_id},
          '${actor.replace(/'/g, "''")}'
        ) RETURNING id
      `));

      // Mark original sebagai voided
      await tx.execute(sql.raw(`
        UPDATE fleet_ledger_entries
        SET is_voided = true, void_ref_id = ${voidRows[0]?.id}
        WHERE id = ${ledger_entry_id}
      `));

      // Emit REVERSE ledger event
      await postLedgerEvent({
        companyId:      Number(orig.company_id),
        eventType:      "REVERSE",
        period:         String(orig.period),
        ledgerEntryId:  voidRows[0]?.id as number | undefined,
        actor,
        payload: {
          voidedEntryId: ledger_entry_id,
          reason: reason ?? null,
          accountId:    orig.account_id,
          accountCode:  orig.account_code,
          debit:        orig.debit,
          credit:       orig.credit,
        },
        client: tx as any,
      });

      return { voidEntryId: voidRows[0]?.id };
    });

    logger.info({ ledger_entry_id, result }, "Ledger entry voided");
    return res.json({ success: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("PERIOD_LOCKED")) return res.status(409).json({ message: msg });
    logger.error({ err }, "POST /accounting/ledger/void failed");
    return res.status(500).json({ message: "Gagal void ledger entry", detail: msg });
  }
});

// ── GET /api/accounting/ledger/events — audit debug tool ─────────────────────
// Tampilkan semua ledger events (POST/REVERSE/ADJUST/CLOSE_PERIOD) untuk debugging
router.get("/events", requireAdmin, async (req, res) => {
  try {
    const companyId = req.query.company_id ? Number(req.query.company_id) : null;
    const period    = req.query.period     ? String(req.query.period)     : null;
    const eventType = req.query.event_type ? String(req.query.event_type) : null;
    const limit     = Math.min(Number(req.query.limit ?? 200), 1000);
    const offset    = Number(req.query.offset ?? 0);

    const conditions: string[] = ["1=1"];
    if (companyId) conditions.push(`le.company_id = ${companyId}`);
    if (period)    conditions.push(`le.period = '${period.replace(/'/g, "''")}'`);
    if (eventType) conditions.push(`le.event_type = '${eventType.replace(/'/g, "''")}'`);

    const { rows } = await db.execute(sql.raw(`
      SELECT le.*
      FROM ledger_events le
      WHERE ${conditions.join(" AND ")}
      ORDER BY le.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `));

    return res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /accounting/ledger/events failed");
    return res.status(500).json({ message: "Gagal memuat ledger events" });
  }
});

// ── GET /api/accounting/ledger/audit-chain — verifikasi hash chain ───────────
// Audit debug tool: verifikasi integritas chain hash antar periode
router.get("/audit-chain", requireAdmin, async (req, res) => {
  try {
    const companyId = req.query.company_id ? Number(req.query.company_id) : null;
    if (!companyId) return res.status(400).json({ message: "company_id wajib diisi" });

    const { rows } = await db.execute(sql.raw(`
      SELECT
        ls.period,
        ls.snapshot_hash,
        ls.previous_snapshot_hash,
        ls.snapshot_at,
        ls.closing_id,
        COUNT(ls2.account_id)::int AS account_count
      FROM ledger_snapshots ls
      LEFT JOIN ledger_snapshots ls2
        ON ls2.company_id = ls.company_id AND ls2.period = ls.period
      WHERE ls.company_id = ${companyId}
      GROUP BY ls.period, ls.snapshot_hash, ls.previous_snapshot_hash, ls.snapshot_at, ls.closing_id
      ORDER BY ls.period ASC
    `));

    type SnapRow = {
      period: string;
      snapshot_hash: string | null;
      previous_snapshot_hash: string | null;
      snapshot_at: string;
      closing_id: number | null;
      account_count: number;
    };
    const snapshots = rows as SnapRow[];

    // Verifikasi chain: previous_snapshot_hash periode P harus = snapshot_hash periode P-1
    const chainResults = snapshots.map((snap, idx) => {
      if (idx === 0) return { period: snap.period, chainValid: null, note: "genesis (no previous)" };
      const prev = snapshots[idx - 1]!;
      const chainValid = snap.previous_snapshot_hash === prev.snapshot_hash;
      return {
        period:                snap.period,
        snapshotHash:          snap.snapshot_hash,
        previousSnapshotHash:  snap.previous_snapshot_hash,
        expectedPreviousHash:  prev.snapshot_hash,
        chainValid,
        accountCount:          snap.account_count,
        snapshotAt:            snap.snapshot_at,
        note: chainValid ? "OK" : "CHAIN BROKEN",
      };
    });

    const allValid = chainResults.every((r) => r.chainValid !== false);

    return res.json({
      companyId,
      totalPeriods:  snapshots.length,
      chainIntegrity: allValid ? "VALID" : "BROKEN",
      periods:       chainResults,
    });
  } catch (err) {
    logger.error({ err }, "GET /accounting/ledger/audit-chain failed");
    return res.status(500).json({ message: "Gagal verifikasi audit chain" });
  }
});

// ── GET /api/accounting/ledger/integrity-check ────────────────────────────────
// Quick integrity: compare accounting_entry_lines totals vs fleet_ledger_entries
router.get("/integrity-check", requireAdmin, async (req, res) => {
  try {
    const companyId = req.query.company_id ? Number(req.query.company_id) : null;
    const period    = req.query.period     ? String(req.query.period)     : null;

    if (!companyId) return res.status(400).json({ message: "company_id wajib diisi" });

    const periodFilter = period ? `AND TO_CHAR(ae.date::date, 'YYYY-MM') = '${period.replace(/'/g, "''")}'` : "";
    const ledgerFilter  = period ? `AND fle.period = '${period.replace(/'/g, "''")}'` : "";

    const [journalRes, ledgerRes] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          SUM(ael.debit::numeric)  AS journal_debit,
          SUM(ael.credit::numeric) AS journal_credit,
          COUNT(ael.id)            AS line_count
        FROM accounting_entry_lines ael
        JOIN accounting_entries ae ON ae.id = ael.entry_id
        WHERE (ae.company_id = ${companyId} OR ae.company_id IS NULL)
          AND ae.status = 'posted'
          ${periodFilter}
      `)),
      db.execute(sql.raw(`
        SELECT
          SUM(debit)  AS ledger_debit,
          SUM(credit) AS ledger_credit,
          COUNT(id)   AS line_count
        FROM fleet_ledger_entries fle
        WHERE company_id = ${companyId}
          AND is_voided = false
          AND source_type <> 'void'
          ${ledgerFilter}
      `)),
    ]);

    const j = (journalRes as any).rows?.[0] ?? {};
    const l = (ledgerRes  as any).rows?.[0] ?? {};

    const jDebit  = Number(j.journal_debit  ?? 0);
    const jCredit = Number(j.journal_credit ?? 0);
    const lDebit  = Number(l.ledger_debit   ?? 0);
    const lCredit = Number(l.ledger_credit  ?? 0);

    const debitDiff  = Math.abs(jDebit  - lDebit);
    const creditDiff = Math.abs(jCredit - lCredit);
    const isClean    = debitDiff < 0.01 && creditDiff < 0.01;

    return res.json({
      period: period ?? "all",
      companyId,
      isClean,
      journal: { debit: jDebit, credit: jCredit, lineCount: Number(j.line_count ?? 0) },
      ledger:  { debit: lDebit, credit: lCredit, lineCount: Number(l.line_count ?? 0) },
      diff:    { debit: debitDiff, credit: creditDiff },
    });
  } catch (err) {
    logger.error({ err }, "GET /accounting/ledger/integrity-check failed");
    return res.status(500).json({ message: "Gagal integrity check" });
  }
});

export default router;
