/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Escalation Logic
 *
 * Computes escalation requirement and level from all upstream signals.
 * Pure function, no side effects.
 */

import type {
  DecisionPolicyInput,
  EscalationLevel,
  PolicyEscalationDecision,
} from './decisionPolicyTypes.js';
import type { PolicyAccumulator } from './decisionPolicyRules.js';

// ─── Escalation level ordering (ascending severity) ──────────────────────────

const ESCALATION_ORDER: EscalationLevel[] = [
  'NONE',
  'TEAM_LEAD',
  'MANAGER',
  'DIRECTOR',
  'EXECUTIVE',
  'COMPLIANCE',
];

export function escalationIndex(level: EscalationLevel): number {
  return ESCALATION_ORDER.indexOf(level);
}

export function maxEscalationLevel(a: EscalationLevel, b: EscalationLevel): EscalationLevel {
  return escalationIndex(a) >= escalationIndex(b) ? a : b;
}

// ─── Compute escalation ───────────────────────────────────────────────────────

export function computeEscalation(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
  escalationThreshold: number,
): PolicyEscalationDecision {
  let required = acc.escalationRequired;
  let level: EscalationLevel = acc.escalationLevel;
  const reason: string[] = [...acc.escalationReason];

  // Critical anomaly risk
  if (input.phase7.riskLevel === 'CRITICAL') {
    required = true;
    level = maxEscalationLevel(level, 'DIRECTOR');
    reason.push('Critical anomaly risk level requires director escalation.');
  }

  // Very high anomaly score
  if (input.phase7.anomalyScore >= escalationThreshold) {
    required = true;
    level = maxEscalationLevel(level, 'MANAGER');
    reason.push(`Anomaly score ${input.phase7.anomalyScore.toFixed(2)} requires manager escalation.`);
  }

  // Exact duplicate
  if (input.phase7.anomalyTypes.includes('EXACT_DUPLICATE')) {
    required = true;
    level = maxEscalationLevel(level, 'MANAGER');
    reason.push('Exact duplicate transaction requires manager review.');
  }

  // Existing phase8 case already escalated
  if (input.phase8?.status === 'ESCALATED') {
    required = true;
    level = maxEscalationLevel(level, 'DIRECTOR');
    reason.push('Existing review case is already escalated — promoting escalation level.');
  }

  // Cross-company anomaly
  if (input.phase7.anomalyTypes.includes('CROSS_COMPANY_PATTERN')) {
    required = true;
    level = maxEscalationLevel(level, 'COMPLIANCE');
    reason.push('Cross-company pattern requires compliance escalation.');
  }

  // Rapid reversal
  if (input.phase7.anomalyTypes.includes('RAPID_REVERSAL')) {
    required = true;
    level = maxEscalationLevel(level, 'MANAGER');
    reason.push('Rapid reversal detected — requires manager sign-off.');
  }

  if (!required) {
    return { required: false, level: 'NONE', reason: [] };
  }

  return { required, level, reason };
}
