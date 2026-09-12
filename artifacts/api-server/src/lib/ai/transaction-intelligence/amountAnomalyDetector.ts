/**
 * AI Transaction Intelligence — Phase 7
 * Amount Anomaly Detector
 *
 * Detects transactions with unusual amounts based on:
 *   - Z-score vs baseline mean/stddev
 *   - Percentile position (p95, p99)
 *   - Median Absolute Deviation (MAD) — robust to outliers
 *   - Counterparty-specific historical amounts
 *   - Intent-specific historical amounts
 *   - COA-specific historical amounts
 *   - Round-amount pattern detection
 *
 * Pure function — no side effects, no DB calls.
 */

import type {
  AnomalyDetection,
  AnomalyEvidence,
  CompanyAnomalyBaseline,
  HistoricalTransactionRecord,
  AnomalyDetectionPolicy,
} from './anomalyTypes.js';
import { mergePolicy } from './anomalyRules.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortedAmounts(records: HistoricalTransactionRecord[]): number[] {
  return [...records.map(r => r.amount)].sort((a, b) => a - b);
}

function percentileOf(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0.5;
  let below = 0;
  for (const v of sorted) { if (v < value) below++; }
  return below / sorted.length;
}

function madScore(value: number, median: number, sorted: number[]): number {
  if (sorted.length < 3) return 0;
  const deviations = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)]! || 1;
  return Math.abs(value - median) / (mad * 1.4826); // 1.4826 normalises MAD to stddev-equivalent
}

function isRoundAmount(amount: number): boolean {
  if (amount <= 0) return false;
  // Round to nearest 1, 5, 10, 100, 1000, 10000, 100000, 1000000
  const roundMultiples = [1_000_000, 500_000, 100_000, 50_000, 10_000, 5_000, 1_000];
  for (const m of roundMultiples) {
    if (amount >= m && amount % m === 0) return true;
  }
  return false;
}

// ─── Detector ─────────────────────────────────────────────────────────────────

export interface AmountDetectorInput {
  amount: number;
  currency?: string;
  counterpartyName?: string;
  intent?: string;
  coaCode?: string;
  /** Optional: used for company-scoped baseline lookups. */
  companyId?: string | number;
  historical: HistoricalTransactionRecord[];
  baseline?: CompanyAnomalyBaseline;
  policy?: AnomalyDetectionPolicy;
}

