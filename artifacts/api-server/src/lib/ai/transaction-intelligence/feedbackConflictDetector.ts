/**
 * AI Transaction Intelligence — Phase 5
 * Feedback Conflict Detector
 *
 * Detects conflicts and inconsistencies in reviewer feedback.
 * Pure function — no DB, no side effects.
 */

import type { FeedbackRecord, FeedbackConflict } from './learningTypes.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Count distinct values for a getter over a list of records. */
function distinctValues<T>(
  records: FeedbackRecord[],
  getter: (r: FeedbackRecord) => T | undefined,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const r of records) {
    const v = getter(r);
    if (v !== undefined && v !== null) {
      const key = String(v);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(v);
      }
    }
  }
  return result;
}

// ─── Conflict detectors ───────────────────────────────────────────────────────

/** Detect: two or more reviewers made conflicting decisions. */
function detectReviewerDisagreement(records: FeedbackRecord[]): FeedbackConflict | null {
  if (records.length < 2) return null;

  const actionable = records.filter(
    r => r.decision !== 'SKIPPED' && r.decision !== 'UNKNOWN',
  );
  if (actionable.length < 2) return null;

  const decisionsPerReviewer = new Map<string, Set<string>>();
  for (const r of actionable) {
    if (!decisionsPerReviewer.has(r.reviewerId)) {
      decisionsPerReviewer.set(r.reviewerId, new Set());
    }
    decisionsPerReviewer.get(r.reviewerId)!.add(r.decision);
  }

  const allDecisions = new Set(actionable.map(r => r.decision));
  if (allDecisions.size <= 1) return null;

  // More than one distinct decision across multiple reviewers
  const reviewerIds = [...decisionsPerReviewer.keys()];
  if (reviewerIds.length < 2) return null;

  const approvers = actionable.filter(r => r.decision === 'APPROVED').map(r => r.feedbackId);
  const changers = actionable.filter(r => r.decision === 'CHANGED_COA').map(r => r.feedbackId);
  const rejecters = actionable.filter(r => r.decision === 'REJECTED').map(r => r.feedbackId);
  const involved = [...approvers, ...changers, ...rejecters];

  return {
    type: 'REVIEWER_DISAGREEMENT',
    description: `${reviewerIds.length} reviewers made conflicting decisions: ${[...allDecisions].join(', ')}`,
    involvedFeedbackIds: involved.slice(0, 10),
    severity: changers.length > 0 && approvers.length > 0 ? 'HIGH' : 'MEDIUM',
  };
}

/** Detect: reviewers selected different COA codes. */
function detectCoaDisagreement(records: FeedbackRecord[]): FeedbackConflict | null {
  const changedRecords = records.filter(
    r => r.decision === 'CHANGED_COA' && r.selectedCoaCode,
  );
  if (changedRecords.length < 2) return null;

  const uniqueCoas = new Set(changedRecords.map(r => r.selectedCoaCode));
  if (uniqueCoas.size <= 1) return null;

  return {
    type: 'COA_DISAGREEMENT',
    description: `Reviewers selected ${uniqueCoas.size} different COA codes: ${[...uniqueCoas].join(', ')}`,
    involvedFeedbackIds: changedRecords.map(r => r.feedbackId),
    severity: uniqueCoas.size >= 3 ? 'HIGH' : 'MEDIUM',
  };
}

/** Detect: different AI intents appear across records (AI inconsistency). */
function detectIntentDisagreement(records: FeedbackRecord[]): FeedbackConflict | null {
  const intents = distinctValues(records, r => r.aiRecommendedIntent);
  if (intents.length <= 1) return null;

  const ids = records
    .filter(r => r.aiRecommendedIntent !== undefined)
    .map(r => r.feedbackId);

  return {
    type: 'INTENT_DISAGREEMENT',
    description: `AI recommended different intents across feedback records: ${intents.join(', ')}`,
    involvedFeedbackIds: ids.slice(0, 10),
    severity: intents.length >= 3 ? 'HIGH' : 'LOW',
  };
}

