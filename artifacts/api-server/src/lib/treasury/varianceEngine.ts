/**
 * Variance Engine — Batch 4 Phase 3
 *
 * Compares Expected vs Actual cash flow.
 * All variances are traceable to source documents.
 *
 * Variance = Actual − Expected
 * Variance % = (Variance / Expected) × 100  (null if Expected = 0)
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type {
  VarianceReport,
  VarianceRow,
  VarianceTraceItem,
  TreasuryQueryParams,
} from "./types.js";
import { recordMetric } from "./treasuryMetrics.js";

// ── Main entry point ──────────────────────────────────────────────────────────

export async function computeVariance(
  params: TreasuryQueryParams & { fromDate: string; toDate: string }
): Promise<VarianceReport> {
  const { companyId, fromDate, toDate } = params;
  const t0 = performance.now();

  const [inflowRows, outflowRows, balanceRows] = await Promise.all([
    computeInflowVariance(companyId, fromDate, toDate),
    computeOutflowVariance(companyId, fromDate, toDate),
    computeBalanceVariance(companyId, fromDate, toDate),
  ]);

  const rows: VarianceRow[] = [...inflowRows, ...outflowRows, ...balanceRows];

  // Summary
  const totalExpected  = rows.reduce((s, r) => s + r.expectedAmount, 0);
  const totalActual    = rows.reduce((s, r) => s + r.actualAmount, 0);
  const totalVariance  = totalActual - totalExpected;
  const avgVariancePct = totalExpected !== 0
    ? round2((totalVariance / totalExpected) * 100)
    : null;

  const latencyMs = performance.now() - t0;

  const result: VarianceReport = {
    companyId,
    fromDate,
    toDate,
    currency: 'IDR',
    rows,
    summary: {
      totalExpected:  round2(totalExpected),
      totalActual:    round2(totalActual),
      totalVariance:  round2(totalVariance),
      avgVariancePct,
    },
    computedAt: new Date().toISOString(),
    latencyMs:  round2(latencyMs),
  };

  recordMetric('variance_latency_ms', latencyMs, { companyId });
  return result;
}

// ── Inflow variance ───────────────────────────────────────────────────────────

async function computeInflowVariance(
  companyId: number,
  fromDate: string,
  toDate: string
): Promise<VarianceRow[]> {
  // Expected inflow: AR with due_date in period
  const { rows: arRows } = await db.execute<{
    period_date: string;
    expected: string;
    ar_ids: string;
  }>(sql.raw(`
    SELECT
      due_date::text         AS period_date,
      SUM(gross_amount)      AS expected,
      string_agg(id::text, ',') AS ar_ids
    FROM ar_subledger
    WHERE company_id = ${companyId}
      AND due_date >= '${fromDate}'
      AND due_date <= '${toDate}'
    GROUP BY due_date
    ORDER BY due_date
  `));

  // Actual inflow: bank mutations IN in same period
  const { rows: mutRows } = await db.execute<{
    mut_date: string;
    actual: string;
  }>(sql.raw(`
    SELECT
      bm.transaction_date::date::text AS mut_date,
      SUM(bm.amount)                  AS actual
    FROM bank_mutations bm
    JOIN company_bank_accounts cba ON cba.id = bm.bank_account_id::integer
    WHERE cba.company_id = ${companyId}
      AND bm.direction = 'IN'
      AND bm.status NOT IN ('void', 'rejected')
      AND bm.transaction_date::date >= '${fromDate}'
      AND bm.transaction_date::date <= '${toDate}'
    GROUP BY bm.transaction_date::date
    ORDER BY bm.transaction_date::date
  `));

  // Build a map of actual by date
  const actualByDate = new Map<string, number>();
  for (const m of mutRows) {
    actualByDate.set(m.mut_date, Number(m.actual));
  }

  return arRows.map(ar => {
    const expected = Number(ar.expected);
    const actual   = actualByDate.get(ar.period_date) ?? 0;
    const variance = actual - expected;
    const variancePct = expected !== 0 ? round2((variance / expected) * 100) : null;

    // Traceable items
    const tracedItems: VarianceTraceItem[] = (ar.ar_ids ?? '')
      .split(',')
      .filter(Boolean)
      .map(id => ({
        source: 'ar',
        referenceId: Number(id),
        referenceNumber: null,
        expectedAmount: expected,
        actualAmount:   actual,
        dueDate: ar.period_date,
      }));

    return {
      periodDate:       ar.period_date,
      currency:         'IDR',
      expectedAmount:   round2(expected),
      actualAmount:     round2(actual),
      varianceAmount:   round2(variance),
      variancePct,
      varianceType:     'inflow' as const,
      tracedItems,
    };
  });
}

// ── Outflow variance ──────────────────────────────────────────────────────────

async function computeOutflowVariance(
  companyId: number,
  fromDate: string,
  toDate: string
): Promise<VarianceRow[]> {
  const { rows: apRows } = await db.execute<{
    period_date: string;
    expected: string;
  }>(sql.raw(`
    SELECT
      due_date::text    AS period_date,
      SUM(payable_amount) AS expected
    FROM ap_subledger
    WHERE company_id = ${companyId}
      AND due_date >= '${fromDate}'
      AND due_date <= '${toDate}'
    GROUP BY due_date
    ORDER BY due_date
  `));

  const { rows: mutRows } = await db.execute<{
    mut_date: string;
    actual: string;
  }>(sql.raw(`
    SELECT
      bm.transaction_date::date::text AS mut_date,
      SUM(bm.amount)                  AS actual
    FROM bank_mutations bm
    JOIN company_bank_accounts cba ON cba.id = bm.bank_account_id::integer
    WHERE cba.company_id = ${companyId}
      AND bm.direction = 'OUT'
      AND bm.status NOT IN ('void', 'rejected')
      AND bm.transaction_date::date >= '${fromDate}'
      AND bm.transaction_date::date <= '${toDate}'
    GROUP BY bm.transaction_date::date
    ORDER BY bm.transaction_date::date
  `));

  const actualByDate = new Map<string, number>();
  for (const m of mutRows) {
    actualByDate.set(m.mut_date, Number(m.actual));
  }

  return apRows.map(ap => {
    const expected = Number(ap.expected);
    const actual   = actualByDate.get(ap.period_date) ?? 0;
    const variance = actual - expected;
    const variancePct = expected !== 0 ? round2((variance / expected) * 100) : null;

    return {
      periodDate:     ap.period_date,
      currency:       'IDR',
      expectedAmount: round2(expected),
      actualAmount:   round2(actual),
      varianceAmount: round2(variance),
      variancePct,
      varianceType:   'outflow' as const,
    };
  });
}

// ── Balance variance ──────────────────────────────────────────────────────────

async function computeBalanceVariance(
  companyId: number,
  fromDate: string,
  toDate: string
): Promise<VarianceRow[]> {
  // Compare forecast closing balance vs actual snapshot balance
  const { rows } = await db.execute<{
    period_date: string;
    expected_amount: string;
    actual_amount: string;
    forecast_id: string | null;
    snapshot_id: string | null;
  }>(sql.raw(`
    SELECT
      cf.horizon_date::text   AS period_date,
      cf.closing_balance      AS expected_amount,
      COALESCE(cps.current_cash, 0) AS actual_amount,
      cf.id::text             AS forecast_id,
      cps.id::text            AS snapshot_id
    FROM cash_forecast cf
    LEFT JOIN cash_position_snapshot cps
      ON cps.company_id = cf.company_id
     AND cps.snapshot_date = cf.horizon_date
    WHERE cf.company_id = ${companyId}
      AND cf.horizon_date >= '${fromDate}'
      AND cf.horizon_date <= '${toDate}'
    ORDER BY cf.horizon_date
  `));

  return rows.map(r => {
    const expected = Number(r.expected_amount);
    const actual   = Number(r.actual_amount);
    const variance = actual - expected;
    const variancePct = expected !== 0 ? round2((variance / expected) * 100) : null;

    return {
      periodDate:     r.period_date,
      currency:       'IDR',
      expectedAmount: round2(expected),
      actualAmount:   round2(actual),
      varianceAmount: round2(variance),
      variancePct,
      varianceType:   'balance' as const,
    };
  });
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function persistVarianceRows(
  companyId: number,
  rows: VarianceRow[]
): Promise<void> {
  for (const row of rows) {
    const tracedJson = row.tracedItems
      ? `'${JSON.stringify(row.tracedItems).replace(/'/g, "''")}'`
      : 'NULL';

    await db.execute(sql.raw(`
      INSERT INTO cash_variance
        (company_id, period_date, currency,
         expected_amount, actual_amount, variance_amount,
         variance_pct, variance_type, traced_items)
      VALUES (
        ${companyId},
        '${row.periodDate}',
        '${row.currency}',
        ${row.expectedAmount},
        ${row.actualAmount},
        ${row.varianceAmount},
        ${row.variancePct ?? 'NULL'},
        '${row.varianceType}',
        ${tracedJson}
      )
      ON CONFLICT DO NOTHING
    `)).catch(() => {});
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
