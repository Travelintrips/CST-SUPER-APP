/**
 * AI Transaction Intelligence — Phase 5
 * Feedback Analyzer
 *
 * Analyzes a collection of feedback records to extract patterns,
 * dominant decisions, and reviewer agreement signals.
 * Pure function — no DB, no side effects.
 */

import type {
  FeedbackRecord,
  FeedbackSummary,
  ReviewerDecision,
  LearningEvidence,
} from './learningTypes.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Count occurrences of each value produced by a getter. */
function countBy<T>(
  items: T[],
  getter: (item: T) => string | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = getter(item);
    if (key !== undefined && key !== '') {
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return map;
}

/** Return the key with the highest count. */
function topEntry(map: Map<string, number>): string | undefined {
  let topKey: string | undefined;
  let topCount = 0;
  for (const [k, v] of map) {
    if (v > topCount) {
      topCount = v;
      topKey = k;
    }
  }
  return topKey;
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Build a feedback summary from a list of feedback records.
 *
 * The `currentRecord` is the most-recent feedback entry (just submitted).
 * `historicalRecords` are previous feedback records for the same pattern.
 */
export function analyzeFeedback(
  currentRecord: FeedbackRecord,
  historicalRecords: FeedbackRecord[],
): FeedbackSummary {
  const all = [currentRecord, ...historicalRecords];

  const approvedCount   = all.filter(r => r.decision === 'APPROVED').length;
  const changedCoaCount = all.filter(r => r.decision === 'CHANGED_COA').length;
  const rejectedCount   = all.filter(r => r.decision === 'REJECTED').length;
  const skippedCount    = all.filter(r => r.decision === 'SKIPPED').length;
  const unknownCount    = all.filter(r => r.decision === 'UNKNOWN').length;

  const actionableCount = approvedCount + changedCoaCount + rejectedCount;

  const approvalRate  = actionableCount > 0 ? approvedCount   / actionableCount : 0;
  const changeRate    = actionableCount > 0 ? changedCoaCount / actionableCount : 0;
  const rejectionRate = actionableCount > 0 ? rejectedCount   / actionableCount : 0;

  // Dominant corrected COA
  const changedRecords = all.filter(r => r.decision === 'CHANGED_COA');
  const coaCodeCounts = countBy(changedRecords, r => r.selectedCoaCode);
  const dominantCorrectedCoaCode = topEntry(coaCodeCounts);
  const dominantCorrectedCoaName = dominantCorrectedCoaCode
    ? changedRecords.find(r => r.selectedCoaCode === dominantCorrectedCoaCode)?.selectedCoaName
    : undefined;

  // Distinct reviewers
  const reviewerSet = new Set(all.map(r => r.reviewerId));
  const distinctReviewerCount = reviewerSet.size;

  // Reviewer agreement: do most reviewers make the same decision?
  const decisionCounts = countBy(all, r => r.decision);
  const topDecision = topEntry(decisionCounts) as ReviewerDecision ?? 'UNKNOWN';
  const topDecisionCount = decisionCounts.get(topDecision) ?? 0;
  const reviewersAgreeing = distinctReviewerCount <= 1 || topDecisionCount / all.length >= 0.8;

  return {
    totalCount: all.length,
    approvedCount,
    changedCoaCount,
    rejectedCount,
    skippedCount,
    unknownCount,
    approvalRate,
    changeRate,
    rejectionRate,
    dominantCorrectedCoaCode,
    dominantCorrectedCoaName,
    distinctReviewerCount,
    reviewersAgreeing,
    dominantDecision: topDecision,
  };
}

/**
 * Build learning evidence items from the feedback analysis.
 */
export function buildFeedbackEvidence(
  summary: FeedbackSummary,
  historicalCount: number,
): LearningEvidence[] {
  const evidence: LearningEvidence[] = [];

  if (summary.totalCount > 0) {
    evidence.push({
      type: 'FEEDBACK_PATTERN',
      description: `${summary.totalCount} feedback records analysed (${summary.approvedCount} approved, ${summary.changedCoaCount} changed, ${summary.rejectedCount} rejected)`,
      weight: Math.min(1, summary.totalCount / 10),
      count: summary.totalCount,
    });
  }

  if (summary.reviewersAgreeing && summary.distinctReviewerCount > 1) {
    evidence.push({
      type: 'REVIEWER_AGREEMENT',
      description: `${summary.distinctReviewerCount} reviewers agree on decision: ${summary.dominantDecision}`,
      weight: Math.min(1, 0.4 + summary.distinctReviewerCount * 0.1),
      count: summary.distinctReviewerCount,
    });
  } else if (summary.distinctReviewerCount > 1 && !summary.reviewersAgreeing) {
    evidence.push({
      type: 'REVIEWER_AGREEMENT',
      description: `${summary.distinctReviewerCount} reviewers disagree — conflicting decisions detected`,
      weight: 0.1,
      count: summary.distinctReviewerCount,
    });
  }

  if (historicalCount > 0) {
    evidence.push({
      type: 'HISTORICAL_CONSISTENCY',
      description: `${historicalCount} historical feedback records available for this pattern`,
      weight: Math.min(1, historicalCount / 5),
      count: historicalCount,
    });
  }

  if (summary.dominantCorrectedCoaCode) {
    evidence.push({
      type: 'COA_PATTERN',
      description: `Reviewers consistently correct to COA ${summary.dominantCorrectedCoaCode} (${summary.changedCoaCount} times)`,
      weight: Math.min(1, summary.changedCoaCount / 3),
      count: summary.changedCoaCount,
    });
  }

  return evidence;
}

/**
 * Compute reviewer agreement fraction (0.00–1.00).
 * Agreement = fraction of reviewers who approved (accepted AI recommendation).
 */
export function computeReviewerAgreement(
  currentDecision: ReviewerDecision,
  historicalRecords: FeedbackRecord[],
): number {
  const all = [currentDecision, ...historicalRecords.map(r => r.decision)];
  const actionable = all.filter(d => d !== 'SKIPPED' && d !== 'UNKNOWN');
  if (actionable.length === 0) return 0;

  const approved = actionable.filter(d => d === 'APPROVED').length;
  return approved / actionable.length;
}
