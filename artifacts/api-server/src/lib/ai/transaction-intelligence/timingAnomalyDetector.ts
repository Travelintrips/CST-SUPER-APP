/**
 * AI Transaction Intelligence — Phase 7
 * Timing Anomaly Detector
 *
 * Detects:
 *   - Transaction at unusual hours (configurable, default 00:00–06:00)
 *   - Transaction on unusual day of week (weekend if not a weekend-active company)
 *
 * Time is ALWAYS injected through input — never uses Date.now() or server timezone.
 * Pure function — no side effects.
 */

import type {
  AnomalyDetection,
  AnomalyEvidence,
  CompanyAnomalyBaseline,
  AnomalyDetectionPolicy,
} from './anomalyTypes.js';
import { parseDate } from './anomalyRules.js';
import { mergePolicy } from './anomalyRules.js';

// ─── Detector ─────────────────────────────────────────────────────────────────

export interface TimingDetectorInput {
  transactionDate: string | Date;
  baseline?: CompanyAnomalyBaseline;
  policy?: AnomalyDetectionPolicy;
}

export function detectTimingAnomaly(input: TimingDetectorInput): {
  unusualTime: AnomalyDetection;
  unusualDay: AnomalyDetection;
} {
  const policy = mergePolicy(input.policy);
  const txDate = parseDate(input.transactionDate);

  if (!txDate) {
    return {
      unusualTime: skip('UNUSUAL_TRANSACTION_TIME'),
      unusualDay: skip('UNUSUAL_TRANSACTION_DAY'),
    };
  }

  const hour = txDate.getHours();       // 0–23
  const dayOfWeek = txDate.getDay();    // 0 = Sunday, 6 = Saturday

  // ── Unusual hour ───────────────────────────────────────────────────────────
  const { unusualHourStart, unusualHourEnd } = policy;
  // Default window: 00:00–06:00 (midnight to early morning)
  const isUnusualHour = unusualHourStart <= unusualHourEnd
    ? hour >= unusualHourStart && hour < unusualHourEnd
    : hour >= unusualHourStart || hour < unusualHourEnd; // wraps midnight

  const timeEvidence: AnomalyEvidence[] = [
    { key: 'transactionHour', value: hour, expected: `outside ${unusualHourStart}:00–${unusualHourEnd}:00`, contribution: isUnusualHour ? 0.20 : 0 },
  ];

  // Check against baseline "usual hours" if available
  let timeScore = isUnusualHour ? 0.20 : 0;
  const timeReasons: string[] = [];

  if (isUnusualHour) {
    timeReasons.push(`Transaction at ${hour.toString().padStart(2, '0')}:00 is within unusual hour window (${unusualHourStart}:00–${unusualHourEnd}:00)`);
  }

  if (input.baseline?.usualHours && input.baseline.usualHours.length > 0) {
    const usualHours = new Set(input.baseline.usualHours);
    if (!usualHours.has(hour)) {
      const score = 0.25;
      timeScore = Math.max(timeScore, score);
      if (!isUnusualHour) {
        timeReasons.push(`Transaction at hour ${hour} is outside the company's usual transaction hours`);
        timeEvidence.push({ key: 'outsideUsualHours', value: true, contribution: score });
      }
    }
  }

  // Midnight is especially suspicious
  if (hour === 0) {
    timeScore = Math.max(timeScore, 0.28);
    if (!timeReasons.some(r => r.includes('00:00'))) {
      timeReasons.push('Transaction at midnight (00:xx) is unusual for most business operations');
    }
  }

  const timeDetected = timeScore >= 0.15;
  const timeSeverity = timeScore >= 0.25 ? 'LOW' : 'INFO';

  // ── Unusual day ────────────────────────────────────────────────────────────
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const dayEvidence: AnomalyEvidence[] = [
    { key: 'dayOfWeek', value: dayOfWeek, contribution: 0 },
    { key: 'isWeekend', value: isWeekend, contribution: 0 },
  ];
  const dayReasons: string[] = [];
  let dayScore = 0;

  if (isWeekend) {
    // Check if company normally operates on weekends
    const weekendNormal = input.baseline?.usualDaysOfWeek
      ? input.baseline.usualDaysOfWeek.includes(dayOfWeek)
      : false;

    if (!weekendNormal && input.baseline?.sampleSize != null && input.baseline.sampleSize >= 10) {
      // Company has sufficient history and weekends are not normal
      dayScore = 0.20;
      dayReasons.push(
        `Transaction on ${dayOfWeek === 0 ? 'Sunday' : 'Saturday'} — company has no history of weekend transactions`,
      );
      dayEvidence.push({ key: 'weekendTransaction', value: true, expected: 'weekday', contribution: dayScore });
    } else if (!weekendNormal && !input.baseline) {
      // No baseline — mild flag
      dayScore = 0.10;
      dayReasons.push(`Transaction on ${dayOfWeek === 0 ? 'Sunday' : 'Saturday'} with no historical baseline`);
    }
    // If weekendNormal = true → no flag (company operates on weekends)
  }

  // Flag if day is explicitly outside usual days
  if (input.baseline?.usualDaysOfWeek && input.baseline.usualDaysOfWeek.length >= 3) {
    const usualDays = new Set(input.baseline.usualDaysOfWeek);
    if (!usualDays.has(dayOfWeek)) {
      dayScore = Math.max(dayScore, 0.22);
      if (dayReasons.length === 0) {
        dayReasons.push(`Transaction on day ${dayOfWeek} is outside the company's usual operating days`);
        dayEvidence.push({ key: 'outsideUsualDays', value: true, contribution: 0.22 });
      }
    }
  }

  const dayDetected = dayScore >= 0.10;
  const daySeverity = dayScore >= 0.20 ? 'LOW' : 'INFO';

  return {
    unusualTime: {
      type: 'UNUSUAL_TRANSACTION_TIME',
      detected: timeDetected,
      score: parseFloat(timeScore.toFixed(4)),
      severity: timeDetected ? timeSeverity : 'INFO',
      reason: timeDetected ? timeReasons : [],
      evidence: timeEvidence,
    },
    unusualDay: {
      type: 'UNUSUAL_TRANSACTION_DAY',
      detected: dayDetected,
      score: parseFloat(dayScore.toFixed(4)),
      severity: dayDetected ? daySeverity : 'INFO',
      reason: dayDetected ? dayReasons : [],
      evidence: dayEvidence,
    },
  };
}

function skip(type: 'UNUSUAL_TRANSACTION_TIME' | 'UNUSUAL_TRANSACTION_DAY'): AnomalyDetection {
  return {
    type,
    detected: false,
    score: 0,
    severity: 'INFO',
    reason: [],
    evidence: [{ key: 'skipped', value: 'invalid date', contribution: 0 }],
  };
}
