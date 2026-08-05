/**
 * AI Transaction Intelligence — Phase 7
 * Split Transaction Detector
 *
 * Detects potential transaction splitting (structuring):
 *   - Multiple transactions to same counterparty within window
 *   - Individual amounts just below approval threshold
 *   - Total of split transactions exceeds threshold
 *
 * Uses language "Potential split transaction pattern" — never "fraud confirmed".
 * Pure function — no side effects.
 */

import type {
  AnomalyDetection,
  AnomalyEvidence,
  HistoricalTransactionRecord,
  AnomalyDetectionPolicy,
} from './anomalyTypes.js';
import { parseDate, hoursBetween } from './anomalyRules.js';
import { mergePolicy } from './anomalyRules.js';

// ─── Detector ─────────────────────────────────────────────────────────────────

export interface SplitTransactionDetectorInput {
  amount: number;
  transactionDate: string | Date;
  counterpartyName?: string;
  companyId: string | number;
  historical: HistoricalTransactionRecord[];
  policy?: AnomalyDetectionPolicy;
}

export function detectSplitTransaction(input: SplitTransactionDetectorInput): AnomalyDetection {
  const policy = mergePolicy(input.policy);
  const txDate = parseDate(input.transactionDate);

  if (!txDate) {
    return noDetect();
  }

  const {
    splitTransactionWindowHours,
    splitTransactionMinimumCount,
    splitTransactionAmountTolerance,
    approvalThresholds,
  } = policy;

  const sameCompany = input.historical.filter(
    h => String(h.companyId) === String(input.companyId),
  );

  const evidence: AnomalyEvidence[] = [];
  const reasons: string[] = [];
  let score = 0;

  // ── Find transactions within the window to the same counterparty ──────────
  const windowCandidates = sameCompany.filter(h => {
    const hDate = parseDate(h.transactionDate);
    if (!hDate) return false;
    if (hoursBetween(hDate, txDate) > splitTransactionWindowHours) return false;
    // Same counterparty (or no counterparty filter)
    if (input.counterpartyName && h.counterpartyName) {
      return h.counterpartyName.toLowerCase() === input.counterpartyName.toLowerCase();
    }
    return true; // No counterparty filter
  });

  const groupCount = windowCandidates.length + 1; // +1 for current tx

  if (groupCount < splitTransactionMinimumCount) {
    return noDetect();
  }

  // ── Check proximity to approval thresholds ────────────────────────────────
  const allAmounts = [...windowCandidates.map(h => h.amount), input.amount];
  const totalAmount = allAmounts.reduce((s, a) => s + a, 0);

  const thresholdsToCheck = approvalThresholds && approvalThresholds.length > 0
    ? approvalThresholds
    : [];

  let nearThreshold = false;
  let closestThreshold = 0;
  let proximityScore = 0;

  for (const threshold of thresholdsToCheck) {
    if (threshold <= 0) continue;
    // Check if individual amounts are just below the threshold
    const belowThreshold = allAmounts.every(
      a => a < threshold && a >= threshold * (1 - splitTransactionAmountTolerance),
    );
    // Or: total exceeds threshold but individual amounts don't
    const totalExceedsThreshold = totalAmount >= threshold;
    const individualsBelowThreshold = allAmounts.every(a => a < threshold);

    if (belowThreshold || (totalExceedsThreshold && individualsBelowThreshold)) {
      nearThreshold = true;
      closestThreshold = threshold;
      proximityScore = belowThreshold ? 0.80 : 0.60;
      break;
    }
  }

  // ── Base split score from count and total ─────────────────────────────────
  const countScore = Math.min(0.60, 0.30 + (groupCount - splitTransactionMinimumCount) * 0.08);
  score = Math.max(countScore, proximityScore);

  // Adjust for same-amount pattern (stronger signal)
  const amounts = allAmounts;
  const maxDiff = Math.max(...amounts) - Math.min(...amounts);
  const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  const isUniformAmount = avgAmount > 0 && maxDiff / avgAmount <= splitTransactionAmountTolerance;
  if (isUniformAmount) {
    score = Math.min(0.90, score + 0.15);
    reasons.push(
      `${groupCount} transactions with uniform amount (~${avgAmount.toLocaleString()}) within ${splitTransactionWindowHours}h`,
    );
    evidence.push({ key: 'uniformAmount', value: avgAmount, contribution: 0.15 });
  } else {
    reasons.push(
      `${groupCount} transactions totalling ${totalAmount.toLocaleString()} within ${splitTransactionWindowHours}h`,
    );
  }

  if (nearThreshold && closestThreshold > 0) {
    reasons.push(
      `Potential split transaction pattern: ${groupCount} individual amounts near approval threshold ${closestThreshold.toLocaleString()}, total (${totalAmount.toLocaleString()}) exceeds it`,
    );
    evidence.push({
      key: 'approvalThreshold',
      value: closestThreshold,
      contribution: proximityScore,
    });
  }

  if (input.counterpartyName) {
    evidence.push({ key: 'counterparty', value: input.counterpartyName, contribution: 0 });
  }
  evidence.push({ key: 'transactionCount', value: groupCount, expected: `< ${splitTransactionMinimumCount}`, contribution: countScore });
  evidence.push({ key: 'totalAmount', value: totalAmount, contribution: 0 });
  evidence.push({ key: 'windowHours', value: splitTransactionWindowHours, contribution: 0 });

  const detected = score >= 0.30;
  const severity = score >= 0.80 ? 'HIGH'
    : score >= 0.55 ? 'MEDIUM'
    : 'LOW';

  return {
    type: 'SPLIT_TRANSACTION',
    detected,
    score: parseFloat(score.toFixed(4)),
    severity: detected ? severity : 'INFO',
    reason: detected ? reasons : [],
    evidence: detected ? evidence : [],
  };
}

function noDetect(): AnomalyDetection {
  return { type: 'SPLIT_TRANSACTION', detected: false, score: 0, severity: 'INFO', reason: [], evidence: [] };
}