export function detectAmountAnomaly(input: AmountDetectorInput): AnomalyDetection {
  const policy = mergePolicy(input.policy);
  const { amount, historical, baseline } = input;
  const evidence: AnomalyEvidence[] = [];
  const reasons: string[] = [];
  let maxScore = 0;

  // ── Baseline Z-score / percentile check ──────────────────────────────────
  if (baseline && baseline.sampleSize >= 5) {
    const { mean, standardDeviation, median, p95, p99 } = baseline.amount;

    // Z-score using stddev
    if (mean != null && standardDeviation != null && standardDeviation > 0) {
      const z = Math.abs(amount - mean) / standardDeviation;
      if (z >= policy.amountZScoreThreshold) {
        const score = Math.min(0.95, 0.40 + (z - policy.amountZScoreThreshold) * 0.08);
        maxScore = Math.max(maxScore, score);
        reasons.push(
          `Amount ${amount.toLocaleString()} deviates ${z.toFixed(1)}σ from baseline mean ${mean.toLocaleString()} (threshold: ${policy.amountZScoreThreshold}σ)`,
        );
        evidence.push({ key: 'zScore', value: parseFloat(z.toFixed(2)), expected: `≤ ${policy.amountZScoreThreshold}`, contribution: score });
      }
    }

    // MAD-based robust deviation
    if (median != null) {
      const sorted = sortedAmounts(historical);
      const mad = madScore(amount, median, sorted);
      if (mad >= policy.amountZScoreThreshold) {
        const score = Math.min(0.90, 0.35 + (mad - policy.amountZScoreThreshold) * 0.07);
        maxScore = Math.max(maxScore, score);
        reasons.push(`Amount ${amount.toLocaleString()} is ${mad.toFixed(1)} MAD units from median ${median.toLocaleString()}`);
        evidence.push({ key: 'madScore', value: parseFloat(mad.toFixed(2)), expected: `≤ ${policy.amountZScoreThreshold}`, contribution: score });
      }
    }

    // Percentile check
    if (historical.length >= 10) {
      const sorted = sortedAmounts(historical);
      const pct = percentileOf(sorted, amount);
      if (pct >= policy.amountPercentileThreshold) {
        const score = Math.min(0.85, 0.40 + (pct - policy.amountPercentileThreshold) * 5);
        maxScore = Math.max(maxScore, score);
        reasons.push(`Amount is at percentile ${(pct * 100).toFixed(1)}% (threshold: ${(policy.amountPercentileThreshold * 100).toFixed(0)}%)`);
        evidence.push({ key: 'percentile', value: parseFloat((pct * 100).toFixed(1)), expected: `< ${(policy.amountPercentileThreshold * 100).toFixed(0)}%`, contribution: score });
      }
      if (p99 != null && amount > p99 * 2) {
        const score = Math.min(0.90, 0.50 + Math.min(0.40, (amount / p99 - 2) * 0.05));
        maxScore = Math.max(maxScore, score);
        reasons.push(`Amount ${amount.toLocaleString()} exceeds 2× the 99th percentile (${p99.toLocaleString()})`);
        evidence.push({ key: 'p99Ratio', value: parseFloat((amount / p99).toFixed(1)), expected: '< 2.0', contribution: score });
      }
      if (p95 != null && amount > p95 * 3) {
        const score = Math.min(0.80, 0.45 + Math.min(0.35, (amount / p95 - 3) * 0.04));
        maxScore = Math.max(maxScore, score);
        reasons.push(`Amount exceeds 3× the 95th percentile (${p95.toLocaleString()})`);
        evidence.push({ key: 'p95Ratio', value: parseFloat((amount / p95).toFixed(1)), expected: '< 3.0', contribution: score });
      }
    }
  } else if (historical.length === 0 && !baseline) {
    // No data available — low-confidence flag
    evidence.push({ key: 'baselineAvailable', value: false, contribution: 0 });
  }

  // ── Fallback: compute stats inline from historical when no baseline ────────
  if (!baseline && historical.length >= 5) {
    const amounts = [...historical.map(r => r.amount)].sort((a, b) => a - b);
    const n = amounts.length;
    const mean = amounts.reduce((s, v) => s + v, 0) / n;
    const variance = amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);
    const median = amounts[Math.floor(n / 2)]!;

    if (stddev > 0) {
      const z = Math.abs(amount - mean) / stddev;
      if (z >= policy.amountZScoreThreshold) {
        const score = Math.min(0.95, 0.40 + (z - policy.amountZScoreThreshold) * 0.08);
        maxScore = Math.max(maxScore, score);
        reasons.push(
          `Amount ${amount.toLocaleString()} deviates ${z.toFixed(1)}σ from historical mean ${mean.toLocaleString()} (threshold: ${policy.amountZScoreThreshold}σ)`,
        );
        evidence.push({ key: 'zScore', value: parseFloat(z.toFixed(2)), expected: `≤ ${policy.amountZScoreThreshold}`, contribution: score });
      }
    }

    const mad = madScore(amount, median, amounts);
    if (mad >= policy.amountZScoreThreshold) {
      const score = Math.min(0.90, 0.35 + (mad - policy.amountZScoreThreshold) * 0.07);
      maxScore = Math.max(maxScore, score);
      reasons.push(`Amount ${amount.toLocaleString()} is ${mad.toFixed(1)} MAD units from median ${median.toLocaleString()}`);
      evidence.push({ key: 'madScore', value: parseFloat(mad.toFixed(2)), expected: `≤ ${policy.amountZScoreThreshold}`, contribution: score });
    }

    if (n >= 10) {
      const pct = percentileOf(amounts, amount);
      if (pct >= policy.amountPercentileThreshold) {
        const score = Math.min(0.85, 0.40 + (pct - policy.amountPercentileThreshold) * 5);
        maxScore = Math.max(maxScore, score);
        reasons.push(`Amount is at percentile ${(pct * 100).toFixed(1)}% (threshold: ${(policy.amountPercentileThreshold * 100).toFixed(0)}%)`);
        evidence.push({ key: 'percentile', value: parseFloat((pct * 100).toFixed(1)), expected: `< ${(policy.amountPercentileThreshold * 100).toFixed(0)}%`, contribution: score });
      }
      const p99 = amounts[Math.floor(n * 0.99)]!;
      const p95 = amounts[Math.floor(n * 0.95)]!;
      if (amount > p99 * 2) {
        const score = Math.min(0.90, 0.50 + Math.min(0.40, (amount / p99 - 2) * 0.05));
        maxScore = Math.max(maxScore, score);
        reasons.push(`Amount ${amount.toLocaleString()} exceeds 2× the 99th percentile (${p99.toLocaleString()})`);
        evidence.push({ key: 'p99Ratio', value: parseFloat((amount / p99).toFixed(1)), expected: '< 2.0', contribution: score });
      }
      if (amount > p95 * 3) {
        const score = Math.min(0.80, 0.45 + Math.min(0.35, (amount / p95 - 3) * 0.04));
        maxScore = Math.max(maxScore, score);
        reasons.push(`Amount exceeds 3× the 95th percentile (${p95.toLocaleString()})`);
        evidence.push({ key: 'p95Ratio', value: parseFloat((amount / p95).toFixed(1)), expected: '< 3.0', contribution: score });
      }
    }
  }

  // ── Counterparty-specific amount check ────────────────────────────────────
  if (input.counterpartyName) {
    const cpHistory = historical.filter(
      h => h.counterpartyName?.toLowerCase() === input.counterpartyName!.toLowerCase(),
    );
    if (cpHistory.length >= 3) {
      const cpAmounts = cpHistory.map(h => h.amount).sort((a, b) => a - b);
      const cpMedian = cpAmounts[Math.floor(cpAmounts.length / 2)]!;
      if (cpMedian > 0 && amount > cpMedian * 5) {
        const ratio = amount / cpMedian;
        const score = Math.min(0.85, 0.35 + Math.min(0.50, (ratio - 5) * 0.03));
        maxScore = Math.max(maxScore, score);
        reasons.push(
          `Amount is ${ratio.toFixed(1)}× the counterparty historical median (${cpMedian.toLocaleString()})`,
        );
        evidence.push({ key: 'counterpartyMedianRatio', value: parseFloat(ratio.toFixed(1)), expected: '< 5.0', contribution: score });
      }
    }
  }

  // ── Intent-specific amount check ──────────────────────────────────────────
  if (input.intent) {
    const intentHistory = historical.filter(h => h.intent === input.intent);
    if (intentHistory.length >= 5) {
      const iAmounts = intentHistory.map(h => h.amount).sort((a, b) => a - b);
      const iMedian = iAmounts[Math.floor(iAmounts.length / 2)]!;
      if (iMedian > 0 && amount > iMedian * 8) {
        const ratio = amount / iMedian;
        const score = Math.min(0.75, 0.30 + Math.min(0.45, (ratio - 8) * 0.02));
        maxScore = Math.max(maxScore, score);
        reasons.push(`Amount is ${ratio.toFixed(1)}× the intent (${input.intent}) historical median`);
        evidence.push({ key: 'intentMedianRatio', value: parseFloat(ratio.toFixed(1)), expected: '< 8.0', contribution: score });
      }
    }
  }

  // ── COA-specific amount check ─────────────────────────────────────────────
  if (input.coaCode) {
    const coaHistory = historical.filter(h => h.coaCode === input.coaCode);
    if (coaHistory.length >= 5) {
      const cAmounts = coaHistory.map(h => h.amount).sort((a, b) => a - b);
      const cMedian = cAmounts[Math.floor(cAmounts.length / 2)]!;
      if (cMedian > 0 && amount > cMedian * 10) {
        const ratio = amount / cMedian;
        const score = Math.min(0.70, 0.25 + Math.min(0.45, (ratio - 10) * 0.01));
        maxScore = Math.max(maxScore, score);
        reasons.push(`Amount is ${ratio.toFixed(1)}× the COA (${input.coaCode}) historical median`);
        evidence.push({ key: 'coaMedianRatio', value: parseFloat(ratio.toFixed(1)), expected: '< 10.0', contribution: score });
      }
    }
  }

  // ── Currency separation note ──────────────────────────────────────────────
  if (input.currency && input.currency !== 'IDR' && input.currency !== 'Rp') {
    evidence.push({ key: 'currency', value: input.currency, contribution: 0 });
  }

  const detected = maxScore > 0.15 && reasons.length > 0;
  const severity = maxScore >= 0.75 ? 'HIGH'
    : maxScore >= 0.50 ? 'MEDIUM'
    : maxScore >= 0.25 ? 'LOW'
    : 'INFO';

  return {
    type: 'AMOUNT_OUTLIER',
    detected,
    score: parseFloat(maxScore.toFixed(4)),
    severity: detected ? severity : 'INFO',
    reason: detected ? reasons : [],
    evidence,
  };
}

// ─── Round amount pattern detector ────────────────────────────────────────────

export function detectRoundAmountPattern(input: { amount: number }): AnomalyDetection {
  const round = isRoundAmount(input.amount);
  const score = round ? 0.08 : 0;
  return {
    type: 'ROUND_AMOUNT_PATTERN',
    detected: round,
    score,
    severity: round ? 'INFO' : 'INFO',
    reason: round ? [`Amount ${input.amount.toLocaleString()} is a suspicious round number`] : [],
    evidence: round
      ? [{ key: 'isRoundAmount', value: true, contribution: score }]
      : [{ key: 'isRoundAmount', value: false, contribution: 0 }],
  };
}
