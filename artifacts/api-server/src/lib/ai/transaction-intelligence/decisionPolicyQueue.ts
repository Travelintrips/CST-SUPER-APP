/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Queue Routing
 *
 * Determines the most appropriate ReviewQueue given all signals.
 * Pure function, no side effects.
 */

import type { ReviewQueue } from './reviewOrchestrationTypes.js';
import type { TransactionIntent } from './transactionTypes.js';
import { isTaxIntent } from './transactionTypes.js';
import type { DecisionPolicyInput } from './decisionPolicyTypes.js';
import type { PolicyAccumulator } from './decisionPolicyRules.js';

// ─── Queue priority ordering (higher index = higher specificity) ───────────────

const QUEUE_SPECIFICITY: Record<ReviewQueue, number> = {
  AUTO_CLEAR_CANDIDATE: 0,
  STANDARD_FINANCE_REVIEW: 1,
  ACCOUNTING_REVIEW: 2,
  DATA_QUALITY_REVIEW: 2,
  PAYROLL_REVIEW: 3,
  TAX_REVIEW: 3,
  INTERCOMPANY_REVIEW: 3,
  TREASURY_REVIEW: 3,
  ANOMALY_REVIEW: 4,
  HIGH_RISK_REVIEW: 5,
};

export function moreSpecificQueue(a: ReviewQueue, b: ReviewQueue): ReviewQueue {
  return QUEUE_SPECIFICITY[a] >= QUEUE_SPECIFICITY[b] ? a : b;
}

// ─── Intent → primary queue ───────────────────────────────────────────────────

export function intentToQueue(intent: TransactionIntent): ReviewQueue | null {
  const map: Partial<Record<TransactionIntent, ReviewQueue>> = {
    TAX_PAYMENT: 'TAX_REVIEW',
    VAT_PAYMENT: 'TAX_REVIEW',
    INCOME_TAX: 'TAX_REVIEW',
    IMPORT_DUTY: 'TAX_REVIEW',
    CUSTOMS_DUTY: 'TAX_REVIEW',
    STAMP_DUTY: 'TAX_REVIEW',
    TAX_PENALTY: 'TAX_REVIEW',
    TAX_REFUND: 'TAX_REVIEW',
    TAX_INTEREST: 'TAX_REVIEW',
    EXCISE_TAX: 'TAX_REVIEW',
    LOCAL_TAX: 'TAX_REVIEW',
    VEHICLE_TAX: 'TAX_REVIEW',
    PAYROLL: 'PAYROLL_REVIEW',
    INTERNAL_TRANSFER: 'TREASURY_REVIEW',
    BANK_CHARGE: 'ACCOUNTING_REVIEW',
    UNKNOWN: 'DATA_QUALITY_REVIEW',
  };
  if (isTaxIntent(intent)) return 'TAX_REVIEW';
  return map[intent] ?? null;
}

// ─── Route queue from full decision state ────────────────────────────────────

export function resolveQueue(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
  policyQueueOverrides?: Partial<Record<string, ReviewQueue>>,
): ReviewQueue {
  let queue = acc.queue;

  // Intent-derived queue
  const intentQueue = intentToQueue(input.phase2.primaryIntent as TransactionIntent);
  if (intentQueue) {
    queue = moreSpecificQueue(queue, intentQueue);
  }

  // Policy queue override by intent
  if (policyQueueOverrides) {
    const overrideQueue = policyQueueOverrides[input.phase2.primaryIntent];
    if (overrideQueue) {
      queue = overrideQueue;
    }
  }

  // High risk always goes to HIGH_RISK_REVIEW or ANOMALY_REVIEW
  if (input.phase7.riskLevel === 'CRITICAL') {
    queue = moreSpecificQueue(queue, 'HIGH_RISK_REVIEW');
  } else if (input.phase7.riskLevel === 'HIGH' && input.phase7.isAnomaly) {
    queue = moreSpecificQueue(queue, 'ANOMALY_REVIEW');
  }

  // If not review-required, clear to auto-candidate
  if (!acc.reviewRequired) {
    return 'AUTO_CLEAR_CANDIDATE';
  }

  // Fallback for review-required with no specific queue
  if (queue === 'AUTO_CLEAR_CANDIDATE') {
    return 'STANDARD_FINANCE_REVIEW';
  }

  return queue;
}
