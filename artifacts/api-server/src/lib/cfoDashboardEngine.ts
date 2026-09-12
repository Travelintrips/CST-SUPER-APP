/**
 * CFO DASHBOARD ENGINE — SAP FASE 7
 *
 * Real-time financial metrics dari GL layer:
 *  - Cash Balance per company
 *  - Revenue per entity
 *  - Outstanding AR
 *  - Outstanding AP
 *  - Net Profit per company
 *  - Consolidated profit
 *  - IC exposure
 *  - Working Capital
 *  - Quick Ratio
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getArBalance, getApBalance } from "./arApEngine.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CfoDashboardData {
  period: string;
  generatedAt: string;
  companies: CompanyFinancials[];
  consolidated: ConsolidatedFinancials;
  alerts: CfoAlert[];
}

export interface CompanyFinancials {
  companyId: number;
  companyName: string;
  cashBalance: number;
  revenue: number;
  expenses: number;
  netProfit: number;
  netProfitMargin: number;
  outstandingAr: number;
  outstandingAp: number;
  workingCapital: number;
  icExposure: number;
  arAgingBreakdown: ArAgingBreakdown;
}

export interface ConsolidatedFinancials {
  totalRevenue: number;
  totalExpenses: number;
  totalNetProfit: number;
  totalCash: number;
  totalAr: number;
  totalAp: number;
  icEliminated: number;
  netAfterElimination: number;
}

export interface ArAgingBreakdown {
  current: number;
  days30: number;
  days60: number;
  days90: number;
  over90: number;
}

export interface CfoAlert {
  level: "CRITICAL" | "WARNING" | "INFO";
  code: string;
  message: string;
  companyId?: number;
  value?: number;
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export async function buildCfoDashboard(params: {
  holdingCompanyId: number;
  period: string;
  includeConsolidated?: boolean;
}): Promise<CfoDashboardData> {
  const { holdingCompanyId, period } = params;

  const { rows: companiesRows } = await db.execute(sql.raw(`
    SELECT id, name FROM companies
    WHERE id = ${holdingCompanyId}
       OR holding_company_id = ${holdingCompanyId}
    ORDER BY id
  `));
  const companies = companiesRows as any[];

  const alerts: CfoAlert[] = [];
  const companyFinancials: CompanyFinancials[] = [];

  for (const co of companies) {
    const fin = await getCompanyFinancials(Number(co.id), String(co.name), period);
    companyFinancials.push(fin);

    // Auto-alerts
    if (fin.netProfit < 0) {
      alerts.push({
        level: "WARNING",
        code: "NET_LOSS",
        message: `${co.name}: Net loss ${period} = ${formatIDR(fin.netProfit)}`,
        companyId: co.id,
        value: fin.netProfit,
      });
    }
    if (fin.cashBalance < 0) {
      alerts.push({
        level: "CRITICAL",
        code: "NEGATIVE_CASH",
        message: `${co.name}: Cash balance negatif = ${formatIDR(fin.cashBalance)}`,
        companyId: co.id,
        value: fin.cashBalance,
      });
    }
    if (fin.outstandingAr > fin.revenue * 0.5 && fin.revenue > 0) {
      alerts.push({
        level: "WARNING",
        code: "HIGH_AR_RATIO",
        message: `${co.name}: AR outstanding tinggi (${Math.round((fin.outstandingAr / fin.revenue) * 100)}% dari revenue)`,
        companyId: co.id,
        value: fin.outstandingAr,
      });
    }
    if (fin.arAgingBreakdown.over90 > 0) {
      alerts.push({
        level: "WARNING",
        code: "AR_OVERDUE_90",
        message: `${co.name}: AR >90 hari = ${formatIDR(fin.arAgingBreakdown.over90)}`,
        companyId: co.id,
        value: fin.arAgingBreakdown.over90,
      });
    }
  }

  const consolidated = buildConsolidatedFinancials(companyFinancials);

  return {
    period,
    generatedAt: new Date().toISOString(),
    companies: companyFinancials,
    consolidated,
    alerts,
  };
}

// ─── Per-Company Financials ──────────────────────────────────────────────────

async function getCompanyFinancials(
  companyId: number,
  companyName: string,
  period: string,
): Promise<CompanyFinancials> {
  const [cashRow, pnlRow, icRow, arBal, apBal, arAging] = await Promise.all([
    getCashBalance(companyId, period),
    getPnlForPeriod(companyId, period),
    getIcExposure(companyId, period),
    getArBalance(companyId, period).catch(() => ({ totalOpen: 0, totalPartial: 0, totalClosed: 0, totalOverdue: 0, count: 0, companyId })),
    getApBalance(companyId, period).catch(() => ({ totalOpen: 0, totalPartial: 0, totalClosed: 0, totalOverdue: 0, count: 0, companyId })),
    getArAging(companyId),
  ]);

  const outstandingAr = arBal.totalOpen + arBal.totalPartial + arBal.totalOverdue;
  const outstandingAp = apBal.totalOpen + apBal.totalPartial + apBal.totalOverdue;
  const revenue = pnlRow.revenue;
  const expenses = pnlRow.expenses;
  const netProfit = revenue - expenses;

  return {
    companyId,
    companyName,
    cashBalance: cashRow,
    revenue,
    expenses,
    netProfit,
    netProfitMargin: revenue > 0 ? (netProfit / revenue) * 100 : 0,
    outstandingAr,
    outstandingAp,
    workingCapital: cashRow + outstandingAr - outstandingAp,
    icExposure: icRow,
    arAgingBreakdown: arAging,
  };
}

async function getCashBalance(companyId: number, period: string): Promise<number> {
  const { rows } = await db.execute(sql.raw(`
    SELECT COALESCE(SUM(ael.debit_amount - ael.credit_amount), 0)::numeric AS balance
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    JOIN chart_of_accounts coa ON coa.id = ael.coa_id
    WHERE ae.company_id = ${companyId}
      AND TO_CHAR(ae.date, 'YYYY-MM') <= '${period.replace(/'/g, "")}'
      AND ae.status = 'posted'
      AND coa.type = 'asset'
      AND (coa.code ILIKE '1-1%' OR coa.name ILIKE '%kas%' OR coa.name ILIKE '%bank%' OR coa.name ILIKE '%cash%')
  `));
  return Number((rows[0] as any)?.balance ?? 0);
}

async function getPnlForPeriod(companyId: number, period: string): Promise<{ revenue: number; expenses: number }> {
  const { rows } = await db.execute(sql.raw(`
    SELECT
      COALESCE(SUM(CASE WHEN coa.type='revenue' THEN ael.credit_amount - ael.debit_amount ELSE 0 END),0)::numeric AS revenue,
      COALESCE(SUM(CASE WHEN coa.type='expense' THEN ael.debit_amount - ael.credit_amount ELSE 0 END),0)::numeric AS expenses
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    JOIN chart_of_accounts coa ON coa.id = ael.coa_id
    WHERE ae.company_id = ${companyId}
      AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
      AND ae.status = 'posted'
  `));
  return {
    revenue:  Number((rows[0] as any)?.revenue ?? 0),
    expenses: Number((rows[0] as any)?.expenses ?? 0),
  };
}

async function getIcExposure(companyId: number, period: string): Promise<number> {
  const { rows } = await db.execute(sql.raw(`
    SELECT COALESCE(SUM(ABS(ael.debit_amount - ael.credit_amount)), 0)::numeric AS exposure
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    JOIN chart_of_accounts coa ON coa.id = ael.coa_id
    WHERE ae.company_id = ${companyId}
      AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
      AND ae.status = 'posted'
      AND (coa.name ILIKE '%antar%' OR coa.name ILIKE '%intercompany%' OR coa.code ILIKE '%ic%')
  `));
  return Number((rows[0] as any)?.exposure ?? 0);
}

async function getArAging(companyId: number): Promise<ArAgingBreakdown> {
  const { rows } = await db.execute(sql.raw(`
    SELECT
      COALESCE(SUM(CASE WHEN due_date >= CURRENT_DATE THEN outstanding_amount ELSE 0 END),0)::numeric                        AS current,
      COALESCE(SUM(CASE WHEN due_date BETWEEN CURRENT_DATE-30 AND CURRENT_DATE-1 THEN outstanding_amount ELSE 0 END),0)::numeric AS days30,
      COALESCE(SUM(CASE WHEN due_date BETWEEN CURRENT_DATE-60 AND CURRENT_DATE-31 THEN outstanding_amount ELSE 0 END),0)::numeric AS days60,
      COALESCE(SUM(CASE WHEN due_date BETWEEN CURRENT_DATE-90 AND CURRENT_DATE-61 THEN outstanding_amount ELSE 0 END),0)::numeric AS days90,
      COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE-90 THEN outstanding_amount ELSE 0 END),0)::numeric                      AS over90
    FROM ar_subledger
    WHERE company_id = ${companyId}
      AND status NOT IN ('CLOSED', 'CANCELLED')
  `));
  const r = rows[0] as any;
  return {
    current: Number(r?.current ?? 0),
    days30:  Number(r?.days30 ?? 0),
    days60:  Number(r?.days60 ?? 0),
    days90:  Number(r?.days90 ?? 0),
    over90:  Number(r?.over90 ?? 0),
  };
}

// ─── Consolidated ─────────────────────────────────────────────────────────────

function buildConsolidatedFinancials(companies: CompanyFinancials[]): ConsolidatedFinancials {
  const totalRevenue  = companies.reduce((s, c) => s + c.revenue, 0);
  const totalExpenses = companies.reduce((s, c) => s + c.expenses, 0);
  const totalCash     = companies.reduce((s, c) => s + c.cashBalance, 0);
  const totalAr       = companies.reduce((s, c) => s + c.outstandingAr, 0);
  const totalAp       = companies.reduce((s, c) => s + c.outstandingAp, 0);
  const icEliminated  = companies.reduce((s, c) => s + c.icExposure, 0);

  return {
    totalRevenue,
    totalExpenses,
    totalNetProfit:      totalRevenue - totalExpenses,
    totalCash,
    totalAr,
    totalAp,
    icEliminated,
    netAfterElimination: (totalRevenue - totalExpenses) - icEliminated,
  };
}

// ─── Revenue Trend ───────────────────────────────────────────────────────────

export async function getRevenueTrend(companyId: number, months: number = 12): Promise<
  { period: string; revenue: number; expenses: number; netProfit: number }[]
> {
  const { rows } = await db.execute(sql.raw(`
    SELECT
      TO_CHAR(ae.date, 'YYYY-MM') AS period,
      COALESCE(SUM(CASE WHEN coa.type='revenue' THEN ael.credit_amount - ael.debit_amount ELSE 0 END),0)::numeric AS revenue,
      COALESCE(SUM(CASE WHEN coa.type='expense' THEN ael.debit_amount - ael.credit_amount ELSE 0 END),0)::numeric AS expenses
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    JOIN chart_of_accounts coa ON coa.id = ael.coa_id
    WHERE ae.company_id = ${companyId}
      AND ae.status = 'posted'
      AND ae.date >= CURRENT_DATE - INTERVAL '${months} months'
    GROUP BY TO_CHAR(ae.date, 'YYYY-MM')
    ORDER BY period
  `));
  return (rows as any[]).map((r) => ({
    period:    r.period,
    revenue:   Number(r.revenue),
    expenses:  Number(r.expenses),
    netProfit: Number(r.revenue) - Number(r.expenses),
  }));
}

// ─── Cash Flow ───────────────────────────────────────────────────────────────

export async function getCashFlowStatement(companyId: number, period: string): Promise<{
  operating: number;
  investing: number;
  financing: number;
  netCashFlow: number;
}> {
  const { rows } = await db.execute(sql.raw(`
    SELECT
      COALESCE(SUM(CASE WHEN ae.source IN ('sales_payment','sales_invoice','ecommerce_order','pos_sale')
                        THEN ael.debit_amount - ael.credit_amount ELSE 0 END),0)::numeric AS operating,
      COALESCE(SUM(CASE WHEN ae.source IN ('stock_received','grn_receipt','wh_transfer')
                        THEN ael.debit_amount - ael.credit_amount ELSE 0 END),0)::numeric AS investing,
      COALESCE(SUM(CASE WHEN ae.source IN ('manual_payment','purchase_payment')
                        THEN ael.debit_amount - ael.credit_amount ELSE 0 END),0)::numeric AS financing
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    JOIN chart_of_accounts coa ON coa.id = ael.coa_id
    WHERE ae.company_id = ${companyId}
      AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
      AND ae.status = 'posted'
      AND coa.type = 'asset'
      AND (coa.name ILIKE '%kas%' OR coa.name ILIKE '%bank%' OR coa.name ILIKE '%cash%')
  `));
  const r = rows[0] as any;
  const operating  = Number(r?.operating ?? 0);
  const investing  = Number(r?.investing ?? 0);
  const financing  = Number(r?.financing ?? 0);
  return { operating, investing, financing, netCashFlow: operating + investing + financing };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatIDR(val: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(val);
}
