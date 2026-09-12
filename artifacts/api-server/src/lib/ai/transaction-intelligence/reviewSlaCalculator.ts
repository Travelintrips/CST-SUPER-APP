/**
 * AI Transaction Intelligence — Phase 8
 * SLA Calculator
 *
 * Computes SLA windows based on queue priority and policy.
 * Pure functions — no side effects, no Date.now().
 */

import type { ReviewPriority, ReviewOrchestrationPolicy, ReviewSla } from './reviewOrchestrationTypes.js';

// ─── Default SLA windows ──────────────────────────────────────────────────────

export const DEFAULT_SLA_MINUTES: Record<ReviewPriority, number> = {
  LOW:      4320,  // 3 days
  NORMAL:   1440,  // 1 day
  HIGH:      480,  // 8 hours
  URGENT:    120,  // 2 hours
  CRITICAL:   60,  // 1 hour
};

export function getSlaTargetMinutes(
  priority: ReviewPriority,
  policy?: ReviewOrchestrationPolicy,
): number {
  switch (priority) {
    case 'CRITICAL': return policy?.criticalSlaMinutes   ?? DEFAULT_SLA_MINUTES.CRITICAL;
    case 'URGENT':   return policy?.urgentSlaMinutes     ?? DEFAULT_SLA_MINUTES.URGENT;
    case 'HIGH':     return policy?.highPrioritySlaMinutes ?? DEFAULT_SLA_MINUTES.HIGH;
    case 'NORMAL':   return policy?.standardSlaMinutes   ?? DEFAULT_SLA_MINUTES.NORMAL;
    case 'LOW':      return policy?.standardSlaMinutes   ?? DEFAULT_SLA_MINUTES.LOW;
  }
}

// ─── SLA calculation ──────────────────────────────────────────────────────────

/**
 * Calculate SLA for a review case.
 *
 * @param createdAt  ISO string of case creation time
 * @param priority   Review priority (determines target window)
 * @param now        Evaluation time (injected — never Date.now())
 * @param dueAt      Explicit due date override (optional)
 * @param policy     Optional policy override
 */
export function calculateReviewSla(
  createdAt: string,
  priority: ReviewPriority,
  now: Date,
  dueAt?: string | Date,
  policy?: ReviewOrchestrationPolicy,
): ReviewSla {
  const createdMs = new Date(createdAt).getTime();
  const nowMs = now.getTime();
  const ageMinutes = Math.max(0, Math.floor((nowMs - createdMs) / 60_000));

  const targetMinutes = getSlaTargetMinutes(priority, policy);
  const computedDueMs = createdMs + targetMinutes * 60_000;

  let dueAtStr: string | undefined;
  let dueMs: number;

  if (dueAt) {
    dueMs = new Date(dueAt).getTime();
    // Preserve string input as-is to avoid millisecond normalisation (.000Z)
    dueAtStr = typeof dueAt === 'string' ? dueAt : dueAt.toISOString();
  } else {
    dueMs = computedDueMs;
    dueAtStr = new Date(computedDueMs).toISOString();
  }

  const isOverdue = nowMs > dueMs;

  return {
    createdAt,
    dueAt: dueAtStr,
    ageMinutes,
    isOverdue,
    targetMinutes,
  };
}
