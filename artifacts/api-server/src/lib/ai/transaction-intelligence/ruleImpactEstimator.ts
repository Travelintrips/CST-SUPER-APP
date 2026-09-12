/**
 * AI Transaction Intelligence — Phase 6
 * Rule Impact Estimator
 *
 * Estimates the business impact of applying a set of recommendations:
 *   - estimated transactions affected
 *   - estimated precision gain
 *   - estimated manual review reduction
 *   - 95% confidence interval
 *
 * Pure function — no side effects, no DB calls.
 */

import type { ImpactAnalysis } from './adaptiveRuleTypes.js';
import type { LearningSignal } from './learningEngineTypes.js';

// ─── Input ─────────────────────────────────────────────────────────────────────

export interface ImpactEstimatorInput {
  /** All learning signals (used to estimate affected transaction volume). */
  signals: LearningSignal[];
  /** Total feedback records processed (denominator for rate estimates). */
  totalFeedbackProcessed: number;
  /** Current overall acceptance rate (0–1). */
  currentAcceptanceRate: number;
  /** Number of rule recommendations being proposed. */
  ruleCount: number;
  /** Number of dictionary entries being proposed. */
  dictionaryCount: number;
  /** Number of counterparty mappings being proposed. */
  counterpartyCount: number;
  /** Average confidence of all recommendations (0–1). */
  avgRecommendationConfidence: number;
  /** Average consistency rate of all supporting signals (0–1). */
  avgConsistencyRate: number;
  /** Number of conflicts detected. */
  conflictCount: number;
}

// ─── Estimator ─────────────────────────────────────────────────────────────────

/**
 * Estimate the total distinct transactions affected by the recommendations.
 * Uses the total occurrence count across strong signals as a proxy.
 */
function estimateAffectedTransactions(input: ImpactEstimatorInput): number {
  const totalOccurrences = input.signals.reduce((sum, s) => sum + s.occurrenceCount, 0);
  // Strong signals represent the patterns that would change behaviour
  const strongOccurrences = input.signals
    .filter((s) => s.signalConfidence >= 0.7)
    .reduce((sum, s) => sum + s.occurrenceCount, 0);

  // Use strong occurrences as primary estimate, with a small fraction from
  // the broader signal set
  const base = strongOccurrences + totalOccurrences * 0.1;
  return Math.round(Math.min(base, input.totalFeedbackProcessed * 0.9));
}

/**
 * Estimate precision gain.
 *
 * Formula: (avgConfidence × avgConsistency × changeDepth) × conflictPenalty
 * where changeDepth represents how broad the change set is.
 */
function estimatePrecisionGain(input: ImpactEstimatorInput): number {
  const changeDepth = Math.min(
    1,
    (input.ruleCount + input.dictionaryCount + input.counterpartyCount) / 20,
  );
  const rawGain = input.avgRecommendationConfidence * input.avgConsistencyRate * changeDepth;

  // Conflicts reduce expected gain
  const conflictPenalty = Math.max(0, 1 - input.conflictCount * 0.05);

  return Math.min(0.30, rawGain * conflictPenalty); // cap at 30% single-batch gain
}

/**
 * Estimate manual review reduction.
 *
 * Recommendations that resolve ambiguous patterns → fewer MANUAL_REVIEW flags.
 * Current manual review rate ~ (1 - acceptanceRate).
 */
function estimateManualReviewReduction(input: ImpactEstimatorInput): number {
  const currentReviewRate = 1 - input.currentAcceptanceRate;
  const improvementFactor = input.avgConsistencyRate * input.avgRecommendationConfidence * 0.5;
  return Math.min(currentReviewRate * 0.5, improvementFactor); // cap at halving review rate
}

/**
 * Compute 95% confidence interval for the precision gain estimate.
 * Uses a simple ±σ based on consistency spread.
 */
function computeConfidenceInterval(
  precisionGain: number,
  avgConsistencyRate: number,
  signalCount: number,
): [number, number] {
  // Standard error shrinks with more signals
  const se = (1 - avgConsistencyRate) / Math.sqrt(Math.max(1, signalCount));
  const margin = 1.96 * se; // 95% z-score
  return [
    Math.max(0, precisionGain - margin),
    Math.min(1, precisionGain + margin),
  ];
}

/**
 * Build a human-readable impact summary.
 */
function buildSummary(
  affected: number,
  precisionGain: number,
  reviewReduction: number,
): string {
  const precisionPct = (precisionGain * 100).toFixed(1);
  const reviewPct = (reviewReduction * 100).toFixed(1);
  return (
    `Applying these recommendations is estimated to affect ${affected.toLocaleString()} transactions, ` +
    `improving prediction precision by ~${precisionPct}% and reducing manual review rate by ~${reviewPct}%.`
  );
}

// ─── Main estimator function ───────────────────────────────────────────────────

export function estimateImpact(input: ImpactEstimatorInput): ImpactAnalysis {
  const estimatedTransactionsAffected = estimateAffectedTransactions(input);
  const estimatedPrecisionGain = estimatePrecisionGain(input);
  const estimatedManualReviewReduction = estimateManualReviewReduction(input);
  const confidenceInterval = computeConfidenceInterval(
    estimatedPrecisionGain,
    input.avgConsistencyRate,
    input.signals.length,
  );

  return {
    estimatedTransactionsAffected,
    estimatedPrecisionGain,
    estimatedManualReviewReduction,
    confidenceInterval,
    summary: buildSummary(
      estimatedTransactionsAffected,
      estimatedPrecisionGain,
      estimatedManualReviewReduction,
    ),
  };
}
