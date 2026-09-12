/**
 * AI Transaction Intelligence — Phase 8
 * Review State Machine
 *
 * Defines valid state transitions for AIReviewCase.
 * Pure functions — no side effects, deterministic.
 */

import type { ReviewStatus, ReviewDecisionType } from './reviewOrchestrationTypes.js';

// ─── Valid transitions ────────────────────────────────────────────────────────

export const VALID_TRANSITIONS: Readonly<Record<ReviewStatus, ReadonlyArray<ReviewStatus>>> = {
  OPEN:                    ['QUEUED'],
  QUEUED:                  ['ASSIGNED', 'IN_REVIEW', 'ESCALATED', 'CANCELLED'],
  ASSIGNED:                ['IN_REVIEW', 'CANCELLED'],
  IN_REVIEW:               ['NEEDS_INFORMATION', 'APPROVED_RECOMMENDATION', 'CHANGED_COA', 'REJECTED_RECOMMENDATION', 'ESCALATED'],
  NEEDS_INFORMATION:       ['IN_REVIEW', 'CANCELLED'],
  ESCALATED:               ['IN_REVIEW', 'ASSIGNED', 'CANCELLED'],
  // Terminal states — no further transitions
  APPROVED_RECOMMENDATION: [],
  CHANGED_COA:             [],
  REJECTED_RECOMMENDATION: [],
  CANCELLED:               [],
  CLOSED:                  [],
};

export const TERMINAL_STATUSES = new Set<ReviewStatus>([
  'APPROVED_RECOMMENDATION',
  'CHANGED_COA',
  'REJECTED_RECOMMENDATION',
  'CANCELLED',
  'CLOSED',
]);

// ─── Transition validation ────────────────────────────────────────────────────

export function isValidTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  return (VALID_TRANSITIONS[from] as ReadonlyArray<ReviewStatus>).includes(to);
}

export function isTerminalStatus(status: ReviewStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export class InvalidStateTransitionError extends Error {
  constructor(from: ReviewStatus, to: ReviewStatus) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * Validate and return the next status, or throw if illegal.
 */
export function transitionReviewCase(
  currentStatus: ReviewStatus,
  targetStatus: ReviewStatus,
): ReviewStatus {
  if (isTerminalStatus(currentStatus)) {
    throw new InvalidStateTransitionError(currentStatus, targetStatus);
  }
  if (!isValidTransition(currentStatus, targetStatus)) {
    throw new InvalidStateTransitionError(currentStatus, targetStatus);
  }
  return targetStatus;
}

// ─── Decision → status mapping ────────────────────────────────────────────────

/**
 * Maps a reviewer decision type to the resulting ReviewStatus.
 */
export function decisionToStatus(decision: ReviewDecisionType): ReviewStatus {
  switch (decision) {
    case 'APPROVE_RECOMMENDATION': return 'APPROVED_RECOMMENDATION';
    case 'CHANGE_COA':             return 'CHANGED_COA';
    case 'REJECT_RECOMMENDATION':  return 'REJECTED_RECOMMENDATION';
    case 'REQUEST_INFORMATION':    return 'NEEDS_INFORMATION';
    case 'ESCALATE':               return 'ESCALATED';
  }
}
