/**
 * AI Transaction Intelligence — Phase 8
 * Review Case Builder
 *
 * Builds an AIReviewCase from ReviewOrchestrationInput.
 * Pure function — no side effects, no DB calls.
 */

import type {
  AIReviewCase,
  ReviewOrchestrationInput,
  ReviewOrchestrationPolicy,
} from './reviewOrchestrationTypes.js';
import { buildTransactionSnapshot, buildAISnapshot, ORCHESTRATION_VERSION } from './reviewSnapshotBuilder.js';
import { routeReviewCase } from './reviewQueueRouter.js';
import { calculateReviewPriority } from './reviewPriorityEngine.js';
import { calculateReviewSla } from './reviewSlaCalculator.js';
import {
  buildReviewCaseIdempotencyKey,
  generateCaseId,
} from './reviewIdempotency.js';

// ─── Merge policy ─────────────────────────────────────────────────────────────

export const DEFAULT_REVIEW_POLICY: Required<ReviewOrchestrationPolicy> = {
  autoClearMinimumConfidence: 0.85,
  autoClearMaximumAnomalyScore: 0.15,
  highValueThreshold: 100_000_000,
  criticalValueThreshold: 500_000_000,
  standardSlaMinutes: 1440,
  highPrioritySlaMinutes: 480,
  urgentSlaMinutes: 120,
  criticalSlaMinutes: 60,
  queueOverridesByIntent: {},
  priorityOverridesByIntent: {},
  forceManualReviewForIntents: [],
  forceManualReviewForFlags: [],
  allowedReviewerRolesByQueue: {},
};

export function mergeReviewPolicy(policy?: ReviewOrchestrationPolicy): Required<ReviewOrchestrationPolicy> {
  if (!policy) return DEFAULT_REVIEW_POLICY;
  return {
    ...DEFAULT_REVIEW_POLICY,
    ...policy,
    queueOverridesByIntent: { ...DEFAULT_REVIEW_POLICY.queueOverridesByIntent, ...policy.queueOverridesByIntent },
    priorityOverridesByIntent: { ...DEFAULT_REVIEW_POLICY.priorityOverridesByIntent, ...policy.priorityOverridesByIntent },
    allowedReviewerRolesByQueue: { ...DEFAULT_REVIEW_POLICY.allowedReviewerRolesByQueue, ...policy.allowedReviewerRolesByQueue },
    forceManualReviewForIntents: policy.forceManualReviewForIntents ?? DEFAULT_REVIEW_POLICY.forceManualReviewForIntents,
    forceManualReviewForFlags: policy.forceManualReviewForFlags ?? DEFAULT_REVIEW_POLICY.forceManualReviewForFlags,
  };
}

// ─── Flag builder ─────────────────────────────────────────────────────────────

function buildFlags(input: ReviewOrchestrationInput): string[] {
  const flags: string[] = [];
  const { phase2, phase3, phase4, phase7 } = input;

  if (phase7.requiresManualReview)  flags.push('ANOMALY_REVIEW_REQUIRED');
  if (phase3.requiresManualReview)  flags.push('COA_MANUAL_REVIEW');
  if (phase2.requiresManualReview)  flags.push('INTENT_MANUAL_REVIEW');

  if (phase7.anomalyTypes?.includes('EXACT_DUPLICATE'))     flags.push('EXACT_DUPLICATE');
  if (phase7.anomalyTypes?.includes('NEAR_DUPLICATE'))      flags.push('NEAR_DUPLICATE');
  if (phase7.anomalyTypes?.includes('SPLIT_TRANSACTION'))   flags.push('SPLIT_TRANSACTION');
  if (phase7.anomalyTypes?.includes('CROSS_COMPANY_PATTERN')) flags.push('CROSS_COMPANY_PATTERN');
  if (phase7.anomalyTypes?.includes('FREQUENCY_SPIKE'))     flags.push('FREQUENCY_SPIKE');

  for (const a of phase4.ambiguity ?? []) {
    flags.push(a.type);
  }

  for (const cf of phase3.conflictFlags ?? []) {
    if (!flags.includes(cf)) flags.push(cf);
  }

  return [...new Set(flags)]; // deduplicate
}

// ─── Review case builder ──────────────────────────────────────────────────────

/**
 * Build an AIReviewCase from Phase 1–7 results.
 *
 * @param input  Full orchestration input
 * @param now    Current evaluation time (injected — never Date.now())
 */
export function buildReviewCase(
  input: ReviewOrchestrationInput,
  now: Date,
): AIReviewCase {
  const policy = mergeReviewPolicy(input.policy);
  const source = input.context?.source;

  // Build immutable snapshots
  const transactionSnapshot = buildTransactionSnapshot(input);
  const aiSnapshot = buildAISnapshot(input);

  // Idempotency key
  const idempotencyKey = buildReviewCaseIdempotencyKey(
    input.companyId,
    input.transaction.id,
    source,
    aiSnapshot.snapshotVersion,
  );

  // Deterministic case ID from idempotency key
  const id = generateCaseId(idempotencyKey);

  // Queue routing
  const queue = routeReviewCase(input);

  // SLA
  const createdAt = now.toISOString();
  const dueAt = input.context?.dueAt;
  // Initial SLA — priority not yet known, use NORMAL as seed
  const initialSla = calculateReviewSla(createdAt, 'NORMAL', now, dueAt, policy);

  // Priority (SLA state used in priority calc)
  const priority = calculateReviewPriority({
    orchestrationInput: input,
    queue,
    sla: initialSla,
  });

  // Final SLA with correct priority
  const sla = calculateReviewSla(createdAt, priority, now, dueAt, policy);

  // Flags
  const flags = buildFlags(input);

  const reviewCase: AIReviewCase = {
    id,
    idempotencyKey,
    companyId: input.companyId,
    transactionSnapshot,
    aiSnapshot,
    queue,
    priority,
    status: 'QUEUED',
    sla,
    flags,
    createdAt,
    updatedAt: createdAt,
    requiresHumanDecision: true,
    orchestrationVersion: ORCHESTRATION_VERSION as '1.0',
  };

  return reviewCase;
}
