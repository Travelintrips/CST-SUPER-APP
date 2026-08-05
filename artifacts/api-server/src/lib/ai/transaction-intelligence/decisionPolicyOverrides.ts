/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Override Application
 *
 * Applies company / intent / risk / amount / reviewer overrides to the
 * already-computed accumulator. Pure function, no side effects.
 *
 * Override dimensions:
 *   COMPANY  — matched by companyId
 *   INTENT   — matched by primaryIntent
 *   RISK     — matched by riskLevel
 *   AMOUNT   — matched by amount bracket label ("HIGH"/"CRITICAL"/"ESCALATION")
 *   REVIEWER — matched by reviewerRole
 */

import type {
  DecisionPolicyInput,
  DecisionPolicyOverride,
  AppliedOverride,
  ReviewQueue,
  ReviewPriority,
  ReviewLevel,
  EscalationLevel,
  ApprovalLevel,
  ReviewerRole,
} from './decisionPolicyTypes.js';
import type { PolicyAccumulator } from './decisionPolicyRules.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function amountBracket(amount: number): string {
  if (amount >= 1_000_000_000) return 'ESCALATION';
  if (amount >= 500_000_000) return 'CRITICAL';
  if (amount >= 50_000_000) return 'HIGH';
  return 'NORMAL';
}

function matchKey(override: DecisionPolicyOverride, input: DecisionPolicyInput): boolean {
  switch (override.dimension) {
    case 'COMPANY':
      return String(input.companyId) === override.matchKey;
    case 'INTENT':
      return input.phase2.primaryIntent === override.matchKey;
    case 'RISK':
      return input.phase7.riskLevel === override.matchKey;
    case 'AMOUNT':
      return amountBracket(input.transaction.amount) === override.matchKey;
    case 'REVIEWER':
      return true; // Reviewer overrides always apply if specified
    default:
      return false;
  }
}

function isExpired(override: DecisionPolicyOverride, now: Date): boolean {
  if (!override.expiresAt) return false;
  return new Date(override.expiresAt) < now;
}

// ─── Apply overrides ──────────────────────────────────────────────────────────

export function applyOverrides(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
  overrides: DecisionPolicyOverride[],
  now: Date,
): AppliedOverride[] {
  const applied: AppliedOverride[] = [];

  for (const override of overrides) {
    if (isExpired(override, now)) continue;
    if (!matchKey(override, input)) continue;

    const fieldsChanged: string[] = [];
    const { force } = override;

    if (force.skipReview !== undefined) {
      acc.reviewRequired = !force.skipReview;
      fieldsChanged.push('reviewRequired');
    }

    if (force.queue !== undefined) {
      acc.queue = force.queue as ReviewQueue;
      fieldsChanged.push('queue');
      // Forcing a non-AUTO_CLEAR queue implies review is required
      if (force.queue !== 'AUTO_CLEAR_CANDIDATE' && force.skipReview === undefined) {
        acc.reviewRequired = true;
      }
    }

    if (force.priority !== undefined) {
      acc.priority = force.priority as ReviewPriority;
      fieldsChanged.push('priority');
    }

    if (force.reviewLevel !== undefined) {
      acc.reviewLevel = force.reviewLevel as ReviewLevel;
      fieldsChanged.push('reviewLevel');
    }

    if (force.reviewerRole !== undefined) {
      acc.reviewerRole = force.reviewerRole as ReviewerRole;
      fieldsChanged.push('reviewerRole');
    }

    if (force.escalationLevel !== undefined) {
      acc.escalationLevel = force.escalationLevel as EscalationLevel;
      acc.escalationRequired = force.escalationLevel !== 'NONE';
      fieldsChanged.push('escalationLevel', 'escalationRequired');
    }

    if (force.approvalLevel !== undefined) {
      acc.approvalLevel = force.approvalLevel as ApprovalLevel;
      acc.approvalRequired = force.approvalLevel !== 'NONE';
      fieldsChanged.push('approvalLevel', 'approvalRequired');
    }

    if (force.holdRecommendation !== undefined) {
      acc.hold = force.holdRecommendation;
      if (force.holdRecommendation) {
        acc.holdReason.push(`Override (${override.dimension}): ${override.reason}`);
      }
      fieldsChanged.push('hold');
    }

    if (force.slaMinutes !== undefined) {
      // Stored on accumulator as ephemeral field (engine reads it)
      (acc as unknown as Record<string, unknown>)['_overrideSlaMinutes'] = force.slaMinutes;
      fieldsChanged.push('slaMinutes');
    }

    if (fieldsChanged.length > 0) {
      acc.policyReason.push(`Override applied (${override.dimension}/${override.matchKey}): ${override.reason}`);
      applied.push({
        dimension: override.dimension,
        matchKey: override.matchKey,
        fieldsChanged,
        reason: override.reason,
      });
    }
  }

  return applied;
}

// ─── Merge policy overrides from multiple sources ─────────────────────────────

export function mergeOverrides(
  configOverrides: DecisionPolicyOverride[] | undefined,
  companyOverrides: DecisionPolicyOverride[],
): DecisionPolicyOverride[] {
  return [...(configOverrides ?? []), ...companyOverrides];
}
