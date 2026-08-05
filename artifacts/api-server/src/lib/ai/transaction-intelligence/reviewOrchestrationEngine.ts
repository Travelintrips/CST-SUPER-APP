/**
 * AI Transaction Intelligence — Phase 8
 * Review Orchestration Engine — Main Orchestrator
 *
 * Coordinates all Phase 8 components:
 *   1. Build review case
 *   2. Idempotency check
 *   3. Queue routing
 *   4. Priority calculation
 *   5. SLA calculation
 *   6. Snapshot construction
 *   7. Audit event generation
 *   8. Reviewer decision processing
 *   9. Observability metrics
 *
 * INVARIANTS:
 *   - NEVER auto-approves, auto-rejects, or auto-reconciles
 *   - NEVER posts journals
 *   - NEVER mutates transactions
 *   - NEVER applies adaptive rules automatically
 *   - requiresHumanDecision is always true
 *   - Deterministic — time injected via deps.now()
 *   - Company isolated
 *   - No direct DB calls
 */

import type {
  ReviewOrchestrationInput,
  ReviewOrchestrationDependencies,
  AIReviewCase,
  ReviewerDecisionInput,
  ReviewerDecisionRecord,
  ReviewAuditEvent,
  ReviewObservabilityReport,
  ReviewSla,
} from './reviewOrchestrationTypes.js';
import { buildReviewCase } from './reviewCaseBuilder.js';
import { recordReviewerDecision } from './reviewDecisionService.js';
import { buildReviewAuditTimeline } from './reviewAuditTimeline.js';
import { calculateReviewObservability } from './reviewObservability.js';
import { calculateReviewSla } from './reviewSlaCalculator.js';
import { buildReviewSnapshot } from './reviewSnapshotBuilder.js';
import { routeReviewCase } from './reviewQueueRouter.js';
import { calculateReviewPriority } from './reviewPriorityEngine.js';
import { transitionReviewCase } from './reviewStateMachine.js';

// ─── Main orchestration APIs ──────────────────────────────────────────────────

/**
 * Create a single AI review case.
 *
 * Checks idempotency — if an existing case matches, returns it unchanged.
 */
export async function createAIReviewCase(
  input: ReviewOrchestrationInput,
  deps: ReviewOrchestrationDependencies = {},
): Promise<AIReviewCase> {
  const now = deps.now ? deps.now() : new Date(0);

  // Resolve policy via DI
  let policy = input.policy;
  if (!policy && deps.getReviewPolicy) {
    policy = (await deps.getReviewPolicy(input.companyId)) ?? undefined;
  }
  const enrichedInput: ReviewOrchestrationInput = policy ? { ...input, policy } : input;

  const reviewCase = buildReviewCase(enrichedInput, now);

  // Idempotency check
  if (deps.getExistingReviewCase) {
    const existing = await deps.getExistingReviewCase(reviewCase.idempotencyKey);
    if (existing) return existing;
  }

  return reviewCase;
}

/**
 * Create review cases for a batch of inputs.
 * Preserves input order. Each case is created independently.
 */
export async function createAIReviewCaseBatch(
  inputs: ReviewOrchestrationInput[],
  deps: ReviewOrchestrationDependencies = {},
): Promise<AIReviewCase[]> {
  const results: AIReviewCase[] = [];
  for (const input of inputs) {
    results.push(await createAIReviewCase(input, deps));
  }
  return results;
}

/**
 * Route an existing or new review case to its queue.
 * Returns the queue string for the given input.
 */
export function routeReviewCasePublic(input: ReviewOrchestrationInput): string {
  return routeReviewCase(input);
}

/**
 * Calculate review priority for a given input and queue.
 */
export function calculateReviewPriorityPublic(
  input: ReviewOrchestrationInput,
  deps: ReviewOrchestrationDependencies = {},
): string {
  const now = deps.now ? deps.now() : new Date(0);
  const queue = routeReviewCase(input);
  const sla = calculateReviewSla(now.toISOString(), 'NORMAL', now, undefined, input.policy);
  return calculateReviewPriority({ orchestrationInput: input, queue, sla });
}

/**
 * Transition a review case to a new status.
 * Validates the transition and returns an updated case.
 * Does NOT persist to DB.
 */
export function transitionReviewCasePublic(
  reviewCase: AIReviewCase,
  targetStatus: AIReviewCase['status'],
  now: Date,
): AIReviewCase {
  const newStatus = transitionReviewCase(reviewCase.status, targetStatus);
  return {
    ...reviewCase,
    status: newStatus,
    updatedAt: now.toISOString(),
  };
}

/**
 * Process a reviewer decision.
 *
 * Does NOT post journals. Does NOT mutate transaction status.
 * Returns the decision record with Phase 5-compatible feedback payload.
 *
 * Idempotent: if an existing decision with the same key exists, returns it.
 */
export async function recordReviewerDecisionPublic(
  input: ReviewerDecisionInput,
  reviewCase: AIReviewCase,
  deps: ReviewOrchestrationDependencies = {},
): Promise<ReviewerDecisionRecord> {
  // Idempotency check
  if (deps.getExistingDecision) {
    const existing = await deps.getExistingDecision(input.idempotencyKey);
    if (existing) return existing;
  }
  return recordReviewerDecision(input, reviewCase);
}

/**
 * Build an immutable snapshot of Phase 1–7 AI decisions.
 */
export function buildReviewSnapshotPublic(input: ReviewOrchestrationInput) {
  return buildReviewSnapshot(input);
}

/**
 * Build the audit timeline for a review case.
 */
export function buildReviewAuditTimelinePublic(
  reviewCase: AIReviewCase,
  deps: ReviewOrchestrationDependencies = {},
): ReviewAuditEvent[] {
  const now = deps.now ? deps.now() : new Date(0);
  return buildReviewAuditTimeline(reviewCase, now);
}

/**
 * Calculate observability metrics from an array of review cases.
 */
export function calculateReviewObservabilityPublic(
  cases: AIReviewCase[],
): ReviewObservabilityReport {
  return calculateReviewObservability(cases);
}

/**
 * Calculate SLA for a review case.
 */
export function calculateReviewSlaPublic(
  createdAt: string,
  priority: AIReviewCase['priority'],
  now: Date,
  dueAt?: string | Date,
  policy?: ReviewOrchestrationInput['policy'],
): ReviewSla {
  return calculateReviewSla(createdAt, priority, now, dueAt, policy);
}
