/**
 * AI Transaction Intelligence — Phase 7
 * Frequency Anomaly Detector
 *
 * Detects unusual transaction frequency:
 *   - Daily transaction count spike vs baseline
 *   - Hourly spike (too many in short window)
 *   - Counterparty appears too frequently
 *
 * Pure function — no side effects, no DB calls.
 * Time must be injected — no Date.now() usage.
 */

import type {
  AnomalyDetection,
  AnomalyEvidence,
  CompanyAnomalyBaseline,
  HistoricalTransactionRecord,
  AnomalyDetectionPolicy,
} from './anomalyTypes.js';
import { parseDate, minutesBetween } from './anomalyRules.js';
import { mergePolicy } from './anomalyRules.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

// ─── Detector ─────────────────────────────────────────────────────────────────

export interface FrequencyDetectorInput {
  transactionDate: string | Date;
  counterpartyName?: string;
  amount?: number;
  /** Optional: used for company-scoped history filtering. */
  companyId?: string | number;
  historical: HistoricalTransactionRecord[];
  baseline?: CompanyAnomalyBaseline;
  policy?: AnomalyDetectionPolicy;
  now: Date; // injected — never use Date.now() directly
}

export function detectFrequencyAnomaly(input: FrequencyDetectorInput): AnomalyDetection {
  const policy = mergePolicy(input.policy);
  const txDate = parseDate(input.transactionDate);
  if (!txDate) {
    return noDetection('date parse failed');
  }

  const evidence: AnomalyEvidence[] = [];
  const reasons: string[] = [];
  let maxScore = 0;

  // ── Same-day count spike ─────────────────────────────────────────────────
  const sameDay = input.historical.filter(h => {
    const d = parseDate(h.transactionDate);
    return d && isSameDay(d, txDate);
  });
  const todayCount = sameDay.length + 1; // +1 for current tx

  if (input.baseline?.frequency?.averagePerDay != null) {
    const avgPerDay = input.baseline.frequency.averagePerDay;
    if (avgPerDay > 0 && todayCount >= avgPerDay * policy.frequencyMultiplier) {
      const ratio = todayCount / avgPerDay;
      const score = Math.min(0.85, 0.30 + Math.min(0.55, (ratio - policy.frequencyMultiplier) * 0.04));
      maxScore = Math.max(maxScore, score);
      reasons.push(
        `${todayCount} transactions today — ${ratio.toFixed(1)}× daily average (${avgPerDay.toFixed(1)})`,
      );
      evidence.push({
        key: 'todayCount',
        value: todayCount,
        expected: `≤ ${(avgPerDay * policy.frequencyMultiplier).toFixed(0)}`,
        contribution: score,
      });
    }
  } else if (input.historical.length >= 10) {
    // Compute average per day from raw history
    const dates = input.historical
      .map(h => parseDate(h.transactionDate))
      .filter((d): d is Date => d !== null);
    if (dates.length >= 2) {
      const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
      const spanDays = Math.max(1, (sorted[sorted.length - 1]!.getTime() - sorted[0]!.getTime()) / 86400000);
      const computedAvg = dates.length / spanDays;
      if (computedAvg > 0 && todayCount >= computedAvg * policy.frequencyMultiplier) {
        const ratio = todayCount / computedAvg;
        const score = Math.min(0.80, 0.25 + Math.min(0.55, (ratio - policy.frequencyMultiplier) * 0.04));
        maxScore = Math.max(maxScore, score);
        reasons.push(
          `${todayCount} transactions today — ${ratio.toFixed(1)}× computed daily average (${computedAvg.toFixed(1)})`,
        );
        evidence.push({
          key: 'todayCountVsComputed',
          value: todayCount,
          expected: `≤ ${(computedAvg * policy.frequencyMultiplier).toFixed(0)}`,
          contribution: score,
        });
      }
    }
  }

  // ── Hourly spike (transactions in last 60 minutes) ────────────────────────
  const recentHour = input.historical.filter(h => {
    const d = parseDate(h.transactionDate);
    return d && minutesBetween(d, txDate) <= 60;
  });
  const hourlyCount = recentHour.length + 1;
  // Flag if > 2× the average hourly rate (avgPerDay / 24 * multiplier) — only if baseline available
  if (input.baseline?.frequency?.averagePerDay != null) {
    const avgPerHour = input.baseline.frequency.averagePerDay / 24;
    const hourlyThreshold = Math.max(5, avgPerHour * policy.frequencyMultiplier * 2);
    if (hourlyCount >= hourlyThreshold) {
      const score = Math.min(0.75, 0.25 + (hourlyCount / hourlyThreshold - 1) * 0.10);
      maxScore = Math.max(maxScore, score);
      reasons.push(`${hourlyCount} transactions in the last hour (threshold: ${hourlyThreshold.toFixed(0)})`);
      evidence.push({ key: 'hourlyCount', value: hourlyCount, expected: `< ${hourlyThreshold.toFixed(0)}`, contribution: score });
    }
  }

  // ── Counterparty spike ────────────────────────────────────────────────────
  if (input.counterpartyName) {
    const cpName = input.counterpartyName.toLowerCase();
    const cpSameDay = sameDay.filter(
      h => h.counterpartyName?.toLowerCase() === cpName,
    );
    const cpDayCount = cpSameDay.length + 1;

    // Compute historical avg per day for this counterparty
    const cpAll = input.historical.filter(h => h.counterpartyName?.toLowerCase() === cpName);
    if (cpAll.length >= 3) {
      const cpDates = cpAll.map(h => parseDate(h.transactionDate)).filter((d): d is Date => d !== null);
      if (cpDates.length >= 2) {
        const sorted = [...cpDates].sort((a, b) => a.getTime() - b.getTime());
        const spanDays = Math.max(1, (sorted[sorted.length - 1]!.getTime() - sorted[0]!.getTime()) / 86400000);
        const cpAvgPerDay = cpAll.length / spanDays;
        if (cpAvgPerDay > 0 && cpDayCount >= cpAvgPerDay * policy.frequencyMultiplier) {
          const ratio = cpDayCount / cpAvgPerDay;
          const score = Math.min(0.70, 0.20 + Math.min(0.50, (ratio - policy.frequencyMultiplier) * 0.04));
          maxScore = Math.max(maxScore, score);
          reasons.push(
            `Counterparty appears ${cpDayCount} times today — ${ratio.toFixed(1)}× their historical daily average`,
          );
          evidence.push({
            key: 'counterpartyDayCount',
            value: cpDayCount,
            expected: `≤ ${(cpAvgPerDay * policy.frequencyMultiplier).toFixed(0)}`,
            contribution: score,
          });
        }
      }
    }

    // Amount-similarity spike (same counterparty, similar amount, many times)
    const similarAmount = sameDay.filter(h => {
      if (h.counterpartyName?.toLowerCase() !== cpName) return false;
      const diff = Math.abs(h.amount - (input.amount ?? 0)) / Math.max(1, input.amount ?? 0);
      return diff <= 0.05; // within 5%
    });
    if (similarAmount.length >= 3) {
      const score = Math.min(0.65, 0.30 + similarAmount.length * 0.05);
      maxScore = Math.max(maxScore, score);
      reasons.push(
        `${similarAmount.length + 1} similar-amount transactions to same counterparty today`,
      );
      evidence.push({ key: 'similarAmountCount', value: similarAmount.length + 1, expected: '< 3', contribution: score });
    }
  }

  const detected = maxScore >= 0.20 && reasons.length > 0;
  const severity = maxScore >= 0.70 ? 'HIGH'
    : maxScore >= 0.45 ? 'MEDIUM'
    : maxScore >= 0.20 ? 'LOW'
    : 'INFO';

  return {
    type: 'FREQUENCY_SPIKE',
    detected,
    score: parseFloat(maxScore.toFixed(4)),
    severity: detected ? severity : 'INFO',
    reason: detected ? reasons : [],
    evidence,
  };
}

function noDetection(note: string): AnomalyDetection {
  return {
    type: 'FREQUENCY_SPIKE',
    detected: false,
    score: 0,
    severity: 'INFO',
    reason: [],
    evidence: [{ key: 'skipped', value: note, contribution: 0 }],
  };
}
