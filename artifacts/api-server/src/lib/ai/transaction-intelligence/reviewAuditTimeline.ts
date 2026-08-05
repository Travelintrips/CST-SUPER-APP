/**
 * AI Transaction Intelligence — Phase 8
 * Audit Timeline Builder
 *
 * Builds append-only audit event streams for review cases.
 * Pure functions — no side effects, no DB calls.
 */

import type {
  AIReviewCase,
  ReviewAuditEvent,
  ReviewAuditEventType,
  ReviewStatus,
  ReviewerDecisionRecord,
  ReviewDecisionType,
} from './reviewOrchestrationTypes.js';
import { generateAuditEventId } from './reviewIdempotency.js';
import { sanitizeMetadata } from './reviewPrivacy.js';

// ─── Event builder ────────────────────────────────────────────────────────────

function buildEvent(
  reviewCaseId: string,
  companyId: string | number,
  eventType: ReviewAuditEventType,
  actorType: 'SYSTEM' | 'REVIEWER',
  occurredAt: string,
  sequence: number,
  options?: {
    actorId?: string | number;
    previousStatus?: ReviewStatus;
    newStatus?: ReviewStatus;
    reason?: string;
    metadata?: Record<string, unknown>;
  },
): ReviewAuditEvent {
  return {
    id: generateAuditEventId(reviewCaseId, eventType, occurredAt, sequence),
    reviewCaseId,
    companyId,
    eventType,
    actorType,
    actorId: options?.actorId,
    previousStatus: options?.previousStatus,
    newStatus: options?.newStatus,
    reason: options?.reason,
    metadata: sanitizeMetadata(options?.metadata),
    occurredAt,
  };
}

// ─── Standard audit events ────────────────────────────────────────────────────

export function buildCaseCreatedEvent(
  reviewCase: AIReviewCase,
  occurredAt: string,
): ReviewAuditEvent {
  return buildEvent(reviewCase.id, reviewCase.companyId, 'CASE_CREATED', 'SYSTEM', occurredAt, 0, {
    newStatus: reviewCase.status,
    metadata: {
      queue: reviewCase.queue,
      priority: reviewCase.priority,
      transactionId: reviewCase.transactionSnapshot.transactionId,
    },
  });
}

export function buildQueuedEvent(
  reviewCaseId: string,
  companyId: string | number,
  previousStatus: ReviewStatus,
  queue: string,
  occurredAt: string,
  sequence: number,
): ReviewAuditEvent {
  return buildEvent(reviewCaseId, companyId, 'QUEUED', 'SYSTEM', occurredAt, sequence, {
    previousStatus,
    newStatus: 'QUEUED',
    metadata: { queue },
  });
}

export function buildAssignedEvent(
  reviewCaseId: string,
  companyId: string | number,
  reviewerId: string | number,
  reviewerRole: string | undefined,
  previousStatus: ReviewStatus,
  occurredAt: string,
  sequence: number,
): ReviewAuditEvent {
  return buildEvent(reviewCaseId, companyId, 'ASSIGNED', 'SYSTEM', occurredAt, sequence, {
    actorId: reviewerId,
    previousStatus,
    newStatus: 'ASSIGNED',
    metadata: { reviewerRole },
  });
}

export function buildDecisionAuditEvent(
  decision: ReviewerDecisionRecord,
  occurredAt: string,
  sequence: number,
): ReviewAuditEvent {
  const eventTypeMap: Record<ReviewDecisionType, ReviewAuditEventType> = {
    APPROVE_RECOMMENDATION: 'RECOMMENDATION_APPROVED',
    CHANGE_COA:             'COA_CHANGED',
    REJECT_RECOMMENDATION:  'RECOMMENDATION_REJECTED',
    REQUEST_INFORMATION:    'INFORMATION_REQUESTED',
    ESCALATE:               'ESCALATED',
  };

  const eventType = eventTypeMap[decision.decision];

  return buildEvent(
    decision.reviewCaseId,
    decision.companyId,
    eventType,
    'REVIEWER',
    occurredAt,
    sequence,
    {
      actorId: decision.reviewerId,
      previousStatus: decision.previousStatus,
      newStatus: decision.newStatus,
      reason: decision.reasonCode ?? decision.comments,
      metadata: decision.selectedCoa
        ? { selectedCoaCode: decision.selectedCoa.coaCode }
        : undefined,
    },
  );
}

// ─── Full timeline builder ────────────────────────────────────────────────────

/**
 * Build the complete audit timeline for a review case.
 * Returns events in chronological order (append-only semantics).
 *
 * @param reviewCase  The current review case state
 * @param now         Evaluation time (injected)
 */
export function buildReviewAuditTimeline(
  reviewCase: AIReviewCase,
  now: Date,
): ReviewAuditEvent[] {
  const nowIso = now.toISOString();
  const events: ReviewAuditEvent[] = [];
  let seq = 0;

  // 1. Case creation
  events.push(buildCaseCreatedEvent(reviewCase, reviewCase.createdAt));
  seq++;

  // 2. Queue event (always follows creation)
  if (reviewCase.status !== 'OPEN') {
    events.push(buildQueuedEvent(reviewCase.id, reviewCase.companyId, 'OPEN', reviewCase.queue, reviewCase.createdAt, seq));
    seq++;
  }

  // 3. Assignment event
  if (reviewCase.reviewerAssignment?.reviewerId && reviewCase.reviewerAssignment.assignedAt) {
    events.push(buildAssignedEvent(
      reviewCase.id,
      reviewCase.companyId,
      reviewCase.reviewerAssignment.reviewerId,
      reviewCase.reviewerAssignment.reviewerRole,
      'QUEUED',
      reviewCase.reviewerAssignment.assignedAt,
      seq,
    ));
    seq++;
  }

  // 4. Decision event
  if (reviewCase.decision) {
    const decisionOccurredAt = reviewCase.decision.createdAt;
    events.push(buildDecisionAuditEvent(reviewCase.decision, decisionOccurredAt, seq));
    seq++;
  }

  // 5. Terminal close event if status is terminal and no decision recorded
  if (reviewCase.status === 'CLOSED' && !reviewCase.decision) {
    events.push(buildEvent(reviewCase.id, reviewCase.companyId, 'CLOSED', 'SYSTEM', nowIso, seq, {
      previousStatus: 'IN_REVIEW',
      newStatus: 'CLOSED',
    }));
  }

  return events;
}
