/**
 * Liquidity Engine — Batch 4 Phase 5
 *
 * Documented formulas:
 *
 * Quick Ratio             = (Cash + AR) / Current Liabilities
 *                           Measures short-term solvency without inventory.
 *
 * Current Ratio           = Current Assets / Current Liabilities
 *                           Broad short-term liquidity.
 *
 * Cash Coverage           = Cash / (Monthly Expenses / 30)
 *                           Days of expenses covered by cash.
 *
 * Operating Cash Coverage = Operating Cash Flow (30d) / Monthly Expenses
 *                           Self-sufficiency of operations.
 *
 * Collection Efficiency   = (Collected_30d / Invoiced_30d) × 100 (%)
 *                           How well AR is converted to cash.
 *
 * Payment Efficiency      = (Paid on time_30d / Total Payable_30d) × 100 (%)
 *                           Vendor payment discipline.
 *
 * DSO (Days Sales Outstanding)
 *                         = (Outstanding AR / Revenue_30d) × 30
 *                           Average days to collect receivables.
 *
 * DPO (Days Payable Outstanding)
 *                         = (Outstanding AP / Expenses_30d) × 30
 *                           Average days to pay vendors.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { LiquidityMetrics, TreasuryQueryParams } from "./types.js";
import { treasuryCache, CK, TREASURY_TTL } from "./treasuryCache.js";
import { recordMetric } from "./treasuryMetrics.js";

// ── Main entry point ──────────────────────────────────────────────────────────

export async function computeLiquidity(
  params: TreasuryQueryParams
): Promise<LiquidityMetrics> {
  const { companyId, asOf } = params;
  const periodDate = asOf ?? new Date().toISOString().slice(0, 10);
  const cacheKey = CK.liquidity(companyId, periodDate);

  const cached = treasuryCache.get<LiquidityMetrics>(cacheKey);
  if (cached) return cached;

  const t0 = performance.now();

  const [cash, ar, ap, revenue30d, expenses30d, collected30d, invoiced30d] =
    await Promise.all([
      fetchTotalCash(companyId),
      fetchOutstandingAr(companyId),
      fetchOutstandingAp(companyId),
      fetchRevenue30d(companyId, periodDate),
      fetchExpenses30d(companyId, periodDate),
      fetchCollected30d(companyId, periodDate),
      fetchInvoiced30d(companyId, periodDate),
    ]);

  // Balance sheet approximations
  // Current Assets  ≈ Cash + AR
  // Current Liabilities ≈ AP
  const currentAssets      = cash + ar;
  const currentLiabilities = ap;

  // Ratios
  const quickRatio   = currentLiabilities > 0 ? round4(currentAssets / currentLiabilities) : null;
  const currentRatio = currentLiabilities > 0 ? round4(currentAssets / currentLiabilities) : null;

  // Cash Coverage = Cash / daily expenses
  const dailyExpenses = expenses30d / 30;
  const cashCoverage  = dailyExpenses > 0 ? round4(cash / dailyExpenses) : null;

  // Operating Cash Coverage: inflow_30d / expenses_30d
  const operatingCashCoverage = expenses30d > 0 ? round4(collected30d / expenses30d) : null;

  // Efficiency metrics
  const collectionEfficiency = invoiced30d > 0
    ? round4((collected30d / invoiced30d) * 100) : null;
  const paymentEfficiency    = expenses30d > 0
    ? round4((Math.min(collected30d, expenses30d) / expenses30d) * 100) : null;

  // DSO = (AR / Revenue_30d) × 30
  const dso = revenue30d > 0 ? round2((ar / revenue30d) * 30) : null;

  // DPO = (AP / Expenses_30d) × 30
  const dpo = expenses30d > 0 ? round2((ap / expenses30d) * 30) : null;

  const latencyMs = performance.now() - t0;

  const result: LiquidityMetrics = {
    companyId,
    periodDate,
    currency: 'IDR',
    quickRatio,
    currentRatio,
    cashCoverage,
    operatingCashCoverage,
    collectionEfficiency,
    paymentEfficiency,
    dso,
    dpo,
    currentAssets:       round2(currentAssets),
    currentLiabilities:  round2(currentLiabilities),
    cashAndEquivalents:  round2(cash),
    totalRevenue30d:     round2(revenue30d),
    totalExpenses30d:    round2(expenses30d),
    computedAt: new Date().toISOString(),
    latencyMs:  round2(latencyMs),
  };

  treasuryCache.set(cacheKey, result, TREASURY_TTL.LIQUIDITY);
  recordMetric('liquidity_latency_ms', latencyMs, { companyId });

  return result;
}

// ── Queries ───────────────────────────────────────────────────────────────────

async function fetchTotalCash(companyId: number): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(
      COALESCE(opening_balance, 0) + COALESCE(mut.net, 0)
    ), 0) AS total
    FROM company_bank_accounts cba
    LEFT JOIN (
      SELECT bank_account_id,
        SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) AS net
      FROM bank_mutations
      WHERE status NOT IN ('void','rejected')
      GROUP BY bank_account_id
    ) mut ON (
      cba.id::text = NULLIF(BTRIM(mut.bank_account_id::text), '')
      OR cba.account_number::text = NULLIF(BTRIM(mut.bank_account_id::text), '')
    )
    WHERE cba.company_id = ${companyId} AND cba.is_active = true
  `));
  return Number(rows[0]?.total ?? 0);
}

async function fetchOutstandingAr(companyId: number): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(outstanding_amount), 0) AS total
    FROM ar_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OPEN','PARTIAL','OVERDUE')
  `));
  return Number(rows[0]?.total ?? 0);
}

async function fetchOutstandingAp(companyId: number): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(payable_amount - COALESCE(paid_amount, 0)), 0) AS total
    FROM ap_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OPEN','PARTIAL','OVERDUE')
  `));
  return Number(rows[0]?.total ?? 0);
}

async function fetchRevenue30d(companyId: number, asOf: string): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(gross_amount), 0) AS total
    FROM ar_subledger
    WHERE company_id = ${companyId}
      AND invoice_date >= ('${asOf}'::date - INTERVAL '30 days')
      AND invoice_date <= '${asOf}'
  `));
  return Number(rows[0]?.total ?? 0);
}

async function fetchExpenses30d(companyId: number, asOf: string): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(payable_amount), 0) AS total
    FROM ap_subledger
    WHERE company_id = ${companyId}
      AND bill_date >= ('${asOf}'::date - INTERVAL '30 days')
      AND bill_date <= '${asOf}'
  `));
  return Number(rows[0]?.total ?? 0);
}

/** Cash actually received in last 30 days */
async function fetchCollected30d(companyId: number, asOf: string): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(bm.amount), 0) AS total
    FROM bank_mutations bm
    JOIN company_bank_accounts cba ON (
      cba.id::text = NULLIF(BTRIM(bm.bank_account_id::text), '')
      OR cba.account_number::text = NULLIF(BTRIM(bm.bank_account_id::text), '')
    )
    WHERE cba.company_id = ${companyId}
      AND bm.direction = 'IN'
      AND bm.status NOT IN ('void','rejected')
      AND bm.transaction_date::date >= ('${asOf}'::date - INTERVAL '30 days')
      AND bm.transaction_date::date <= '${asOf}'
  `));
  return Number(rows[0]?.total ?? 0);
}

async function fetchInvoiced30d(companyId: number, asOf: string): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(gross_amount), 0) AS total
    FROM ar_subledger
    WHERE company_id = ${companyId}
      AND invoice_date >= ('${asOf}'::date - INTERVAL '30 days')
      AND invoice_date <= '${asOf}'
  `));
  return Number(rows[0]?.total ?? 0);
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function persistLiquidityMetrics(m: LiquidityMetrics): Promise<void> {
  await db.execute(sql.raw(`
    INSERT INTO liquidity_metrics
      (company_id, period_date,
       quick_ratio, current_ratio, cash_coverage, operating_cash_coverage,
       collection_efficiency, payment_efficiency, dso, dpo,
       current_assets, current_liabilities, cash_and_equivalents,
       total_revenue_30d, total_expenses_30d)
    VALUES (
      ${m.companyId}, '${m.periodDate}',
      ${m.quickRatio ?? 'NULL'}, ${m.currentRatio ?? 'NULL'},
      ${m.cashCoverage ?? 'NULL'}, ${m.operatingCashCoverage ?? 'NULL'},
      ${m.collectionEfficiency ?? 'NULL'}, ${m.paymentEfficiency ?? 'NULL'},
      ${m.dso ?? 'NULL'}, ${m.dpo ?? 'NULL'},
      ${m.currentAssets}, ${m.currentLiabilities}, ${m.cashAndEquivalents},
      ${m.totalRevenue30d}, ${m.totalExpenses30d}
    )
    ON CONFLICT DO NOTHING
  `)).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
