/**
 * Cash Forecast Engine — Batch 4 Phase 2
 *
 * Deterministic forecast (NO AI/ML) for:
 *   - Today (0d)
 *   - 7 days
 *   - 30 days
 *   - 60 days
 *   - 90 days
 *
 * Sources:
 *   1. AR subledger (outstanding_amount grouped by due_date ≤ horizonDate)
 *   2. AP subledger (outstanding_amount grouped by due_date ≤ horizonDate)
 *   3. Scheduled bank mutations (direction + future date)
 *
 * Opening balance for each bucket = currentCash from cash position.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type {
  CashForecast,
  ForecastBucket,
  ForecastHorizon,
  TreasuryQueryParams,
} from "./types.js";
import { computeCashPosition } from "./cashPositionEngine.js";
import { treasuryCache, CK, TREASURY_TTL } from "./treasuryCache.js";
import { recordMetric } from "./treasuryMetrics.js";

const HORIZONS: ForecastHorizon[] = [0, 7, 30, 60, 90];

// ── Main entry point ──────────────────────────────────────────────────────────

export async function computeCashForecast(
  params: TreasuryQueryParams
): Promise<CashForecast> {
  const { companyId, asOf } = params;
  const forecastDate = asOf ?? new Date().toISOString().slice(0, 10);
  const cacheKey = CK.forecast(companyId, forecastDate);

  const cached = treasuryCache.get<CashForecast>(cacheKey);
  if (cached) return cached;

  const t0 = performance.now();

  // Opening balance = current cash today
  const position = await computeCashPosition({ companyId, asOf: forecastDate });
  const openingBalance = position.currentCash;

  const buckets = await Promise.all(
    HORIZONS.map(h => computeForecastBucket(companyId, forecastDate, h, openingBalance))
  );

  const latencyMs = performance.now() - t0;

  const result: CashForecast = {
    companyId,
    forecastDate,
    currency: 'IDR',
    buckets,
    computedAt: new Date().toISOString(),
    latencyMs: Math.round(latencyMs * 100) / 100,
  };

  treasuryCache.set(cacheKey, result, TREASURY_TTL.FORECAST);
  recordMetric('forecast_latency_ms', latencyMs, { companyId });

  return result;
}

// ── Per-bucket computation ────────────────────────────────────────────────────

async function computeForecastBucket(
  companyId: number,
  forecastDate: string,
  horizonDays: ForecastHorizon,
  openingBalance: number
): Promise<ForecastBucket> {
  const horizonDate = addDays(forecastDate, horizonDays);

  const [arInflow, apOutflow, mutIn, mutOut] = await Promise.all([
    fetchArInflow(companyId, forecastDate, horizonDate),
    fetchApOutflow(companyId, forecastDate, horizonDate),
    fetchMutationInflow(companyId, forecastDate, horizonDate),
    fetchMutationOutflow(companyId, forecastDate, horizonDate),
  ]);

  const expectedInflow  = arInflow  + mutIn;
  const expectedOutflow = apOutflow + mutOut;
  const netForecast     = expectedInflow - expectedOutflow;
  const closingBalance  = openingBalance + netForecast;

  return {
    horizonDays,
    horizonDate,
    currency: 'IDR',
    expectedInflow:  round2(expectedInflow),
    expectedOutflow: round2(expectedOutflow),
    netForecast:     round2(netForecast),
    openingBalance:  round2(openingBalance),
    closingBalance:  round2(closingBalance),
    arComponent:     round2(arInflow),
    apComponent:     round2(apOutflow),
    mutationInflow:  round2(mutIn),
    mutationOutflow: round2(mutOut),
  };
}

// ── AR / AP queries ───────────────────────────────────────────────────────────

/**
 * AR expected inflow = outstanding AR with due_date in (forecastDate, horizonDate]
 * For today bucket (horizon=0): due today
 */
