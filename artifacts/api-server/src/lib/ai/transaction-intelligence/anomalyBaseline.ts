/**
 * AI Transaction Intelligence — Phase 7
 * Anomaly Baseline Builder
 *
 * Computes statistical baseline from historical transactions.
 * Pure function — no side effects, no DB calls.
 */

import type {
  HistoricalTransactionRecord,
  CompanyAnomalyBaseline,
  BaselineQuality,
} from './anomalyTypes.js';
import type { TransactionIntent } from './transactionTypes.js';
import { parseDate } from './anomalyRules.js';

// ─── Statistical helpers ──────────────────────────────────────────────────────

function sortedNumbers(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

// ─── Baseline quality ─────────────────────────────────────────────────────────

export function computeBaselineQuality(sampleSize: number): BaselineQuality {
  if (sampleSize < 5) return 'INSUFFICIENT';
  if (sampleSize < 30) return 'LIMITED';
  if (sampleSize < 100) return 'GOOD';
  return 'STRONG';
}

// ─── Frequency helpers ────────────────────────────────────────────────────────

function computeFrequency(validRecords: HistoricalTransactionRecord[]): {
  averagePerDay: number;
  averagePerWeek: number;
  averagePerMonth: number;
} | undefined {
  const dates = validRecords
    .map(r => parseDate(r.transactionDate))
    .filter((d): d is Date => d !== null);
  if (dates.length < 2) return undefined;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const earliest = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;
  const spanDays = Math.max(1, (latest.getTime() - earliest.getTime()) / 86400000);
  const count = dates.length;
  return {
    averagePerDay: count / spanDays,
    averagePerWeek: (count / spanDays) * 7,
    averagePerMonth: (count / spanDays) * 30,
  };
}

// ─── Top-N helper ─────────────────────────────────────────────────────────────

function topN<T extends string>(items: T[], n = 20): T[] {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

// ─── Usual hours / days ───────────────────────────────────────────────────────

function computeUsualHours(validRecords: HistoricalTransactionRecord[]): number[] {
  const hourCounts = new Array<number>(24).fill(0);
  for (const r of validRecords) {
    const d = parseDate(r.transactionDate);
    if (d) hourCounts[d.getHours()]!++;
  }
  const total = validRecords.length;
  if (total === 0) return [];
  // Hours with > 5% of transactions are "usual"
  return hourCounts
    .map((count, hour) => ({ hour, count }))
    .filter(({ count }) => count / total >= 0.05)
    .map(({ hour }) => hour);
}

function computeUsualDays(validRecords: HistoricalTransactionRecord[]): number[] {
  const dayCounts = new Array<number>(7).fill(0);
  for (const r of validRecords) {
    const d = parseDate(r.transactionDate);
    if (d) dayCounts[d.getDay()]!++;
  }
  const total = validRecords.length;
  if (total === 0) return [];
  // Days with > 3% of transactions are "usual"
  return dayCounts
    .map((count, day) => ({ day, count }))
    .filter(({ count }) => count / total >= 0.03)
    .map(({ day }) => day);
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build a CompanyAnomalyBaseline from historical transaction records.
 *
 * Only records matching companyId with valid amount and date are used.
 * Pure function — deterministic, no side effects.
 *
 * @param transactions Raw historical records (may include other companies — filtered).
 * @param companyId   Company to build baseline for.
 * @param generatedAt ISO string for the baseline timestamp (inject for determinism).
 */
export function buildAnomalyBaseline(
  transactions: HistoricalTransactionRecord[],
  companyId: string | number,
  generatedAt?: string,
): CompanyAnomalyBaseline {
  // Filter: same company, valid amount, valid date, not corrupt
  const valid = transactions.filter(
    r =>
      String(r.companyId) === String(companyId) &&
      typeof r.amount === 'number' &&
      isFinite(r.amount) &&
      r.amount >= 0 &&
      parseDate(r.transactionDate) !== null &&
      typeof r.description === 'string' &&
      r.description.trim().length > 0,
  );

  const amounts = valid.map(r => r.amount);
  const sorted = sortedNumbers(amounts);
  const avg = mean(amounts);
  const sd = stddev(amounts, avg);

  const amountStats: CompanyAnomalyBaseline['amount'] = sorted.length === 0
    ? {}
    : {
        mean: avg,
        median: median(sorted),
        standardDeviation: sd,
        p25: percentile(sorted, 0.25),
        p75: percentile(sorted, 0.75),
        p90: percentile(sorted, 0.90),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        min: sorted[0],
        max: sorted[sorted.length - 1],
      };

  const counterparties = valid
    .map(r => r.counterpartyName)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);

  const txCodes = valid
    .map(r => r.transactionCode)
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0);

  const intents = valid
    .map(r => r.intent)
    .filter((i): i is TransactionIntent => typeof i === 'string');

  const coaCodes = valid
    .map(r => r.coaCode)
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0);

  return {
    companyId,
    sampleSize: valid.length,
    amount: amountStats,
    frequency: computeFrequency(valid),
    commonCounterparties: topN(counterparties),
    commonTransactionCodes: topN(txCodes),
    commonIntents: topN(intents),
    commonCoaCodes: topN(coaCodes),
    usualHours: computeUsualHours(valid),
    usualDaysOfWeek: computeUsualDays(valid),
    generatedAt: generatedAt ?? new Date(0).toISOString(), // caller injects timestamp
  };
}