/** Detect: feedback spans multiple companies. */
function detectCompanyMismatch(records: FeedbackRecord[]): FeedbackConflict | null {
  const companies = new Set(records.map(r => String(r.companyId)));
  if (companies.size <= 1) return null;

  return {
    type: 'COMPANY_MISMATCH',
    description: `Feedback records span ${companies.size} different companies: ${[...companies].join(', ')}`,
    involvedFeedbackIds: records.map(r => r.feedbackId),
    severity: 'HIGH',
  };
}

/** Detect: many records have low AI confidence yet were approved. */
function detectLowConfidencePattern(records: FeedbackRecord[]): FeedbackConflict | null {
  const lowConfApproved = records.filter(
    r => r.decision === 'APPROVED' && (r.aiConfidenceAtReview ?? 1) < 0.5,
  );
  if (lowConfApproved.length < 2) return null;

  return {
    type: 'LOW_CONFIDENCE_PATTERN',
    description: `${lowConfApproved.length} transactions with AI confidence < 0.50 were approved. This may indicate over-reliance on the AI recommendation.`,
    involvedFeedbackIds: lowConfApproved.map(r => r.feedbackId),
    severity: 'MEDIUM',
  };
}

/** Detect: historical evidence contradicts current feedback. */
function detectHistoricalContradiction(
  currentRecord: FeedbackRecord,
  historicalRecords: FeedbackRecord[],
): FeedbackConflict | null {
  if (historicalRecords.length < 2) return null;

  // Check: AI previously recommended a COA but reviewer now always corrects to a different one
  const historicalDecisions = historicalRecords.map(r => r.decision);
  const historicalApprovals = historicalDecisions.filter(d => d === 'APPROVED').length;
  const historicalChanges = historicalDecisions.filter(d => d === 'CHANGED_COA').length;

  // Contradiction: history says APPROVED (AI was right) but now CHANGED_COA
  if (
    currentRecord.decision === 'CHANGED_COA' &&
    historicalApprovals >= 3 &&
    historicalChanges === 0
  ) {
    return {
      type: 'HISTORICAL_CONTRADICTION',
      description: `Current reviewer changed COA but ${historicalApprovals} prior reviews approved the AI recommendation for this pattern.`,
      involvedFeedbackIds: [currentRecord.feedbackId, ...historicalRecords.slice(0, 3).map(r => r.feedbackId)],
      severity: 'MEDIUM',
    };
  }

  // Contradiction: history says CHANGED_COA but now APPROVED
  if (
    currentRecord.decision === 'APPROVED' &&
    historicalChanges >= 3 &&
    historicalApprovals === 0
  ) {
    return {
      type: 'HISTORICAL_CONTRADICTION',
      description: `Current reviewer approved but ${historicalChanges} prior reviews changed the COA for this pattern.`,
      involvedFeedbackIds: [currentRecord.feedbackId, ...historicalRecords.slice(0, 3).map(r => r.feedbackId)],
      severity: 'MEDIUM',
    };
  }

  return null;
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Detect all conflicts in a collection of feedback records.
 *
 * @param currentRecord  - The most recent feedback record.
 * @param historicalRecords - Prior feedback records for the same pattern.
 * @returns Array of detected conflicts (may be empty).
 */
export function detectFeedbackConflicts(
  currentRecord: FeedbackRecord,
  historicalRecords: FeedbackRecord[],
): FeedbackConflict[] {
  const all = [currentRecord, ...historicalRecords];
  const conflicts: FeedbackConflict[] = [];

  const c1 = detectReviewerDisagreement(all);
  if (c1) conflicts.push(c1);

  const c2 = detectCoaDisagreement(all);
  if (c2) conflicts.push(c2);

  const c3 = detectIntentDisagreement(all);
  if (c3) conflicts.push(c3);

  const c4 = detectCompanyMismatch(all);
  if (c4) conflicts.push(c4);

  const c5 = detectLowConfidencePattern(all);
  if (c5) conflicts.push(c5);

  const c6 = detectHistoricalContradiction(currentRecord, historicalRecords);
  if (c6) conflicts.push(c6);

  return conflicts;
}