async function fetchArInflow(
  companyId: number,
  fromDate: string,
  toDate: string
): Promise<number> {
  const fromClause = fromDate === toDate
    ? `due_date = '${fromDate}'`
    : `due_date > '${fromDate}' AND due_date <= '${toDate}'`;

  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(outstanding_amount), 0) AS total
    FROM ar_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OPEN', 'PARTIAL', 'OVERDUE')
      AND due_date IS NOT NULL
      AND ${fromClause}
  `));
  return Number(rows[0]?.total ?? 0);
}

async function fetchApOutflow(
  companyId: number,
  fromDate: string,
  toDate: string
): Promise<number> {
  const fromClause = fromDate === toDate
    ? `due_date = '${fromDate}'`
    : `due_date > '${fromDate}' AND due_date <= '${toDate}'`;

  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(payable_amount - COALESCE(paid_amount, 0)), 0) AS total
    FROM ap_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OPEN', 'PARTIAL', 'OVERDUE')
      AND due_date IS NOT NULL
      AND ${fromClause}
  `));
  return Number(rows[0]?.total ?? 0);
}

/** Scheduled future IN mutations (unmatched/pending, future-dated) */
async function fetchMutationInflow(
  companyId: number,
  fromDate: string,
  toDate: string
): Promise<number> {
  const fromClause = fromDate === toDate
    ? `bm.transaction_date::date = '${fromDate}'`
    : `bm.transaction_date::date > '${fromDate}' AND bm.transaction_date::date <= '${toDate}'`;

  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(bm.amount), 0) AS total
    FROM bank_mutations bm
    JOIN company_bank_accounts cba ON (
      (
        bm.bank_account_id ~ '^[0-9]+$'
        AND bm.bank_account_id::numeric BETWEEN -2147483648 AND 2147483647
        AND cba.id = bm.bank_account_id::integer
      )
      OR cba.account_number::text = bm.bank_account_id::text
    )
    WHERE cba.company_id = ${companyId}
      AND bm.direction = 'IN'
      AND bm.status IN ('unmatched', 'pending', 'scheduled')
      AND ${fromClause}
  `));
  return Number(rows[0]?.total ?? 0);
}

async function fetchMutationOutflow(
  companyId: number,
  fromDate: string,
  toDate: string
): Promise<number> {
  const fromClause = fromDate === toDate
    ? `bm.transaction_date::date = '${fromDate}'`
    : `bm.transaction_date::date > '${fromDate}' AND bm.transaction_date::date <= '${toDate}'`;

  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(bm.amount), 0) AS total
    FROM bank_mutations bm
    JOIN company_bank_accounts cba ON (
      (
        bm.bank_account_id ~ '^[0-9]+$'
        AND bm.bank_account_id::numeric BETWEEN -2147483648 AND 2147483647
        AND cba.id = bm.bank_account_id::integer
      )
      OR cba.account_number::text = bm.bank_account_id::text
    )
    WHERE cba.company_id = ${companyId}
      AND bm.direction = 'OUT'
      AND bm.status IN ('unmatched', 'pending', 'scheduled')
      AND ${fromClause}
  `));
  return Number(rows[0]?.total ?? 0);
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function persistForecast(forecast: CashForecast): Promise<void> {
  for (const bucket of forecast.buckets) {
    await db.execute(sql.raw(`
      INSERT INTO cash_forecast
        (company_id, forecast_date, horizon_days, horizon_date, currency,
         expected_inflow, expected_outflow, net_forecast,
         opening_balance, closing_balance,
         ar_component, ap_component, mutation_inflow, mutation_outflow)
      VALUES (
        ${forecast.companyId},
        '${forecast.forecastDate}',
        ${bucket.horizonDays},
        '${bucket.horizonDate}',
        '${bucket.currency}',
        ${bucket.expectedInflow},
        ${bucket.expectedOutflow},
        ${bucket.netForecast},
        ${bucket.openingBalance},
        ${bucket.closingBalance},
        ${bucket.arComponent},
        ${bucket.apComponent},
        ${bucket.mutationInflow},
        ${bucket.mutationOutflow}
      )
      ON CONFLICT DO NOTHING
    `)).catch(() => {}); // Non-fatal — snapshot only
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
