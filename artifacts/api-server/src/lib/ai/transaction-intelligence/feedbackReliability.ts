/**
 * AI Transaction Intelligence — Phase 5
 * Feedback Reliability Calculator
 *
 * Computes a composite reliability score from a body of feedback evidence.
 * Pure function — no DB, no side effects.
 */

import type { FeedbackRecord, FeedbackReliability } from './learningTypes.js';

// ─── Thresholds ────────────────────────────────────────────────────────────────

const RELIABILITY_THRESHOLDS = {
  HIGH: 0.75,
  MEDIUM: 0.50,
  LOW: 0.30,
} as const;

/** Minimum number of records before any reliability can be computed meaningfully. */
const MIN_RECORDS_FOR_RELIABILITY = 2;

/** Weight given to each component of the reliability score. */
const RELIABILITY_WEIGHTS = {
  reviewerConsistency:    0.25,
  historicalAgreement:    0.20,
  coaConsistency:         0.20,
  intentConsistency:      0.15,
  sampleSizeBonus:        0.10,
  counterpartyConsistency:0.10,
} as const;

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Compute the fraction of records matching the most-common value for a given key getter. */
function computeConsistency<T>(
  records: FeedbackRecord[],
  getter: (r: FeedbackRecord) => T | undefined,
): number {
  if (records.length === 0) return 0;

  const values = records
    .map(getter)
    .filter((v): v is T => v !== undefined && v !== null && v !== '');

  if (values.length === 0) return 1; // unknown = assume consistent

  const counts = new Map<string, number>();
  for (const v of values) {
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const maxCount = Math.max(...counts.values());
  return maxCount / values.length;
}

/** Compute consistency of reviewer decisions (not counting SKIPPED/UNKNOWN). */
function computeReviewerConsistency(records: FeedbackRecord[]): number {
  const actionable = records.filter(
    r => r.decision !== 'SKIPPED' && r.decision !== 'UNKNOWN',
  );
  if (actionable.length < 2) return 1;

  return computeConsistency(actionable, r => r.decision);
}

/** Compute how well historical feedback agrees with the current body of evidence. */
function computeHistoricalAgreement(records: FeedbackRecord[]): number {
  if (records.length < MIN_RECORDS_FOR_RELIABILITY) return 0;

  const approvalCount = records.filter(r => r.decision === 'APPROVED').length;
  const actionable = records.filter(
    r => r.decision !== 'SKIPPED' && r.decision !== 'UNKNOWN',
  ).length;

  if (actionable === 0) return 0;
  return approvalCount / actionable;
}

/** Compute a bonus for larger sample sizes (logarithmic, capped at 1.0). */
function sampleSizeBonus(count: number): number {
  if (count <= 1) return 0;
  // log10(10) = 1.0, log10(5) ≈ 0.70, log10(2) ≈ 0.30
  return Math.min(1, Math.log10(count));
}

/** Compute confidence trend across ordered records. */
function computeConfidenceTrend(
  records: FeedbackRecord[],
): FeedbackReliability['confidenceTrend'] {
  const confidences = records
    .filter(r => r.aiConfidenceAtReview !== undefined)
    .map(r => r.aiConfidenceAtReview as number);

  if (confidences.length < 3) return 'INSUFFICIENT_DATA';

  const first = confidences.slice(0, Math.ceil(confidences.length / 2));
  const last = confidences.slice(Math.floor(confidences.length / 2));

  const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
  const avgLast = last.reduce((a, b) => a + b, 0) / last.length;

  const delta = avgLast - avgFirst;
  if (delta > 0.05) return 'IMPROVING';
  if (delta < -0.05) return 'DECLINING';
  return 'STABLE';
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute reliability of a body of feedback records.
 *
 * @param records - All feedback records to evaluate (including current).
 * @returns FeedbackReliability
 */
export function computeFeedbackReliability(records: FeedbackRecord[]): FeedbackReliability {
  const reasons: string[] = [];

  if (records.length === 0) {
    return {
      score: 0,
      level: 'VERY_LOW',
      approvalCount: 0,
      rejectionCount: 0,
      reviewerConsistency: 0,
      historicalAgreement: 0,
      companyScopeConsistent: true,
      intentConsistency: 1,
      counterpartyConsistency: 1,
      coaConsistency: 1,
      confidenceTrend: 'INSUFFICIENT_DATA',
      reasons: ['No feedback records available'],
    };
  }

  const approvalCount = records.filter(r => r.decision === 'APPROVED').length;
  const rejectionCount = records.filter(r => r.decision === 'REJECTED').length;

  // Company scope consistency
  const companies = new Set(records.map(r => String(r.companyId)));
  const companyScopeConsistent = companies.size === 1;
  if (!companyScopeConsistent) {
    reasons.push(`Feedback spans ${companies.size} companies — reduced reliability`);
  }

  // Reviewer consistency
  const reviewerConsistency = computeReviewerConsistency(records);
  if (reviewerConsistency < 0.7) {
    reasons.push(`Reviewers disagree (consistency=${reviewerConsistency.toFixed(2)})`);
  }

  // Historical agreement
  const historicalAgreement = computeHistoricalAgreement(records);
  if (historicalAgreement > 0.8) {
    reasons.push('Strong historical approval pattern');
  }

  // Intent consistency
  const intentConsistency = computeConsistency(records, r => r.aiRecommendedIntent);
  if (intentConsistency < 0.7) {
    reasons.push('Inconsistent AI intent across feedback records');
  }

  // Counterparty consistency
  const counterpartyConsistency = computeConsistency(records, r => r.counterpartyName);

  // COA consistency
  const coaConsistency = computeConsistency(records, r => r.selectedCoaCode ?? r.aiRecommendedCoaCode);
  if (coaConsistency < 0.6) {
    reasons.push('COA selection varies widely across feedback');
  }

  // Sample size bonus
  const sizeBonus = sampleSizeBonus(records.length);
  if (records.length >= 10) {
    reasons.push(`Strong sample size (${records.length} records)`);
  } else if (records.length === 1) {
    reasons.push('Single feedback record — low confidence');
  }

  // Composite score
  const score = Math.min(
    1,
    reviewerConsistency      * RELIABILITY_WEIGHTS.reviewerConsistency +
    historicalAgreement      * RELIABILITY_WEIGHTS.historicalAgreement +
    coaConsistency           * RELIABILITY_WEIGHTS.coaConsistency +
    intentConsistency        * RELIABILITY_WEIGHTS.intentConsistency +
    sizeBonus                * RELIABILITY_WEIGHTS.sampleSizeBonus +
    counterpartyConsistency  * RELIABILITY_WEIGHTS.counterpartyConsistency,
  ) * (companyScopeConsistent ? 1 : 0.8);

  const level: FeedbackReliability['level'] =
    score >= RELIABILITY_THRESHOLDS.HIGH   ? 'HIGH'     :
    score >= RELIABILITY_THRESHOLDS.MEDIUM ? 'MEDIUM'   :
    score >= RELIABILITY_THRESHOLDS.LOW    ? 'LOW'      :
                                             'VERY_LOW';

  const confidenceTrend = computeConfidenceTrend(records);
  if (confidenceTrend === 'IMPROVING') {
    reasons.push('AI confidence is improving over time');
  } else if (confidenceTrend === 'DECLINING') {
    reasons.push('AI confidence is declining — review rule quality');
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    level,
    approvalCount,
    rejectionCount,
    reviewerConsistency,
    historicalAgreement,
    companyScopeConsistent,
    intentConsistency,
    counterpartyConsistency,
    coaConsistency,
    confidenceTrend,
    reasons,
  };
}
