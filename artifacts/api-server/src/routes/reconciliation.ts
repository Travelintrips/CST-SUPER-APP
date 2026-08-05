/**
 * /api/accounting/reconciliation — Financial Reconciliation Engine
 *
 * Compares: fleet_ledger_entries vs accounting_entry_lines vs accounting_payments
 * Generates mismatch reports per period with auto-flagging.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use(requireAdmin);

// ── GET /api/accounting/reconciliation ───────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const companyId = req.query.company_id ? Number(req.query.company_id) : null;
    const limit     = Math.min(Number(req.query.limit ?? 50), 200);

    const where = companyId ? `WHERE company_id = ${companyId}` : "";

    const { rows } = await db.execute(sql.raw(`
      SELECT * FROM financial_reconciliation_reports
      ${where}
      ORDER BY run_at DESC
      LIMIT ${limit}
    `));

    return res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /reconciliation failed");
    return res.status(500).json({ message: "Gagal memuat daftar rekonsiliasi" });
  }
});

// ── GET /api/accounting/reconciliation/:period ────────────────────────────────
router.get("/:period", async (req, res) => {
  try {
    const { period } = req.params;
    const companyId  = Number(req.query.company_id ?? 0);

    if (!period.match(/^\d{4}-\d{2}$/)) {
      return res.status(400).json({ message: "Format periode harus YYYY-MM" });
    }

    const { rows } = await db.execute(sql.raw(`
      SELECT * FROM financial_reconciliation_reports
      WHERE company_id = ${companyId} AND period = '${period}'
      ORDER BY run_at DESC
      LIMIT 10
    `));

    return res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /reconciliation/:period failed");
    return res.status(500).json({ message: "Gagal memuat rekonsiliasi periode" });
  }
});

// ── POST /api/accounting/reconciliation/run ───────────────────────────────────
// Run reconciliation engine: compare ledger vs journals vs payments
router.post("/run", async (req, res) => {
  try {
    const { companyId, period, notes } = req.body as {
      companyId: number;
      period:    string;
      notes?:    string;
    };

    if (!companyId || !period) {
      return res.status(400).json({ message: "companyId dan period wajib diisi" });
    }
    if (!period.match(/^\d{4}-\d{2}$/)) {
      return res.status(400).json({ message: "Format periode harus YYYY-MM" });
    }

    const runBy = (req as any).user?.email ?? "system";
    const [yearStr, monthStr] = period.split("-");
    const periodStart = `${yearStr}-${monthStr}-01`;
    const periodEnd   = new Date(Number(yearStr), Number(monthStr), 0).toISOString().split("T")[0];

    // ── A. Totals dari fleet_ledger_entries (source of truth) ────────────────
    const { rows: ledgerRows } = await db.execute(sql.raw(`
      SELECT
        SUM(debit)  AS ledger_debit,
        SUM(credit) AS ledger_credit,
        COUNT(id)   AS ledger_lines
      FROM fleet_ledger_entries
      WHERE company_id = ${companyId}
        AND period = '${period}'
        AND is_voided = false
        AND source_type <> 'void'
    `));
    const L = ledgerRows[0] as any;

    // ── B. Totals dari accounting_entry_lines (journal layer) ────────────────
    const { rows: journalRows } = await db.execute(sql.raw(`
      SELECT
        SUM(ael.debit::numeric)  AS journal_debit,
        SUM(ael.credit::numeric) AS journal_credit,
        COUNT(ael.id)            AS journal_lines
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      WHERE (ae.company_id = ${companyId} OR ae.company_id IS NULL)
        AND ae.status = 'posted'
        AND ae.date >= '${periodStart}'
        AND ae.date <= '${periodEnd}'
    `));
    const J = journalRows[0] as any;

    // ── C. Payment total dari accounting_payments ────────────────────────────
    const { rows: payRows } = await db.execute(sql.raw(`
      SELECT
        SUM(ap.amount::numeric) AS payment_total,
        COUNT(ap.id)            AS payment_count
      FROM accounting_payments ap
      WHERE (ap.company_id = ${companyId} OR ap.company_id IS NULL)
        AND ap.status = 'posted'
        AND ap.date >= '${periodStart}'
        AND ap.date <= '${periodEnd}'
    `));
    const P = payRows[0] as any;

    // ── D. Per-account mismatch: ledger vs journals ───────────────────────────
    const { rows: mismatchRows } = await db.execute(sql.raw(`
      WITH ledger_by_account AS (
        SELECT account_id, account_code, account_name,
               SUM(debit) AS l_debit, SUM(credit) AS l_credit
        FROM fleet_ledger_entries
        WHERE company_id = ${companyId} AND period = '${period}'
          AND is_voided = false AND source_type <> 'void'
        GROUP BY account_id, account_code, account_name
      ),
      journal_by_account AS (
        SELECT ael.account_id,
               SUM(ael.debit::numeric)  AS j_debit,
               SUM(ael.credit::numeric) AS j_credit
        FROM accounting_entry_lines ael
        JOIN accounting_entries ae ON ae.id = ael.entry_id
        WHERE (ae.company_id = ${companyId} OR ae.company_id IS NULL)
          AND ae.status = 'posted'
          AND ae.date >= '${periodStart}' AND ae.date <= '${periodEnd}'
        GROUP BY ael.account_id
      )
      SELECT
        COALESCE(la.account_id,   ja.account_id)   AS account_id,
        COALESCE(la.account_code, '')               AS account_code,
        COALESCE(la.account_name, '')               AS account_name,
        COALESCE(la.l_debit,  0)::numeric(15,2)    AS ledger_debit,
        COALESCE(la.l_credit, 0)::numeric(15,2)    AS ledger_credit,
        COALESCE(ja.j_debit,  0)::numeric(15,2)    AS journal_debit,
        COALESCE(ja.j_credit, 0)::numeric(15,2)    AS journal_credit,
        ABS(COALESCE(la.l_debit,0) - COALESCE(ja.j_debit,0))::numeric(15,2)   AS debit_diff,
        ABS(COALESCE(la.l_credit,0) - COALESCE(ja.j_credit,0))::numeric(15,2) AS credit_diff
      FROM ledger_by_account   la
      FULL OUTER JOIN journal_by_account ja USING (account_id)
      WHERE ABS(COALESCE(la.l_debit,0) - COALESCE(ja.j_debit,0)) > 0.01
         OR ABS(COALESCE(la.l_credit,0) - COALESCE(ja.j_credit,0)) > 0.01
      ORDER BY account_code
    `));

    // ── E. Compute summary ────────────────────────────────────────────────────
    const lDebit  = Number(L?.ledger_debit  ?? 0);
    const lCredit = Number(L?.ledger_credit ?? 0);
    const jDebit  = Number(J?.journal_debit ?? 0);
    const jCredit = Number(J?.journal_credit ?? 0);
    const debitDiff  = Math.round(Math.abs(lDebit  - jDebit)  * 100) / 100;
    const creditDiff = Math.round(Math.abs(lCredit - jCredit) * 100) / 100;
    const mismatchCount = mismatchRows.length;
    const status = mismatchCount === 0 && debitDiff < 0.01 && creditDiff < 0.01
      ? "clean" : "mismatch";

    // ── F. Simpan report ──────────────────────────────────────────────────────
    const discrepanciesJson = JSON.stringify(mismatchRows).replace(/'/g, "''");
    const { rows: reportRows } = await db.execute(sql.raw(`
      INSERT INTO financial_reconciliation_reports (
        company_id, period, run_at, run_by, status,
        ledger_debit, ledger_credit,
        journal_debit, journal_credit,
        payment_total,
        debit_diff, credit_diff, mismatch_count,
        discrepancies, notes
      ) VALUES (
        ${companyId}, '${period}', NOW(), '${runBy.replace(/'/g, "''")}', '${status}',
        ${lDebit}, ${lCredit},
        ${jDebit}, ${jCredit},
        ${Number(P?.payment_total ?? 0)},
        ${debitDiff}, ${creditDiff}, ${mismatchCount},
        '${discrepanciesJson}'::jsonb,
        ${notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'}
      ) RETURNING *
    `));

    logger.info({ companyId, period, status, mismatchCount }, "[reconciliation] Run completed");
    return res.json({
      report:       reportRows[0],
      discrepancies: mismatchRows,
      summary: {
        status,
        mismatchCount,
        ledger:  { debit: lDebit,  credit: lCredit,  lines: Number(L?.ledger_lines  ?? 0) },
        journal: { debit: jDebit,  credit: jCredit,  lines: Number(J?.journal_lines ?? 0) },
        payment: { total: Number(P?.payment_total ?? 0), count: Number(P?.payment_count ?? 0) },
        diff:    { debit: debitDiff, credit: creditDiff },
      },
    });
  } catch (err) {
    logger.error({ err }, "POST /reconciliation/run failed");
    return res.status(500).json({ message: "Gagal menjalankan rekonsiliasi", detail: String(err) });
  }
});

export default router;
