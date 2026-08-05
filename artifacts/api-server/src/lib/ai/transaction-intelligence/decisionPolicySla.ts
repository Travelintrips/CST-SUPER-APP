/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — SLA Computation
 *
 * Computes SLA target in minutes and absolute due-at timestamp.
 * Pure function, no side effects.
 */

import type { ReviewPriority } from './reviewOrchestrationTypes.js';
import type { PolicySlaDecision } from './decisionPolicyTypes.js';
import { priorityToUrgencyLabel } from './decisionPolicyPriority.js';

// ─── Default SLA minutes per priority ────────────────────────────────────────

export const DEFAULT_POLICY_SLA_MINUTES: Record<ReviewPriority, number> = {
  LOW: 2880,       // 48 hours
  NORMAL: 1440,    // 24 hours
  HIGH: 480,       // 8 hours
  URGENT: 120,     // 2 hours
  CRITICAL: 30,    // 30 minutes
};

// ─── Resolve SLA target minutes ───────────────────────────────────────────────

export function resolveSlaMinutes(
  priority: ReviewPriority,
  configuredMinutes?: Partial<Record<ReviewPriority, number>>,
): number {
  const configured = configuredMinutes?.[priority];
  return configured ?? DEFAULT_POLICY_SLA_MINUTES[priority];
}

// ─── Build SLA decision ───────────────────────────────────────────────────────

export function buildPolicySla(
  priority: ReviewPriority,
  now: Date,
  configuredMinutes?: Partial<Record<ReviewPriority, number>>,
): PolicySlaDecision {
  const targetMinutes = resolveSlaMinutes(priority, configuredMinutes);
  const dueAt = new Date(now.getTime() + targetMinutes * 60 * 1000);

  return {
    targetMinutes,
    dueAt: dueAt.toISOString(),
    urgencyLabel: priorityToUrgencyLabel(priority),
  };
}
