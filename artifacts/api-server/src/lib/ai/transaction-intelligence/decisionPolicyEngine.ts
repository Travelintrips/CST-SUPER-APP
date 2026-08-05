/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Main Orchestrator
 *
 * Single entry point that consumes Phase 1–8 outputs and emits a
 * DecisionPolicyResult. Read-only: no posting, no approval, no DB writes.
 *
 * Evaluation order:
 *   1. Merge policy config with defaults
 *   2. Fetch company overrides (via DI, if provided)
 *   3. Build accumulator with default values
 *   4. Apply base rules (intent → confidence → anomaly → amount → COA → counterparty → flags)
 *   5. Apply risk-priority boosts
 *   6. Apply overrides (company + config)
 *   7. Finalize queue, reviewer role, escalation, approval, hold
 *   8. Compute SLA
 *   9. Build and return result
 */

import type {
  DecisionPolicyInput,
  DecisionPolicyResult,
  DecisionPolicyConfig,
  DecisionPolicyDependencies,
  AppliedOverride,
} from './decisionPolicyTypes.js';

import {
  buildDefaultAccumulator,
  applyIntentRules,
  applyConfidenceRules,
  applyAnomalyRules,
  applyAmountRules,
  applyFlagRules,
  applyCoaRules,
  applyCounterpartyRules,
  applyRiskPriorityRules,
  applyQueueFallback,
  applyReviewerFallback,
  DEFAULT_AUTO_CONFIDENCE,
  DEFAULT_ANOMALY_REVIEW_THRESHOLD,
  DEFAULT_ANOMALY_ESCALATION_THRESHOLD,
  DEFAULT_HIGH_VALUE,
  DEFAULT_CRITICAL_VALUE,
  DEFAULT_ESCALATION_VALUE,
} from './decisionPolicyRules.js';

import { computePolicyPriority } from './decisionPolicyPriority.js';
import { resolveQueue } from './decisionPolicyQueue.js';
import { computeEscalation } from './decisionPolicyEscalation.js';
import { resolveReviewerRole, approvalLevelToReviewLevel } from './decisionPolicyReviewer.js';
import { buildPolicySla } from './decisionPolicySla.js';
import { applyOverrides, mergeOverrides } from './decisionPolicyOverrides.js';

// ─── Engine version ───────────────────────────────────────────────────────────

export const DECISION_POLICY_ENGINE_VERSION = '9.0' as const;
export const DEFAULT_POLICY_VERSION = '9.0.0';

// ─── Merge config with defaults ───────────────────────────────────────────────

export function mergeDecisionPolicyConfig(
  input?: DecisionPolicyConfig,
): Required<Omit<DecisionPolicyConfig, 'overrides' | 'forceManualReviewIntents' | 'forceManualReviewFlags' | 'policyVersion'>> & DecisionPolicyConfig {
  return {
    minimumAutoConfidence: input?.minimumAutoConfidence ?? DEFAULT_AUTO_CONFIDENCE,
    anomalyReviewThreshold: input?.anomalyReviewThreshold ?? DEFAULT_ANOMALY_REVIEW_THRESHOLD,
    anomalyEscalationThreshold: input?.anomalyEscalationThreshold ?? DEFAULT_ANOMALY_ESCALATION_THRESHOLD,
    amountThresholds: {
      highValue: input?.amountThresholds?.highValue ?? DEFAULT_HIGH_VALUE,
      criticalValue: input?.amountThresholds?.criticalValue ?? DEFAULT_CRITICAL_VALUE,
      escalationValue: input?.amountThresholds?.escalationValue ?? DEFAULT_ESCALATION_VALUE,
    },
    slaMinutes: {
      LOW: input?.slaMinutes?.LOW,
      NORMAL: input?.slaMinutes?.NORMAL,
      HIGH: input?.slaMinutes?.HIGH,
      URGENT: input?.slaMinutes?.URGENT,
      CRITICAL: input?.slaMinutes?.CRITICAL,
    },
    overrides: input?.overrides ?? [],
    forceManualReviewIntents: input?.forceManualReviewIntents ?? [],
    forceManualReviewFlags: input?.forceManualReviewFlags ?? [],
    policyVersion: input?.policyVersion ?? DEFAULT_POLICY_VERSION,
  };
}

// ─── Core evaluation ──────────────────────────────────────────────────────────

