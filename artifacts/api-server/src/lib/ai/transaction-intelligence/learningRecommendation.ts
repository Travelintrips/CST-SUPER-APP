/**
 * AI Transaction Intelligence — Phase 5
 * Learning Recommendation Builder
 *
 * Builds the top-line recommendation for a human administrator based on
 * feedback summary, reliability, conflicts, and suggested rules.
 * Pure function — no DB, no side effects.
 */

import type {
  FeedbackSummary,
  FeedbackReliability,
  FeedbackConflict,
  SuggestedRule,
  SuggestedDictionaryTerm,
  LearningStatus,
  LearningRecommendation,
} from './learningTypes.js';

// ─── Thresholds ────────────────────────────────────────────────────────────────

/** Minimum records before we move from NO_ACTION → COLLECTING. */
const THRESHOLD_COLLECTING = 1;

/** Minimum records + reliability before we move to READY_FOR_RULE. */
const THRESHOLD_READY_FOR_RULE_COUNT = 3;
const THRESHOLD_READY_FOR_RULE_RELIABILITY = 0.55;

/** Minimum records + reliability before we move to READY_FOR_DICTIONARY. */
const THRESHOLD_READY_FOR_DICT_COUNT = 2;
const THRESHOLD_READY_FOR_DICT_RELIABILITY = 0.40;

/** Conflict count threshold before we move to READY_FOR_REVIEW. */
const THRESHOLD_REVIEW_HIGH_CONFLICTS = 1; // any HIGH conflict triggers review
const THRESHOLD_REVIEW_CONFLICT_COUNT = 2; // or ≥2 conflicts of any severity

// ─── Learning Status Determination ────────────────────────────────────────────

/**
 * Determine the current learning status given the evidence.
 */
export function determineLearningStatus(
  totalFeedbackCount: number,
  reliability: FeedbackReliability,
  conflicts: FeedbackConflict[],
  suggestedRules: SuggestedRule[],
  suggestedDictionaryTerms: SuggestedDictionaryTerm[],
): LearningStatus {
  // Any HIGH-severity conflict → request human review
  const highConflicts = conflicts.filter(c => c.severity === 'HIGH');
  if (
    highConflicts.length >= THRESHOLD_REVIEW_HIGH_CONFLICTS ||
    conflicts.length >= THRESHOLD_REVIEW_CONFLICT_COUNT
  ) {
    return 'READY_FOR_REVIEW';
  }

  if (totalFeedbackCount < THRESHOLD_COLLECTING) return 'NO_ACTION';

  // Enough evidence for rule suggestion
  if (
    suggestedRules.length > 0 &&
    totalFeedbackCount >= THRESHOLD_READY_FOR_RULE_COUNT &&
    reliability.score >= THRESHOLD_READY_FOR_RULE_RELIABILITY
  ) {
    return 'READY_FOR_RULE';
  }

  // Enough evidence for dictionary update
  if (
    suggestedDictionaryTerms.length > 0 &&
    totalFeedbackCount >= THRESHOLD_READY_FOR_DICT_COUNT &&
    reliability.score >= THRESHOLD_READY_FOR_DICT_RELIABILITY
  ) {
    return 'READY_FOR_DICTIONARY';
  }

  // Accumulating but not ready
  return 'COLLECTING';
}

// ─── Learning Score ────────────────────────────────────────────────────────────

/**
 * Compute a composite learning score (0.00–1.00) that represents the
 * overall quality and confidence of the learning output.
 */
export function computeLearningScore(
  feedbackCount: number,
  reliability: FeedbackReliability,
  summary: FeedbackSummary,
  conflicts: FeedbackConflict[],
): number {
  if (feedbackCount === 0) return 0;

  // Base: reliability score
  let score = reliability.score * 0.5;

  // Sample-size contribution (log scale, normalised to 0–0.25)
  score += Math.min(0.25, Math.log10(Math.max(1, feedbackCount)) / 4);

  // Reviewer agreement (0–0.15)
  score += summary.approvalRate * 0.15;

  // Penalise conflicts
  const highConflicts = conflicts.filter(c => c.severity === 'HIGH').length;
  const medConflicts  = conflicts.filter(c => c.severity === 'MEDIUM').length;
  score -= highConflicts * 0.15;
  score -= medConflicts  * 0.05;

  return Math.max(0, Math.min(1, score));
}

// ─── Recommendation Builder ────────────────────────────────────────────────────

/**
 * Build a human-facing recommendation from all Phase 5 evidence.
 */
export function buildLearningRecommendation(
  status: LearningStatus,
  summary: FeedbackSummary,
  reliability: FeedbackReliability,
  conflicts: FeedbackConflict[],
  suggestedRules: SuggestedRule[],
  suggestedDictionaryTerms: SuggestedDictionaryTerm[],
): LearningRecommendation {
  switch (status) {
    case 'NO_ACTION':
      return {
        action: 'NONE',
        explanation: 'Insufficient feedback data. Continue collecting reviewer decisions before making recommendations.',
        priority: 'NONE',
      };

    case 'COLLECTING':
      return {
        action: 'MONITOR',
        explanation: `Collecting feedback (${summary.totalCount} record${summary.totalCount !== 1 ? 's' : ''} so far, reliability=${reliability.level}). Continue monitoring reviewer decisions.`,
        priority: 'LOW',
      };

    case 'READY_FOR_REVIEW': {
      const highConflict = conflicts.find(c => c.severity === 'HIGH');
      return {
        action: 'RESOLVE_CONFLICT',
        explanation: highConflict
          ? `Conflict detected: ${highConflict.description} Resolve before proceeding with any rule update.`
          : `${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''} detected in reviewer feedback. Human review required before any learning action.`,
        priority: 'HIGH',
      };
    }

    case 'READY_FOR_RULE': {
      const topRule = suggestedRules[0];
      return {
        action: 'CONSIDER_RULE',
        explanation: topRule
          ? `${suggestedRules.length} rule suggestion${suggestedRules.length !== 1 ? 's' : ''} ready for review. Top suggestion: ${topRule.label} (confidence=${topRule.confidence.toFixed(2)}). Requires human approval before application.`
          : `${suggestedRules.length} rule suggestion${suggestedRules.length !== 1 ? 's' : ''} ready for human review.`,
        priority: reliability.score >= 0.75 ? 'HIGH' : 'MEDIUM',
      };
    }

    case 'READY_FOR_DICTIONARY': {
      const topTerm = suggestedDictionaryTerms[0];
      return {
        action: 'CONSIDER_DICTIONARY_UPDATE',
        explanation: topTerm
          ? `${suggestedDictionaryTerms.length} dictionary term suggestion${suggestedDictionaryTerms.length !== 1 ? 's' : ''} ready for review. Top suggestion: add term "${topTerm.term}" for intent ${topTerm.intent}. Requires human approval before application.`
          : `${suggestedDictionaryTerms.length} dictionary update suggestion${suggestedDictionaryTerms.length !== 1 ? 's' : ''} ready for human review.`,
        priority: 'MEDIUM',
      };
    }
  }
}
