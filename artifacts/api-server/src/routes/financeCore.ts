/**
 * FINANCE CORE ROUTE — SAP-like Finance Core API
 *
 * Endpoints:
 *
 * GL Layer:
 *  GET  /api/finance-core/gl/bridge              — GL journal bridge entries
 *  GET  /api/finance-core/gl/trial-balance        — Trial balance per period
 *  POST /api/finance-core/gl/sync-bridge          — Sync accounting_entries → gl_journal_bridge
 *
 * AR/AP Subledger:
 *  GET  /api/finance-core/ar                      — AR subledger list
 *  POST /api/finance-core/ar                      — Create AR entry
 *  POST /api/finance-core/ar/:id/payment          — Apply AR payment
 *  GET  /api/finance-core/ar/balance              — AR balance summary
 *  POST /api/finance-core/ar/sync                 — Sync AR dari sales_documents
 *  GET  /api/finance-core/ap                      — AP subledger list
 *  POST /api/finance-core/ap                      — Create AP entry
 *  POST /api/finance-core/ap/:id/payment          — Apply AP payment
 *  GET  /api/finance-core/ap/balance              — AP balance summary
 *  POST /api/finance-core/ap/sync                 — Sync AP dari purchase_documents
 *  GET  /api/finance-core/subledger/validate      — GL-subledger match check
 *
 * Fiscal Period (extends existing /api/accounting/periods):
 *  GET  /api/finance-core/fiscal-periods          — All fiscal periods
 *  POST /api/finance-core/fiscal-periods/close    — Close a period (admin)
 *  POST /api/finance-core/fiscal-periods/reopen   — Re-open a period (admin)
 *
 * IC Elimination:
 *  GET  /api/finance-core/elimination/runs        — List elimination runs
 *  POST /api/finance-core/elimination/run         — Run IC elimination
 *  POST /api/finance-core/elimination/:runId/reverse — Reverse a run
 *  GET  /api/finance-core/elimination/:runId/entries — Elimination entries
 *  GET  /api/finance-core/reports/consolidated-pnl
 *  GET  /api/finance-core/reports/consolidated-bs
 *
 * Journal Reversal:
 *  GET  /api/finance-core/journals/reversible     — Journals eligible for reversal
 *  POST /api/finance-core/journals/:entryId/reverse — Create reversal entry
 *
 * CFO Dashboard:
 *  GET  /api/finance-core/cfo/dashboard           — Full CFO dashboard
 *  GET  /api/finance-core/cfo/revenue-trend       — Revenue trend N months
 *  GET  /api/finance-core/cfo/cash-flow           — Cash flow statement
 *
 * Tax Engine:
 *  GET  /api/finance-core/tax/summary             — Withholding tax summary
 *  GET  /api/finance-core/tax/lines               — Tax lines list
 *  POST /api/finance-core/tax/compute-pph23       — Compute PPh 23
 *  POST /api/finance-core/tax/auto-map/:entryId   — Auto-map journal → tax lines
 *  PATCH /api/finance-core/tax/mark-reported      — Mark tax lines as reported
 *
 * Data Integrity:
 *  GET  /api/finance-core/integrity/check         — Full integrity check
 *  POST /api/finance-core/integrity/mark-overdue  — Mark overdue AR/AP
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { logger } from "../lib/logger.js";
import {
  upsertArEntry, applyArPayment, getArBalance,
  upsertApEntry, applyApPayment, getApBalance,
  validateSubledgerGlMatch, syncArFromSalesDocs, syncApFromPurchaseDocs,
  markOverdueAr, markOverdueAp,
} from "../lib/arApEngine.js";
import {
  runEliminationForPeriod, reverseEliminationRun,
  getConsolidatedPnl, getConsolidatedBalanceSheet,
} from "../lib/intercompanyElimination.js";
import {
  buildCfoDashboard, getRevenueTrend, getCashFlowStatement,
} from "../lib/cfoDashboardEngine.js";
import {
  computePph23, createTaxLine, autoMapJournalTax,
  getWithholdingTaxSummary, markTaxLinesReported, getTaxLinesForPeriod,
  type TaxType,
} from "../lib/taxEngineCore.js";

const router = Router();

function resolveCompanyId(req: any): number {
  const n = Number(req.query.companyId ?? req.query.company_id ?? req.body?.companyId ?? 0);
  return (n > 0 ? n : null) ?? 1;
}
function requireCompanyId(req: any, res: any): number | null {
  const n = Number(req.query.companyId ?? req.query.company_id ?? req.body?.companyId ?? 0);
  return n > 0 ? n : null;
}

function requireAdminMiddleware(req: any, res: any, next: any) {
  requireAdmin(req, res).then((ok: boolean) => { if (ok) next(); });
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ════════════════════════════════════════════════════════════════════════════
// GL BRIDGE LAYER
// ════════════════════════════════════════════════════════════════════════════

router.get("/gl/bridge", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.query.period ?? currentPeriod());
  const limit = Math.min(Number(req.query.limit ?? 500), 2000);
  const offset = Number(req.query.offset ?? 0);
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT gjb.*, ae.entry_number, ae.description, ae.status, ae.source,
             ae.date, ae.entry_number
      FROM gl_journal_bridge gjb
      JOIN accounting_entries ae ON ae.id = gjb.accounting_entry_id
      WHERE gjb.company_id = ${companyId}
        AND gjb.gl_period = '${period.replace(/'/g, "")}'
      ORDER BY ae.date DESC, gjb.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `));
    return res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "GET /gl/bridge failed");
    return res.status(500).json({ error: "Gagal mengambil GL bridge" });
  }
});

router.get("/gl/trial-balance", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.query.period ?? currentPeriod());
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT
        coa.code,
        coa.name,
        coa.type,
        COALESCE(SUM(ael.debit_amount), 0)::numeric  AS total_debit,
        COALESCE(SUM(ael.credit_amount), 0)::numeric AS total_credit,
        COALESCE(SUM(ael.debit_amount - ael.credit_amount), 0)::numeric AS balance
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      JOIN chart_of_accounts coa ON coa.id = ael.coa_id
      WHERE ae.company_id = ${companyId}
        AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
        AND ae.status = 'posted'
      GROUP BY coa.code, coa.name, coa.type
      ORDER BY coa.code
    `));
    const totalDebit  = (rows as any[]).reduce((s, r) => s + Number(r.total_debit), 0);
    const totalCredit = (rows as any[]).reduce((s, r) => s + Number(r.total_credit), 0);
    return res.json({
      period,
      companyId,
      accounts: rows,
      totals: { totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 1 },
    });
  } catch (err: any) {
    logger.error({ err }, "GET /gl/trial-balance failed");
    return res.status(500).json({ error: "Gagal membuat trial balance" });
  }
});

router.post("/gl/sync-bridge", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.body?.period ?? currentPeriod());
  try {
    const { rows: entries } = await db.execute(sql.raw(`
      SELECT ae.id, TO_CHAR(ae.date, 'YYYY-MM') AS gl_period,
             CASE
               WHEN ae.source ILIKE '%sales%'    THEN 'SA'
               WHEN ae.source ILIKE '%purchase%' THEN 'KR'
               WHEN ae.source ILIKE '%payment%'  THEN 'ZP'
               WHEN ae.source = 'reversal'       THEN 'AB'
               ELSE 'SA'
             END AS gl_doc_type
      FROM accounting_entries ae
      LEFT JOIN gl_journal_bridge gjb ON gjb.accounting_entry_id = ae.id
      WHERE ae.company_id = ${companyId}
        AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
        AND ae.status = 'posted'
        AND gjb.id IS NULL
      LIMIT 1000
    `));

    let synced = 0;
    for (const row of entries as any[]) {
      await db.execute(sql.raw(`
        INSERT INTO gl_journal_bridge (company_id, accounting_entry_id, gl_doc_type, gl_period)
        VALUES (${companyId}, ${row.id}, '${row.gl_doc_type}', '${row.gl_period}')
        ON CONFLICT (accounting_entry_id) DO NOTHING
      `)).catch(() => {});
      synced++;
    }
    return res.json({ synced, period });
  } catch (err: any) {
    logger.error({ err }, "POST /gl/sync-bridge failed");
    return res.status(500).json({ error: "Gagal sync GL bridge" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// AR SUBLEDGER
// ════════════════════════════════════════════════════════════════════════════

router.get("/ar", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = req.query.period as string | undefined;
  const status = req.query.status as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 100), 1000);
  const offset = Number(req.query.offset ?? 0);

  const conditions: string[] = [`company_id = ${companyId}`];
  if (period) conditions.push(`period = '${period.replace(/'/g, "")}'`);
  if (status) conditions.push(`status = '${status.replace(/'/g, "")}'`);

  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT ar.*, c.name AS customer_name
      FROM ar_subledger ar
      LEFT JOIN customers c ON c.id = ar.customer_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ar.due_date ASC NULLS LAST, ar.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `));
    return res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "GET /ar failed");
    return res.status(500).json({ error: "Gagal mengambil AR subledger" });
  }
});

router.get("/ar/balance", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = req.query.period as string | undefined;
  try {
    const balance = await getArBalance(companyId, period);
    return res.json(balance);
  } catch (err: any) {
    return res.status(500).json({ error: "Gagal mengambil AR balance" });
  }
});

router.post("/ar", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  try {
    const id = await upsertArEntry({ companyId, ...req.body });
    return res.status(201).json({ id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/ar/:id/payment", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const arId = Number(req.params.id);
  if (isNaN(arId)) return res.status(400).json({ error: "ID tidak valid" });
  const { paidAmount } = req.body as { paidAmount: number };
  if (!paidAmount || paidAmount <= 0) return res.status(400).json({ error: "paidAmount harus > 0" });
  try {
    // IDOR guard — verify AR record ownership before applying payment
    const { rows: _ar } = await db.execute(sql.raw(
      `SELECT company_id FROM ar_subledger WHERE id = ${arId}`
    ));
    if (!_ar.length) return res.status(404).json({ error: "AR entry tidak ditemukan" });
    if (!await assertCompanyAccess(Number((_ar[0] as any).company_id), companyId, req, res, {
      resourceType: "ar_subledger", resourceId: arId,
    })) return;

    const result = await applyArPayment({ companyId, arId, paidAmount });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/ar/sync", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.body?.period ?? currentPeriod());
  try {
    const synced = await syncArFromSalesDocs(companyId, period);
    return res.json({ synced, period });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// AP SUBLEDGER
// ════════════════════════════════════════════════════════════════════════════

router.get("/ap", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = req.query.period as string | undefined;
  const status = req.query.status as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 100), 1000);
  const offset = Number(req.query.offset ?? 0);

  const conditions: string[] = [`company_id = ${companyId}`];
  if (period) conditions.push(`period = '${period.replace(/'/g, "")}'`);
  if (status) conditions.push(`status = '${status.replace(/'/g, "")}'`);

  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT ap.*, s.name AS vendor_name
      FROM ap_subledger ap
      LEFT JOIN suppliers s ON s.id = ap.vendor_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ap.due_date ASC NULLS LAST, ap.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `));
    return res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "GET /ap failed");
    return res.status(500).json({ error: "Gagal mengambil AP subledger" });
  }
});

router.get("/ap/balance", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = req.query.period as string | undefined;
  try {
    const balance = await getApBalance(companyId, period);
    return res.json(balance);
  } catch (err: any) {
    return res.status(500).json({ error: "Gagal mengambil AP balance" });
  }
});

router.post("/ap", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  try {
    const id = await upsertApEntry({ companyId, ...req.body });
    return res.status(201).json({ id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/ap/:id/payment", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const apId = Number(req.params.id);
  if (isNaN(apId)) return res.status(400).json({ error: "ID tidak valid" });
  const { paidAmount } = req.body as { paidAmount: number };
  if (!paidAmount || paidAmount <= 0) return res.status(400).json({ error: "paidAmount harus > 0" });
  try {
    // IDOR guard — verify AP record ownership before applying payment
    const { rows: _ap } = await db.execute(sql.raw(
      `SELECT company_id FROM ap_subledger WHERE id = ${apId}`
    ));
    if (!_ap.length) return res.status(404).json({ error: "AP entry tidak ditemukan" });
    if (!await assertCompanyAccess(Number((_ap[0] as any).company_id), companyId, req, res, {
      resourceType: "ap_subledger", resourceId: apId,
    })) return;

    const result = await applyApPayment({ companyId, apId, paidAmount });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/ap/sync", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.body?.period ?? currentPeriod());
  try {
    const synced = await syncApFromPurchaseDocs(companyId, period);
    return res.json({ synced, period });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/subledger/validate", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.query.period ?? currentPeriod());
  try {
    const result = await validateSubledgerGlMatch(companyId, period);
    return res.json({ companyId, period, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// FISCAL PERIODS (extended from /api/accounting/periods)
// ════════════════════════════════════════════════════════════════════════════

router.get("/fiscal-periods", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const year = req.query.year ? Number(req.query.year) : null;
  try {
    const yearFilter = year ? `AND year = ${year}` : "";
    const { rows } = await db.execute(sql.raw(`
      SELECT *,
             CASE WHEN is_closed THEN 'CLOSED' ELSE 'OPEN' END AS status
      FROM financial_periods
      WHERE company_id = ${companyId} ${yearFilter}
      ORDER BY year DESC, month DESC
    `));
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: "Gagal mengambil fiscal periods" });
  }
});

router.post("/fiscal-periods/close", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { year, month } = req.body as { year: number; month: number };
  const actor = (req as any).user?.email ?? "admin";
  if (!year || !month) return res.status(400).json({ error: "year dan month wajib" });
  try {
    const { rows } = await db.execute(sql.raw(`
      UPDATE financial_periods
      SET is_closed = TRUE, closed_at = NOW(), closed_by = '${actor.replace(/'/g, "''")}'
      WHERE company_id = ${companyId} AND year = ${year} AND month = ${month}
      RETURNING *
    `));
    if (!rows.length) {
      const { rows: inserted } = await db.execute(sql.raw(`
        INSERT INTO financial_periods (company_id, year, month, is_closed, closed_at, closed_by)
        VALUES (${companyId}, ${year}, ${month}, TRUE, NOW(), '${actor.replace(/'/g, "''")}')
        ON CONFLICT (company_id, month, year) DO UPDATE
          SET is_closed = TRUE, closed_at = NOW(), closed_by = EXCLUDED.closed_by
        RETURNING *
      `));
      return res.json(inserted[0]);
    }
    logger.info({ companyId, year, month, actor }, "[finance-core] Period closed");
    return res.json(rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/fiscal-periods/reopen", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { year, month } = req.body as { year: number; month: number };
  const actor = (req as any).user?.email ?? "admin";
  if (!year || !month) return res.status(400).json({ error: "year dan month wajib" });
  try {
    const { rows } = await db.execute(sql.raw(`
      UPDATE financial_periods
      SET is_closed = FALSE, closed_at = NULL, closed_by = NULL
      WHERE company_id = ${companyId} AND year = ${year} AND month = ${month}
      RETURNING *
    `));
    if (!rows.length) return res.status(404).json({ error: "Period tidak ditemukan" });
    logger.info({ companyId, year, month, actor }, "[finance-core] Period re-opened");
    return res.json(rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// INTERCOMPANY ELIMINATION
// ════════════════════════════════════════════════════════════════════════════

router.get("/elimination/runs", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = req.query.period as string | undefined;
  try {
    const periodFilter = period ? `AND period = '${period.replace(/'/g, "")}'` : "";
    const { rows } = await db.execute(sql.raw(`
      SELECT * FROM elimination_runs
      WHERE holding_company_id = ${companyId} ${periodFilter}
      ORDER BY run_date DESC
      LIMIT 100
    `));
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: "Gagal mengambil elimination runs" });
  }
});

router.post("/elimination/run", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period, notes } = req.body as { period?: string; notes?: string };
  const actor = (req as any).user?.email ?? "admin";
  const targetPeriod = period ?? currentPeriod();
  try {
    const result = await runEliminationForPeriod({
      holdingCompanyId: companyId,
      period: targetPeriod,
      createdBy: actor,
      notes,
    });
    return res.status(201).json(result);
  } catch (err: any) {
    logger.error({ err }, "POST /elimination/run failed");
    return res.status(500).json({ error: err.message });
  }
});

router.post("/elimination/:runId/reverse", requireAdminMiddleware, async (req, res) => {
  const runId = Number(req.params.runId);
  const actor = (req as any).user?.email ?? "admin";
  if (isNaN(runId)) return res.status(400).json({ error: "runId tidak valid" });
  try {
    await reverseEliminationRun(runId, actor);
    return res.json({ ok: true, runId, reversedBy: actor });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/elimination/:runId/entries", requireAdminMiddleware, async (req, res) => {
  const runId = Number(req.params.runId);
  if (isNaN(runId)) return res.status(400).json({ error: "runId tidak valid" });
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT gee.*, 
             cf.name AS company_from_name,
             ct.name AS company_to_name
      FROM gl_elimination_entries gee
      LEFT JOIN companies cf ON cf.id = gee.company_from_id
      LEFT JOIN companies ct ON ct.id = gee.company_to_id
      WHERE gee.run_id = ${runId}
      ORDER BY gee.id
    `));
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: "Gagal mengambil elimination entries" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CONSOLIDATED REPORTS
// ════════════════════════════════════════════════════════════════════════════

router.get("/reports/consolidated-pnl", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.query.period ?? currentPeriod());
  try {
    const result = await getConsolidatedPnl(companyId, period);
    return res.json({ period, ...result });
  } catch (err: any) {
    logger.error({ err }, "GET /reports/consolidated-pnl failed");
    return res.status(500).json({ error: err.message });
  }
});

router.get("/reports/consolidated-bs", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.query.period ?? currentPeriod());
  try {
    const result = await getConsolidatedBalanceSheet(companyId, period);
    return res.json({ period, ...result });
  } catch (err: any) {
    logger.error({ err }, "GET /reports/consolidated-bs failed");
    return res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// JOURNAL REVERSAL
// ════════════════════════════════════════════════════════════════════════════

router.get("/journals/reversible", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = req.query.period as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  try {
    const periodFilter = period
      ? `AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'`
      : "";
    const { rows } = await db.execute(sql.raw(`
      SELECT ae.id, ae.entry_number, ae.date, ae.description, ae.source,
             ae.total_debit, ae.total_credit, ae.is_locked,
             COUNT(ael.id)::int AS line_count,
             EXISTS (
               SELECT 1 FROM accounting_entries rev
               WHERE rev.source = 'reversal'
                 AND (rev.description ILIKE '%VOID%' || ae.entry_number || '%'
                   OR rev.description ILIKE '%' || ae.id::text || '%')
             ) AS already_reversed
      FROM accounting_entries ae
      LEFT JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      WHERE ae.company_id = ${companyId}
        AND ae.status = 'posted'
        AND ae.source != 'reversal'
        ${periodFilter}
      GROUP BY ae.id, ae.entry_number, ae.date, ae.description,
               ae.source, ae.total_debit, ae.total_credit, ae.is_locked
      ORDER BY ae.date DESC
      LIMIT ${limit}
    `));
    return res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "GET /journals/reversible failed");
    return res.status(500).json({ error: "Gagal mengambil journal list" });
  }
});

router.post("/journals/:entryId/reverse", requireAdminMiddleware, async (req, res) => {
  const entryId = Number(req.params.entryId);
  const companyId = resolveCompanyId(req);
  const actor = (req as any).user?.email ?? "admin";
  const { reason } = req.body as { reason?: string };
  if (isNaN(entryId)) return res.status(400).json({ error: "entryId tidak valid" });
  try {
    const { rows: orig } = await db.execute(sql.raw(`
      SELECT ae.*, json_agg(
        json_build_object(
          'coa_id', ael.coa_id,
          'debit_amount', ael.debit_amount,
          'credit_amount', ael.credit_amount,
          'description', ael.description,
          'cost_center_id', ael.cost_center_id
        )
      ) AS lines
      FROM accounting_entries ae
      LEFT JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      WHERE ae.id = ${entryId}
        AND ae.company_id = ${companyId}
        AND ae.status = 'posted'
      GROUP BY ae.id
    `));

    if (!orig.length) return res.status(404).json({ error: "Entry tidak ditemukan atau belum posted" });
    const origEntry = orig[0] as any;
    const origLines = (origEntry.lines ?? []) as any[];

    // Cek fiscal period entry asal
    const entryDate = new Date(origEntry.date);
    const entryPeriod = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, "0")}`;
    const { rows: periodRows } = await db.execute(sql.raw(`
      SELECT is_closed FROM financial_periods
      WHERE company_id = ${companyId}
        AND year  = ${entryDate.getFullYear()}
        AND month = ${entryDate.getMonth() + 1}
    `));
    const isClosed = (periodRows[0] as any)?.is_closed ?? false;
    const today = new Date();
    const reversalDate = isClosed
      ? today.toISOString().slice(0, 10)  // pakai tanggal hari ini jika period sudah CLOSED
      : origEntry.date;

    // Buat reversal lines (100% opposite)
    const reversalLines = origLines.map((l: any) => ({
      coaId: l.coa_id,
      debitAmount:  Number(l.credit_amount ?? 0),
      creditAmount: Number(l.debit_amount ?? 0),
      description: `[REVERSAL] ${l.description ?? ""}`.trim(),
      costCenterId: l.cost_center_id ?? null,
    }));

    if (!reversalLines.length) return res.status(400).json({ error: "Entry tidak memiliki jurnal lines" });

    const totalRev = reversalLines.reduce((s: number, l: any) => s + l.debitAmount, 0);

    const { rows: newEntry } = await db.execute(sql.raw(`
      INSERT INTO accounting_entries
        (company_id, journal_id, date, description, source, status,
         total_debit, total_credit, created_by, created_at)
      VALUES
        (${companyId},
         ${origEntry.journal_id ?? "NULL"},
         '${reversalDate}',
         '[REVERSAL] ${(reason ?? `Reversal of ${origEntry.entry_number ?? entryId}`).replace(/'/g, "''")}',
         'reversal', 'posted',
         ${totalRev}, ${totalRev},
         '${actor.replace(/'/g, "''")}',
         NOW())
      RETURNING id, entry_number
    `));
    const reversalEntryId = Number((newEntry[0] as any).id);

    for (const line of reversalLines) {
      await db.execute(sql.raw(`
        INSERT INTO accounting_entry_lines
          (entry_id, coa_id, debit_amount, credit_amount, description, cost_center_id)
        VALUES
          (${reversalEntryId}, ${line.coaId}, ${line.debitAmount}, ${line.creditAmount},
           ${line.description ? `'${line.description.replace(/'/g, "''")}'` : "NULL"},
           ${line.costCenterId ?? "NULL"})
      `));
    }

    logger.info({ reversalEntryId, originalEntryId: entryId, actor }, "[finance-core] Reversal created");

    return res.status(201).json({
      ok: true,
      reversalEntryId,
      originalEntryId: entryId,
      reversalDate,
      periodWasClosed: isClosed,
    });
  } catch (err: any) {
    logger.error({ err, entryId }, "POST /journals/:entryId/reverse failed");
    return res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CFO DASHBOARD
// ════════════════════════════════════════════════════════════════════════════

router.get("/cfo/dashboard", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.query.period ?? currentPeriod());
  try {
    const data = await buildCfoDashboard({ holdingCompanyId: companyId, period });
    return res.json(data);
  } catch (err: any) {
    logger.error({ err }, "GET /cfo/dashboard failed");
    return res.status(500).json({ error: err.message });
  }
});

router.get("/cfo/revenue-trend", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const months = Math.min(Number(req.query.months ?? 12), 36);
  try {
    const data = await getRevenueTrend(companyId, months);
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/cfo/cash-flow", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.query.period ?? currentPeriod());
  try {
    const data = await getCashFlowStatement(companyId, period);
    return res.json({ period, companyId, ...data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// TAX ENGINE
// ════════════════════════════════════════════════════════════════════════════

router.get("/tax/summary", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.query.period ?? currentPeriod());
  try {
    const summary = await getWithholdingTaxSummary(companyId, period);
    return res.json({ period, companyId, ...summary });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/tax/lines", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.query.period ?? currentPeriod());
  const taxType = req.query.taxType as TaxType | undefined;
  try {
    const lines = await getTaxLinesForPeriod(companyId, period, taxType);
    return res.json(lines);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/tax/compute-pph23", requireAdminMiddleware, (req, res) => {
  const { grossAmount, serviceCategory, hasNpwp, taxpayerName, taxpayerNpwp } = req.body as any;
  if (!grossAmount || !serviceCategory) {
    return res.status(400).json({ error: "grossAmount dan serviceCategory wajib" });
  }
  try {
    const result = computePph23({ grossAmount, serviceCategory, hasNpwp: !!hasNpwp, taxpayerName, taxpayerNpwp });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/tax/auto-map/:entryId", requireAdminMiddleware, async (req, res) => {
  const entryId = Number(req.params.entryId);
  const companyId = resolveCompanyId(req);
  const period = String(req.body?.period ?? currentPeriod());
  if (isNaN(entryId)) return res.status(400).json({ error: "entryId tidak valid" });
  try {
    const result = await autoMapJournalTax({ companyId, accountingEntryId: entryId, period });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch("/tax/mark-reported", requireAdminMiddleware, async (req, res) => {
  const { ids } = req.body as { ids: number[] };
  if (!ids?.length) return res.status(400).json({ error: "ids wajib diisi" });
  try {
    await markTaxLinesReported(ids);
    return res.json({ ok: true, marked: ids.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// DATA INTEGRITY
// ════════════════════════════════════════════════════════════════════════════

router.get("/integrity/check", requireAdminMiddleware, async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = String(req.query.period ?? currentPeriod());
  const issues: string[] = [];

  try {
    // 1. Trial balance check (debit = credit)
    const { rows: tbRows } = await db.execute(sql.raw(`
      SELECT
        COALESCE(SUM(ael.debit_amount), 0)::numeric  AS total_debit,
        COALESCE(SUM(ael.credit_amount), 0)::numeric AS total_credit
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      WHERE ae.company_id = ${companyId}
        AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
        AND ae.status = 'posted'
    `));
    const totalDebit  = Number((tbRows[0] as any)?.total_debit ?? 0);
    const totalCredit = Number((tbRows[0] as any)?.total_credit ?? 0);
    const trialBalanced = Math.abs(totalDebit - totalCredit) < 1;
    if (!trialBalanced) issues.push(`Trial balance tidak seimbang: debit=${totalDebit}, credit=${totalCredit}, diff=${Math.abs(totalDebit - totalCredit)}`);

    // 2. Subledger match
    const slMatch = await validateSubledgerGlMatch(companyId, period).catch(() => null);
    if (slMatch && !slMatch.arGlMatch) issues.push(...slMatch.details.filter((d) => d.startsWith("AR")));
    if (slMatch && !slMatch.apGlMatch) issues.push(...slMatch.details.filter((d) => d.startsWith("AP")));

    // 3. Posting without fiscal period
    const { rows: noPeriod } = await db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM accounting_entries ae
      LEFT JOIN financial_periods fp
        ON fp.company_id = ae.company_id
        AND fp.year  = EXTRACT(YEAR  FROM ae.date)
        AND fp.month = EXTRACT(MONTH FROM ae.date)
      WHERE ae.company_id = ${companyId}
        AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
        AND ae.status = 'posted'
        AND fp.id IS NULL
    `));
    const missingPeriod = Number((noPeriod[0] as any)?.cnt ?? 0);
    if (missingPeriod > 0) issues.push(`${missingPeriod} entries posted tanpa fiscal period record`);

    // 4. Unlocked entries
    const { rows: unlocked } = await db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM accounting_entries ae
      WHERE ae.company_id = ${companyId}
        AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
        AND ae.status = 'posted'
        AND (ae.is_locked = FALSE OR ae.is_locked IS NULL)
    `));
    const unlockedCount = Number((unlocked[0] as any)?.cnt ?? 0);
    if (unlockedCount > 0) issues.push(`${unlockedCount} entries posted tapi belum di-lock (integrity risk)`);

    // 5. Entries di period CLOSED
    const { rows: closedPeriod } = await db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM accounting_entries ae
      JOIN financial_periods fp
        ON fp.company_id = ae.company_id
        AND fp.year  = EXTRACT(YEAR  FROM ae.date)
        AND fp.month = EXTRACT(MONTH FROM ae.date)
      WHERE ae.company_id = ${companyId}
        AND ae.status = 'posted'
        AND fp.is_closed = TRUE
        AND ae.source != 'reversal'
        AND ae.created_at > fp.closed_at
    `));
    const postAfterClose = Number((closedPeriod[0] as any)?.cnt ?? 0);
    if (postAfterClose > 0) issues.push(`${postAfterClose} entries diposting setelah period di-close (violation)`);

    return res.json({
      period,
      companyId,
      ok: issues.length === 0,
      trialBalanced,
      totalDebit,
      totalCredit,
      issues,
      checks: {
        trialBalance: trialBalanced,
        subledgerMatch: slMatch ? (slMatch.arGlMatch && slMatch.apGlMatch) : null,
        allPeriodRecorded: missingPeriod === 0,
        allLocked: unlockedCount === 0,
        noPostAfterClose: postAfterClose === 0,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "GET /integrity/check failed");
    return res.status(500).json({ error: err.message });
  }
});

router.post("/integrity/mark-overdue", requireAdminMiddleware, async (req, res) => {
  try {
    const [arCount, apCount] = await Promise.all([markOverdueAr(), markOverdueAp()]);
    return res.json({ ok: true, arMarked: arCount, apMarked: apCount });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
