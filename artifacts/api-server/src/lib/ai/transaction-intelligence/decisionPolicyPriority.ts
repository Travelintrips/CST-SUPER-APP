/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Priority Computation
 *
 * Derives final ReviewPriority from the accumulator state and input signals.
 * Pure function, no side effects.
 */

import type { ReviewPriority } from './reviewOrchestrationTypes.js';
import type { PolicyAccumulator } from './decisionPolicyRules.js';
import type { DecisionPolicyInput } from './decisionPolicyTypes.js';

// ─── Priority ordering (ascending severity) ───────────────────────────────────

const PRIORITY_ORDER: ReviewPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT', 'CRITICAL'];

export function priorityIndex(p: ReviewPriority): number {
  return PRIORITY_ORDER.indexOf(p);
}

export function maxPriority(...priorities: ReviewPriority[]): ReviewPriority {
  return priorities.reduce((best, p) =>
    priorityIndex(p) > priorityIndex(best) ? p : best,
  );
}

// ─── Compute priority from all signals ───────────────────────────────────────

export interface PriorityComputationResult {
  priority: ReviewPriority;
  reasons: string[];
}

export function computePolicyPriority(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
): PriorityComputationResult {
  const reasons: string[] = [];
  let priority: ReviewPriority = acc.priority;

  const { anomalyScore, riskLevel } = input.phase7;
  const intentConf = input.phase2.confidence;
  const amount = input.transaction.amount;
  const isAnomaly = input.phase7.isAnomaly;

  // Very low confidence → bump to at least HIGH
  if (intentConf < 0.30 && input.phase1.requiresManualReview) {
    priority = maxPriority(priority, 'HIGH');
    reasons.push(`Very low intent confidence (${(intentConf * 100).toFixed(1)}%).`);
  }

  // High anomaly score
  if (anomalyScore >= 0.80) {
    priority = maxPriority(priority, 'CRITICAL');
    reasons.push(`Extreme anomaly score (${anomalyScore.toFixed(2)}).`);
  } else if (anomalyScore >= 0.60) {
    priority = maxPriority(priority, 'URGENT');
    reasons.push(`High anomaly score (${anomalyScore.toFixed(2)}).`);
  } else if (anomalyScore >= 0.40) {
    priority = maxPriority(priority, 'HIGH');
    reasons.push(`Moderate anomaly score (${anomalyScore.toFixed(2)}).`);
  }

  // Risk level
  if (riskLevel === 'CRITICAL') {
    priority = maxPriority(priority, 'CRITICAL');
    reasons.push('Critical anomaly risk level.');
  } else if (riskLevel === 'HIGH') {
    priority = maxPriority(priority, 'URGENT');
    reasons.push('High anomaly risk level.');
  } else if (riskLevel === 'MEDIUM' && isAnomaly) {
    priority = maxPriority(priority, 'HIGH');
    reasons.push('Medium anomaly risk on detected anomaly.');
  }

  // Phase 8 existing case already escalated
  if (input.phase8?.status === 'ESCALATED') {
    priority = maxPriority(priority, 'URGENT');
    reasons.push('Existing review case is already escalated.');
  }

  return { priority, reasons };
}

// ─── Urgency label from priority ─────────────────────────────────────────────

export function priorityToUrgencyLabel(
  priority: ReviewPriority,
): 'ROUTINE' | 'PRIORITY' | 'URGENT' | 'CRITICAL' {
  switch (priority) {
    case 'LOW':
    case 'NORMAL':
      return 'ROUTINE';
    case 'HIGH':
      return 'PRIORITY';
    case 'URGENT':
      return 'URGENT';
    case 'CRITICAL':
      return 'CRITICAL';
    default:
      return 'ROUTINE';
  }
}