export async function evaluateDecisionPolicy(
  input: DecisionPolicyInput,
  deps?: DecisionPolicyDependencies,
): Promise<DecisionPolicyResult> {
  const now = deps?.now?.() ?? (input.evaluationTime ? new Date(input.evaluationTime as string) : new Date());
  const evaluatedAt = now.toISOString();

  // 1. Merge policy config
  const config = mergeDecisionPolicyConfig(input.policy);

  // 2. Fetch company overrides
  const companyOverrides = deps?.getCompanyOverrides
    ? await deps.getCompanyOverrides(input.companyId)
    : [];

  // Merge all overrides: config + company-level
  const allOverrides = mergeOverrides(config.overrides, companyOverrides);

  // Force-review sets
  const forceIntents = new Set<string>(config.forceManualReviewIntents);
  const forceFlags = new Set<string>(config.forceManualReviewFlags);

  // 3. Build accumulator
  const acc = buildDefaultAccumulator();

  // 4. Apply base rules
  applyIntentRules(input, acc, forceIntents);
  applyConfidenceRules(input, acc, config.minimumAutoConfidence!);
  applyAnomalyRules(
    input,
    acc,
    config.anomalyReviewThreshold!,
    config.anomalyEscalationThreshold!,
  );
  applyAmountRules(
    input,
    acc,
    config.amountThresholds!.highValue!,
    config.amountThresholds!.criticalValue!,
    config.amountThresholds!.escalationValue!,
  );
  applyCoaRules(input, acc);
  applyCounterpartyRules(input, acc);
  applyFlagRules(input, acc, forceFlags);

  // 5. Risk-priority boosts
  applyRiskPriorityRules(input, acc);

  // 6. Apply overrides
  const appliedOverrides: AppliedOverride[] = applyOverrides(input, acc, allOverrides, now);

  // 7. Finalize priority
  const { priority: finalPriority, reasons: priorityReasons } = computePolicyPriority(input, acc);
  acc.priority = finalPriority;
  for (const r of priorityReasons) {
    if (!acc.policyReason.includes(r)) acc.policyReason.push(r);
  }

  // 8. Finalize queue
  acc.queue = resolveQueue(input, acc);
  applyQueueFallback(acc);

  // 9. Finalize escalation
  const escalation = computeEscalation(input, acc, config.anomalyEscalationThreshold!);

  // 10. Finalize reviewer role
  acc.reviewLevel = approvalLevelToReviewLevel(acc.approvalLevel, acc.reviewLevel);
  acc.reviewerRole = resolveReviewerRole({
    queue: acc.queue,
    intent: input.phase2.primaryIntent as never,
    escalationLevel: escalation.level,
    reviewLevel: acc.reviewLevel,
    currentRole: acc.reviewerRole,
  });
  applyReviewerFallback(acc);

  // 11. Compute SLA
  const overrideSlaMinutes = (acc as unknown as Record<string, unknown>)['_overrideSlaMinutes'] as number | undefined;
  const slaConfigMinutes = overrideSlaMinutes
    ? { [acc.priority]: overrideSlaMinutes, ...config.slaMinutes }
    : config.slaMinutes;
  const sla = buildPolicySla(acc.priority, now, slaConfigMinutes);

  // 12. Build result — does NOT write, post, approve, reconcile, or mutate anything
  const result: DecisionPolicyResult = {
    reviewRequired: acc.reviewRequired,
    queue: acc.queue,
    priority: acc.priority,
    sla,
    reviewerRole: acc.reviewerRole,
    reviewLevel: acc.reviewLevel,

    escalation,

    approvalRequirement: {
      required: acc.approvalRequired,
      level: acc.approvalLevel,
      minApprovers: acc.minApprovers,
      reason: acc.approvalReason,
    },

    holdRecommendation: {
      hold: acc.hold,
      reason: acc.holdReason,
    },

    policyVersion: config.policyVersion ?? DEFAULT_POLICY_VERSION,
    policyReason: acc.policyReason,
    firedRules: acc.firedRules,
    appliedOverrides,
    evaluatedAt,
    engineVersion: DECISION_POLICY_ENGINE_VERSION,
  };

  return result;
}

// ─── Batch variant ────────────────────────────────────────────────────────────

export async function evaluateDecisionPolicyBatch(
  inputs: DecisionPolicyInput[],
  deps?: DecisionPolicyDependencies,
): Promise<DecisionPolicyResult[]> {
  return Promise.all(inputs.map((input) => evaluateDecisionPolicy(input, deps)));
}
