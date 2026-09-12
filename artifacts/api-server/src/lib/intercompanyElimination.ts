/**
 * INTERCOMPANY ELIMINATION ENGINE — SAP FASE 4
 *
 * RULE:
 *  - IC Receivable ↔ IC Payable: eliminate to zero
 *  - IC Revenue ↔ IC Expense: eliminate duplication
 *  - Output: Consolidated P&L, Balance Sheet, Group Cash Flow
 *
 * Elimination Types:
 *  IC_RECEIVABLE, IC_PAYABLE, IC_REVENUE, IC_EXPENSE, IC_EQUITY
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type EliminationType =
  | "IC_RECEIVABLE"
  | "IC_PAYABLE"
  | "IC_REVENUE"
  | "IC_EXPENSE"
  | "IC_EQUITY"
  | "IC_LOAN"
  | "IC_DIVIDEND";

export interface EliminationRunResult {
  runId: number;
  period: string;
  holdingCompanyId: number;
  eliminatedEntries: number;
  totalEliminated: number;
  breakdown: Record<EliminationType, number>;
  warnings: string[];
}

export interface EliminationEntry {
  companyFromId: number;
  companyToId: number;
  type: EliminationType;
  amount: number;
  description: string;
  debitCoaCode?: string;
  creditCoaCode?: string;
  originalEntryId?: number;
}

// ─── Run Elimination ─────────────────────────────────────────────────────────

export async function runEliminationForPeriod(params: {
  holdingCompanyId: number;
  period: string;
  createdBy?: string;
  notes?: string;
}): Promise<EliminationRunResult> {
  const { holdingCompanyId, period, createdBy = "SYSTEM", notes } = params;
  const warnings: string[] = [];

  // Buat run header
  const { rows: runRows } = await db.execute(sql.raw(`
    INSERT INTO elimination_runs (holding_company_id, period, status, created_by, notes)
    VALUES (${holdingCompanyId}, '${period.replace(/'/g, "")}', 'RUNNING', '${createdBy.replace(/'/g, "")}', ${notes ? `'${notes.replace(/'/g, "''")}'` : "NULL"})
    RETURNING id
  `));
  const runId = Number((runRows[0] as any).id);

  const breakdown: Record<EliminationType, number> = {
    IC_RECEIVABLE: 0,
    IC_PAYABLE: 0,
    IC_REVENUE: 0,
    IC_EXPENSE: 0,
    IC_EQUITY: 0,
    IC_LOAN: 0,
    IC_DIVIDEND: 0,
  };

  const entriesToInsert: EliminationEntry[] = [];

  try {
    // ── 1. Eliminate IC Receivable ↔ IC Payable ─────────────────────────────
    const icArAp = await detectIcReceivablePayable(holdingCompanyId, period);
    for (const item of icArAp) {
      const elim = Math.min(item.receivable, item.payable);
      if (elim > 0) {
        entriesToInsert.push({
          companyFromId: item.companyFromId,
          companyToId:   item.companyToId,
          type:          "IC_RECEIVABLE",
          amount:        elim,
          description:   `Eliminasi IC Piutang ${item.companyFromName} ↔ ${item.companyToName} ${period}`,
          debitCoaCode:  "IC_PAYABLE",
          creditCoaCode: "IC_RECEIVABLE",
        });
        breakdown.IC_RECEIVABLE += elim;

        entriesToInsert.push({
          companyFromId: item.companyToId,
          companyToId:   item.companyFromId,
          type:          "IC_PAYABLE",
          amount:        elim,
          description:   `Eliminasi IC Hutang ${item.companyToName} ↔ ${item.companyFromName} ${period}`,
          debitCoaCode:  "IC_PAYABLE",
          creditCoaCode: "IC_RECEIVABLE",
        });
        breakdown.IC_PAYABLE += elim;

        if (Math.abs(item.receivable - item.payable) > 100) {
          warnings.push(`IC mismatch ${item.companyFromName}↔${item.companyToName}: receivable=${item.receivable}, payable=${item.payable}`);
        }
      }
    }

    // ── 2. Eliminate IC Revenue ↔ IC Expense ────────────────────────────────
    const icRevExp = await detectIcRevenueExpense(holdingCompanyId, period);
    for (const item of icRevExp) {
      const elim = Math.min(item.revenue, item.expense);
      if (elim > 0) {
        entriesToInsert.push({
          companyFromId: item.companyFromId,
          companyToId:   item.companyToId,
          type:          "IC_REVENUE",
          amount:        elim,
          description:   `Eliminasi IC Revenue ${item.companyFromName} → ${item.companyToName} ${period}`,
          debitCoaCode:  "IC_REVENUE",
          creditCoaCode: "IC_EXPENSE",
        });
        breakdown.IC_REVENUE += elim;

        entriesToInsert.push({
          companyFromId: item.companyToId,
          companyToId:   item.companyFromId,
          type:          "IC_EXPENSE",
          amount:        elim,
          description:   `Eliminasi IC Expense ${item.companyToName} ↔ ${item.companyFromName} ${period}`,
          debitCoaCode:  "IC_REVENUE",
          creditCoaCode: "IC_EXPENSE",
        });
        breakdown.IC_EXPENSE += elim;
      }
    }

    // ── 3. Insert semua elimination entries ──────────────────────────────────
    for (const entry of entriesToInsert) {
      await db.execute(sql.raw(`
        INSERT INTO gl_elimination_entries
          (run_id, company_from_id, company_to_id, elimination_type, debit_coa_code, credit_coa_code, amount, description)
        VALUES
          (${runId}, ${entry.companyFromId}, ${entry.companyToId},
           '${entry.type}', ${entry.debitCoaCode ? `'${entry.debitCoaCode}'` : "NULL"},
           ${entry.creditCoaCode ? `'${entry.creditCoaCode}'` : "NULL"},
           ${entry.amount}, '${entry.description.replace(/'/g, "''")}')
      `));
    }

    const totalEliminated = Object.values(breakdown).reduce((a, b) => a + b, 0);

    // Update run status
    await db.execute(sql.raw(`
      UPDATE elimination_runs
      SET status = 'COMPLETED', total_eliminated = ${totalEliminated}
      WHERE id = ${runId}
    `));

    logger.info({ runId, period, holdingCompanyId, totalEliminated, entriesToInsert: entriesToInsert.length },
      "[ic-elimination] Run selesai");

    return {
      runId,
      period,
      holdingCompanyId,
      eliminatedEntries: entriesToInsert.length,
      totalEliminated,
      breakdown,
      warnings,
    };
  } catch (err: any) {
    await db.execute(sql.raw(`
      UPDATE elimination_runs SET status = 'FAILED' WHERE id = ${runId}
    `)).catch(() => {});
    logger.error({ err, runId }, "[ic-elimination] Run gagal");
    throw err;
  }
}

// ─── Reversal ────────────────────────────────────────────────────────────────

export async function reverseEliminationRun(runId: number, actor: string): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE gl_elimination_entries
    SET is_reversed = TRUE, reversed_at = NOW(), reversed_by = '${actor.replace(/'/g, "''")}'
    WHERE run_id = ${runId} AND is_reversed = FALSE
  `));
  await db.execute(sql.raw(`
    UPDATE elimination_runs SET status = 'REVERSED' WHERE id = ${runId}
  `));
  logger.info({ runId, actor }, "[ic-elimination] Run di-reverse");
}

// ─── Consolidated Reports ────────────────────────────────────────────────────

export async function getConsolidatedPnl(holdingCompanyId: number, period: string): Promise<{
  revenue: number;
  expense: number;
  netProfit: number;
  icEliminated: number;
  byCompany: { companyId: number; name: string; revenue: number; expense: number; netProfit: number }[];
}> {
  const { rows: companies } = await db.execute(sql.raw(`
    SELECT id, name FROM companies
    WHERE id = ${holdingCompanyId}
       OR holding_company_id = ${holdingCompanyId}
       OR id IN (
         SELECT company_id FROM companies WHERE holding_company_id = ${holdingCompanyId}
       )
    ORDER BY id
  `));

  const byCompany: { companyId: number; name: string; revenue: number; expense: number; netProfit: number }[] = [];
  let totalRevenue = 0;
  let totalExpense = 0;

  for (const co of companies as any[]) {
    const { rows: pnl } = await db.execute(sql.raw(`
      SELECT
        COALESCE(SUM(CASE WHEN coa.type = 'revenue' THEN ael.credit_amount - ael.debit_amount ELSE 0 END),0)::numeric AS revenue,
        COALESCE(SUM(CASE WHEN coa.type = 'expense' THEN ael.debit_amount - ael.credit_amount ELSE 0 END),0)::numeric AS expense
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      JOIN chart_of_accounts coa ON coa.id = ael.coa_id
      WHERE ae.company_id = ${co.id}
        AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
        AND ae.status = 'posted'
    `));
    const rev = Number((pnl[0] as any)?.revenue ?? 0);
    const exp = Number((pnl[0] as any)?.expense ?? 0);
    byCompany.push({ companyId: co.id, name: co.name, revenue: rev, expense: exp, netProfit: rev - exp });
    totalRevenue += rev;
    totalExpense += exp;
  }

  // IC eliminated amount
  const { rows: elimRows } = await db.execute(sql.raw(`
    SELECT COALESCE(SUM(amount), 0)::numeric AS total
    FROM gl_elimination_entries gee
    JOIN elimination_runs er ON er.id = gee.run_id
    WHERE er.holding_company_id = ${holdingCompanyId}
      AND er.period = '${period.replace(/'/g, "")}'
      AND er.status = 'COMPLETED'
      AND gee.is_reversed = FALSE
      AND gee.elimination_type IN ('IC_REVENUE', 'IC_EXPENSE')
  `));
  const icEliminated = Number((elimRows[0] as any)?.total ?? 0);

  return {
    revenue:     totalRevenue - icEliminated / 2,
    expense:     totalExpense - icEliminated / 2,
    netProfit:   (totalRevenue - totalExpense),
    icEliminated,
    byCompany,
  };
}

export async function getConsolidatedBalanceSheet(holdingCompanyId: number, period: string): Promise<{
  assets: number;
  liabilities: number;
  equity: number;
  icEliminated: number;
}> {
  const { rows: companies } = await db.execute(sql.raw(`
    SELECT id FROM companies
    WHERE id = ${holdingCompanyId}
       OR holding_company_id = ${holdingCompanyId}
    ORDER BY id
  `));

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  for (const co of companies as any[]) {
    const { rows: bs } = await db.execute(sql.raw(`
      SELECT
        COALESCE(SUM(CASE WHEN coa.type='asset'     THEN ael.debit_amount  - ael.credit_amount ELSE 0 END),0)::numeric AS assets,
        COALESCE(SUM(CASE WHEN coa.type='liability' THEN ael.credit_amount - ael.debit_amount  ELSE 0 END),0)::numeric AS liabilities,
        COALESCE(SUM(CASE WHEN coa.type='equity'    THEN ael.credit_amount - ael.debit_amount  ELSE 0 END),0)::numeric AS equity
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae ON ae.id = ael.entry_id
      JOIN chart_of_accounts coa ON coa.id = ael.coa_id
      WHERE ae.company_id = ${co.id}
        AND TO_CHAR(ae.date, 'YYYY-MM') <= '${period.replace(/'/g, "")}'
        AND ae.status = 'posted'
    `));
    totalAssets      += Number((bs[0] as any)?.assets ?? 0);
    totalLiabilities += Number((bs[0] as any)?.liabilities ?? 0);
    totalEquity      += Number((bs[0] as any)?.equity ?? 0);
  }

  const { rows: elimRows } = await db.execute(sql.raw(`
    SELECT COALESCE(SUM(amount), 0)::numeric AS total
    FROM gl_elimination_entries gee
    JOIN elimination_runs er ON er.id = gee.run_id
    WHERE er.holding_company_id = ${holdingCompanyId}
      AND er.period = '${period.replace(/'/g, "")}'
      AND er.status = 'COMPLETED'
      AND gee.is_reversed = FALSE
      AND gee.elimination_type IN ('IC_RECEIVABLE', 'IC_PAYABLE')
  `));
  const icEliminated = Number((elimRows[0] as any)?.total ?? 0);

  return {
    assets:      totalAssets - icEliminated / 2,
    liabilities: totalLiabilities - icEliminated / 2,
    equity:      totalEquity,
    icEliminated,
  };
}

// ─── Detect IC Transactions ──────────────────────────────────────────────────

async function detectIcReceivablePayable(holdingCompanyId: number, period: string) {
  const { rows } = await db.execute(sql.raw(`
    SELECT
      ae.company_id AS company_from_id,
      cf.name       AS company_from_name,
      ae2.company_id AS company_to_id,
      ct.name        AS company_to_name,
      COALESCE(SUM(CASE WHEN coa.code ILIKE '%piutang%antar%' OR coa.name ILIKE '%intercompany%receivable%'
                        THEN ael.debit_amount - ael.credit_amount ELSE 0 END), 0)::numeric AS receivable,
      COALESCE(SUM(CASE WHEN coa.code ILIKE '%hutang%antar%' OR coa.name ILIKE '%intercompany%payable%'
                        THEN ael.credit_amount - ael.debit_amount ELSE 0 END), 0)::numeric AS payable
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    JOIN chart_of_accounts coa ON coa.id = ael.coa_id
    JOIN companies cf ON cf.id = ae.company_id
    LEFT JOIN accounting_entries ae2 ON ae2.id = ael.entry_id AND ae2.company_id != ae.company_id
    LEFT JOIN companies ct ON ct.id = ae2.company_id
    WHERE TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
      AND ae.status = 'posted'
      AND (coa.code ILIKE '%antar%' OR coa.name ILIKE '%intercompany%')
      AND ae.company_id IN (
        SELECT id FROM companies WHERE id = ${holdingCompanyId} OR holding_company_id = ${holdingCompanyId}
      )
    GROUP BY ae.company_id, cf.name, ae2.company_id, ct.name
    HAVING SUM(ael.debit_amount + ael.credit_amount) > 0
  `));

  return (rows as any[]).map((r) => ({
    companyFromId:   Number(r.company_from_id),
    companyFromName: r.company_from_name ?? "?",
    companyToId:     Number(r.company_to_id ?? holdingCompanyId),
    companyToName:   r.company_to_name ?? "?",
    receivable:      Number(r.receivable ?? 0),
    payable:         Number(r.payable ?? 0),
  })).filter((r) => r.receivable > 0 || r.payable > 0);
}

async function detectIcRevenueExpense(holdingCompanyId: number, period: string) {
  const { rows } = await db.execute(sql.raw(`
    SELECT
      ae.company_id  AS company_from_id,
      cf.name        AS company_from_name,
      ae.company_id  AS company_to_id,
      cf.name        AS company_to_name,
      COALESCE(SUM(CASE WHEN coa.type='revenue' AND (coa.name ILIKE '%antar%' OR coa.name ILIKE '%intercompany%')
                        THEN ael.credit_amount - ael.debit_amount ELSE 0 END), 0)::numeric AS revenue,
      COALESCE(SUM(CASE WHEN coa.type='expense' AND (coa.name ILIKE '%antar%' OR coa.name ILIKE '%intercompany%')
                        THEN ael.debit_amount - ael.credit_amount ELSE 0 END), 0)::numeric AS expense
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    JOIN chart_of_accounts coa ON coa.id = ael.coa_id
    JOIN companies cf ON cf.id = ae.company_id
    WHERE TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
      AND ae.status = 'posted'
      AND ae.company_id IN (
        SELECT id FROM companies WHERE id = ${holdingCompanyId} OR holding_company_id = ${holdingCompanyId}
      )
    GROUP BY ae.company_id, cf.name
    HAVING SUM(ael.debit_amount + ael.credit_amount) > 0
  `));

  return (rows as any[]).map((r) => ({
    companyFromId:   Number(r.company_from_id),
    companyFromName: r.company_from_name ?? "?",
    companyToId:     Number(r.company_to_id),
    companyToName:   r.company_to_name ?? "?",
    revenue:         Number(r.revenue ?? 0),
    expense:         Number(r.expense ?? 0),
  })).filter((r) => r.revenue > 0 || r.expense > 0);
}
