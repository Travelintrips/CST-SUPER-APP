/**
 * AI Transaction Intelligence — Phase 8
 * Reviewer Decision Service
 *
 * Validates and processes reviewer decisions.
 * Generates Phase 5-compatible feedback payloads.
 * Pure function — no side effects, no DB calls, no journal posting.
 */

import type {
  ReviewerDecisionInput,
  ReviewerDecisionRecord,
  AIReviewCase,
  ReviewStatus,
} from './reviewOrchestrationTypes.js';
import { transitionReviewCase, decisionToStatus } from './reviewStateMachine.js';
import { generateDecisionId } from './reviewIdempotency.js';

// ─── Validation ───────────────────────────────────────────────────────────────

export class ReviewDecisionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewDecisionValidationError';
  }
}

function validateDecisionInput(input: ReviewerDecisionInput): void {
  if (!input.reviewCaseId?.trim()) {
    throw new ReviewDecisionValidationError('reviewCaseId is required');
  }
  if (!input.reviewerId) {
    throw new ReviewDecisionValidationError('reviewerId is required');
  }
  if (!input.idempotencyKey?.trim()) {
    throw new ReviewDecisionValidationError('idempotencyKey is required');
  }
  if (!input.decidedAt) {
    throw new ReviewDecisionValidationError('decidedAt is required');
  }
  if (input.reviewerConfidence != null) {
    if (input.reviewerConfidence < 0 || input.reviewerConfidence > 1) {
      throw new ReviewDecisionValidationError('reviewerConfidence must be in [0, 1]');
    }
  }

  switch (input.decision) {
    case 'CHANGE_COA':
      if (!input.selectedCoa) {
        throw new ReviewDecisionValidationError('selectedCoa is required for CHANGE_COA decision');
      }
      break;

    case 'REJECT_RECOMMENDATION':
      if (!input.reasonCode && !input.comments?.trim()) {
        throw new ReviewDecisionValidationError('reasonCode or comments required for REJECT_RECOMMENDATION');
      }
      break;

    case 'REQUEST_INFORMATION':
      if (!input.comments?.trim()) {
        throw new ReviewDecisionValidationError('comments are required for REQUEST_INFORMATION');
      }
      break;

    case 'ESCALATE':
      if (!input.reasonCode && !input.comments?.trim()) {
        throw new ReviewDecisionValidationError('reasonCode or comments required for ESCALATE');
      }
      break;

    case 'APPROVE_RECOMMENDATION':
      // selectedCoa is optional; if provided, it should match AI recommendation
      // (warning only — not enforced at this layer)
      break;
  }
}

// ─── Phase 5 feedback payload ────────────────────────────────────────────────

function buildFeedbackPayload(
  decision: ReviewerDecisionInput,
  reviewCase: AIReviewCase,
): ReviewerDecisionRecord['feedbackPayload'] {
  const aiCoa = reviewCase.aiSnapshot.recommendedCoa?.coaCode;
  const reviewerCoa = decision.selectedCoa?.coaCode ?? aiCoa;
  const agreement = decision.decision === 'APPROVE_RECOMMENDATION' ||
    (decision.decision === 'CHANGE_COA' && decision.selectedCoa?.coaCode === aiCoa);

  return {
    phase5Compatible: true,
    reviewerDecision: decision.decision,
    aiRecommendedCoa: aiCoa,
    reviewerSelectedCoa: reviewerCoa,
    agreement,
  };
}

// ─── Decision processing ──────────────────────────────────────────────────────

/**
 * Process a reviewer decision and produce a ReviewerDecisionRecord.
 *
 * Does NOT:
 * - post journals
 * - mutate transaction status
 * - call external services
 * - write to DB
 *
 * Returns the decision record with Phase 5-compatible feedback payload.
 */
export function recordReviewerDecision(
  input: ReviewerDecisionInput,
  reviewCase: AIReviewCase,
): ReviewerDecisionRecord {
  validateDecisionInput(input);

  const previousStatus = reviewCase.status;
  const targetStatus = decisionToStatus(input.decision);

  // Validate state transition (throws InvalidStateTransitionError if illegal)
  const newStatus: ReviewStatus = transitionReviewCase(previousStatus, targetStatus);

  const decidedAt =
    input.decidedAt instanceof Date
      ? input.decidedAt.toISOString()
      : input.decidedAt;

  const feedbackPayload = buildFeedbackPayload(input, reviewCase);

  const record: ReviewerDecisionRecord = {
    id: generateDecisionId(input.idempotencyKey),
    reviewCaseId: input.reviewCaseId,
    companyId: input.companyId,
    reviewerId: input.reviewerId,
    decision: input.decision,
    previousStatus,
    newStatus,
    selectedCoa: input.selectedCoa,
    reasonCode: input.reasonCode,
    comments: input.comments,
    reviewerConfidence: input.reviewerConfidence,
    idempotencyKey: input.idempotencyKey,
    createdAt: decidedAt,
    feedbackPayload,
  };

  return record;
}
