/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Rule Definitions
 *
 * Contains all base policy rules evaluated against Phase 1–8 outputs.
 * Pure functions, no side effects, no DB access.
 *
 * Rule evaluation order:
 *   1. Intent rules
 *   2. Confidence rules
 *   3. Anomaly rules
 *   4. Amount rules
 *   5. Counterparty / COA rules
 *   6. Conflict flag rules
 *   7. Cross-dimension composite rules
 */

import type {
  DecisionPolicyInput,
  DecisionPolicyResult,
  FiredRule,
  ReviewQueue,
  ReviewPriority,
  ReviewLevel,
  EscalationLevel,
  ApprovalLevel,
  ReviewerRole,
} from './decisionPolicyTypes.js';
import { isTaxIntent } from './transactionTypes.js';
import type { TransactionIntent } from './transactionTypes.js';

// ─── Mutable accumulator passed through rule evaluation ───────────────────────

export interface PolicyAccumulator {
  reviewRequired: boolean;
  queue: ReviewQueue;
  priority: ReviewPriority;
  reviewLevel: ReviewLevel;
  reviewerRole: ReviewerRole;
  escalationRequired: boolean;
  escalationLevel: EscalationLevel;
  escalationReason: string[];
  approvalRequired: boolean;
  approvalLevel: ApprovalLevel;
  minApprovers: number;
  approvalReason: string[];
  hold: boolean;
  holdReason: string[];
  policyReason: string[];
  firedRules: FiredRule[];
}

// ─── Default accumulator ──────────────────────────────────────────────────────

export function buildDefaultAccumulator(): PolicyAccumulator {
  return {
    reviewRequired: false,
    queue: 'AUTO_CLEAR_CANDIDATE',
    priority: 'NORMAL',
    reviewLevel: 'NONE',
    reviewerRole: 'UNASSIGNED',
    escalationRequired: false,
    escalationLevel: 'NONE',
    escalationReason: [],
    approvalRequired: false,
    approvalLevel: 'NONE',
    minApprovers: 0,
    approvalReason: [],
    hold: false,
    holdReason: [],
    policyReason: [],
    firedRules: [],
  };
}

// ─── Helper: fire a rule ──────────────────────────────────────────────────────

function fire(
  acc: PolicyAccumulator,
  ruleId: string,
  description: string,
  dimension: string,
  effect: string,
): void {
  acc.firedRules.push({ ruleId, description, dimension, effect });
}

// ─── Thresholds (overridable via policy) ──────────────────────────────────────

export const DEFAULT_AUTO_CONFIDENCE = 0.70;
export const DEFAULT_ANOMALY_REVIEW_THRESHOLD = 0.40;
export const DEFAULT_ANOMALY_ESCALATION_THRESHOLD = 0.70;
export const DEFAULT_HIGH_VALUE = 50_000_000;
export const DEFAULT_CRITICAL_VALUE = 500_000_000;
export const DEFAULT_ESCALATION_VALUE = 1_000_000_000;

// ─── Intent → queue mapping ───────────────────────────────────────────────────

export const INTENT_QUEUE_MAP: Partial<Record<TransactionIntent, ReviewQueue>> = {
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
  INTERNAL_TRANSFER: 'INTERCOMPANY_REVIEW',
};

export const INTENT_REVIEWER_MAP: Partial<Record<TransactionIntent, ReviewerRole>> = {
  TAX_PAYMENT: 'TAX_SPECIALIST',
  VAT_PAYMENT: 'TAX_SPECIALIST',
  INCOME_TAX: 'TAX_SPECIALIST',
  IMPORT_DUTY: 'TAX_SPECIALIST',
  CUSTOMS_DUTY: 'TAX_SPECIALIST',
  STAMP_DUTY: 'TAX_SPECIALIST',
  TAX_PENALTY: 'TAX_SPECIALIST',
  TAX_REFUND: 'TAX_SPECIALIST',
  TAX_INTEREST: 'TAX_SPECIALIST',
  EXCISE_TAX: 'TAX_SPECIALIST',
  LOCAL_TAX: 'TAX_SPECIALIST',
  VEHICLE_TAX: 'TAX_SPECIALIST',
  PAYROLL: 'PAYROLL_OFFICER',
  INTERNAL_TRANSFER: 'TREASURY_ANALYST',
};

// High-risk intents that always require manual review
export const HIGH_RISK_INTENTS = new Set<TransactionIntent>([
  'TAX_PAYMENT',
  'VAT_PAYMENT',
  'INCOME_TAX',
  'IMPORT_DUTY',
  'CUSTOMS_DUTY',
  'STAMP_DUTY',
  'TAX_PENALTY',
  'TAX_REFUND',
  'TAX_INTEREST',
  'EXCISE_TAX',
  'LOCAL_TAX',
  'VEHICLE_TAX',
  'PAYROLL',
  'INTERNAL_TRANSFER',
]);

// ─── Rule: Intent-based review ────────────────────────────────────────────────

export function applyIntentRules(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
  forceIntents: Set<string>,
): void {
  const intent = input.phase2.primaryIntent as TransactionIntent;

  if (isTaxIntent(intent)) {
    acc.reviewRequired = true;
    acc.queue = 'TAX_REVIEW';
    acc.reviewLevel = 'SENIOR';
    acc.reviewerRole = 'TAX_SPECIALIST';
    acc.hold = true;
    acc.holdReason.push('Tax classification is advisory until a human approves the tax subtype and COA.');
    acc.policyReason.push(
      `Tax intent "${intent}" requires human approval before journal posting.`,
    );
    fire(
      acc,
      'TAX_HUMAN_APPROVAL_REQUIRED',
      `Tax intent requires human approval: ${intent}`,
      'TAX',
      'reviewRequired=true queue=TAX_REVIEW hold=true',
    );
  }

  // High-risk intents
  if (HIGH_RISK_INTENTS.has(intent) || forceIntents.has(intent)) {
    acc.reviewRequired = true;
    acc.queue = INTENT_QUEUE_MAP[intent] ?? 'STANDARD_FINANCE_REVIEW';
    acc.reviewLevel = 'SENIOR';
    acc.reviewerRole = INTENT_REVIEWER_MAP[intent] ?? 'SENIOR_ACCOUNTANT';
    acc.policyReason.push(`Intent "${intent}" requires mandatory review.`);
    fire(acc, 'INTENT_HIGH_RISK', `High-risk intent: ${intent}`, 'INTENT',
      `reviewRequired=true queue=${acc.queue} reviewer=${acc.reviewerRole}`);
  }

  // Unknown intent always to data quality queue
  if (intent === 'UNKNOWN') {
    acc.reviewRequired = true;
    acc.queue = 'DATA_QUALITY_REVIEW';
    acc.reviewerRole = 'DATA_QUALITY_ANALYST';
    acc.policyReason.push('Unknown intent requires data quality review.');
    fire(acc, 'INTENT_UNKNOWN', 'Unknown intent', 'INTENT',
      'reviewRequired=true queue=DATA_QUALITY_REVIEW');
  }
}

// ─── Rule: Confidence-based review ───────────────────────────────────────────

export function applyConfidenceRules(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
  minConfidence: number,
): void {
  const intentConf = input.phase2.confidence;
  const coaConf = input.phase3.primaryRecommendation?.confidence ?? 0;

  if (intentConf < minConfidence) {
    acc.reviewRequired = true;
    if (acc.queue === 'AUTO_CLEAR_CANDIDATE') acc.queue = 'STANDARD_FINANCE_REVIEW';
    acc.policyReason.push(
      `Low intent confidence (${(intentConf * 100).toFixed(1)}% < ${(minConfidence * 100).toFixed(1)}%).`,
    );
    fire(acc, 'CONFIDENCE_LOW_INTENT',
      `Intent confidence ${intentConf.toFixed(2)} below threshold ${minConfidence.toFixed(2)}`,
      'CONFIDENCE', `reviewRequired=true queue=${acc.queue}`);
  }

  if (coaConf < minConfidence && input.phase3.primaryRecommendation !== null) {
    acc.reviewRequired = true;
    if (acc.queue === 'AUTO_CLEAR_CANDIDATE') acc.queue = 'ACCOUNTING_REVIEW';
    acc.policyReason.push(
      `Low COA confidence (${(coaConf * 100).toFixed(1)}% < ${(minConfidence * 100).toFixed(1)}%).`,
    );
    fire(acc, 'CONFIDENCE_LOW_COA',
      `COA confidence ${coaConf.toFixed(2)} below threshold ${minConfidence.toFixed(2)}`,
      'CONFIDENCE', `reviewRequired=true queue=${acc.queue}`);
  }

  if (input.phase2.requiresManualReview) {
    acc.reviewRequired = true;
    if (acc.queue === 'AUTO_CLEAR_CANDIDATE') acc.queue = 'STANDARD_FINANCE_REVIEW';
    acc.policyReason.push('Phase 2 classifier flagged for manual review.');
    fire(acc, 'CONFIDENCE_P2_FLAG', 'Phase 2 manual review flag', 'CONFIDENCE',
      'reviewRequired=true');
  }
}

// ─── Rule: Anomaly-based decisions ───────────────────────────────────────────

export function applyAnomalyRules(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
  reviewThreshold: number,
  escalationThreshold: number,
): void {
  const { anomalyScore, riskLevel, isAnomaly, anomalyTypes, requiresManualReview } =
    input.phase7;

  if (isAnomaly || requiresManualReview || anomalyScore >= reviewThreshold) {
    acc.reviewRequired = true;
    if (acc.queue === 'AUTO_CLEAR_CANDIDATE') acc.queue = 'ANOMALY_REVIEW';
    acc.policyReason.push(
      `Anomaly detected (score ${anomalyScore.toFixed(2)}, risk ${riskLevel}).`,
    );
    fire(acc, 'ANOMALY_REVIEW_TRIGGER',
      `Anomaly score ${anomalyScore.toFixed(2)} ≥ review threshold ${reviewThreshold.toFixed(2)}`,
      'ANOMALY', `reviewRequired=true queue=${acc.queue}`);
  }

  if (anomalyScore >= escalationThreshold || riskLevel === 'CRITICAL') {
    acc.escalationRequired = true;
    acc.escalationLevel = 'MANAGER';
    acc.hold = true;
    if (riskLevel === 'CRITICAL') {
      acc.escalationLevel = 'DIRECTOR';
      acc.priority = 'CRITICAL';
      acc.holdReason.push('Critical anomaly risk requires immediate hold.');
    } else {
      acc.priority = 'URGENT';
    }
    acc.escalationReason.push(
      `Anomaly score ${anomalyScore.toFixed(2)} triggers escalation (risk: ${riskLevel}).`,
    );
    acc.policyReason.push(`High anomaly risk (${riskLevel}) triggers escalation.`);
    fire(acc, 'ANOMALY_ESCALATION',
      `Anomaly score ${anomalyScore.toFixed(2)} ≥ escalation threshold ${escalationThreshold.toFixed(2)}`,
      'ANOMALY', `escalation=${acc.escalationLevel} hold=true priority=${acc.priority}`);
  }

  if (riskLevel === 'HIGH' && acc.priority === 'NORMAL') {
    acc.priority = 'HIGH';
    fire(acc, 'ANOMALY_RISK_HIGH', 'Risk level HIGH boosts priority', 'ANOMALY',
      'priority=HIGH');
  }

  // Specific anomaly types requiring queue overrides
  if (anomalyTypes.includes('EXACT_DUPLICATE') || anomalyTypes.includes('NEAR_DUPLICATE')) {
    acc.reviewRequired = true;
    acc.hold = true;
    acc.holdReason.push('Duplicate transaction detected — hold pending review.');
    if (acc.queue === 'AUTO_CLEAR_CANDIDATE') acc.queue = 'ANOMALY_REVIEW';
    fire(acc, 'ANOMALY_DUPLICATE', 'Duplicate anomaly type detected', 'ANOMALY',
      'hold=true queue=ANOMALY_REVIEW');
  }

  if (anomalyTypes.includes('SPLIT_TRANSACTION')) {
    acc.reviewRequired = true;
    acc.priority = acc.priority === 'LOW' || acc.priority === 'NORMAL' ? 'HIGH' : acc.priority;
    acc.policyReason.push('Split transaction pattern detected.');
    fire(acc, 'ANOMALY_SPLIT', 'Split transaction pattern', 'ANOMALY', 'reviewRequired=true priority≥HIGH');
  }

  if (anomalyTypes.includes('CROSS_COMPANY_PATTERN')) {
    acc.reviewRequired = true;
    if (
      acc.queue === 'AUTO_CLEAR_CANDIDATE' ||
      acc.queue === 'STANDARD_FINANCE_REVIEW' ||
      acc.queue === 'ANOMALY_REVIEW'
    ) {
      acc.queue = 'INTERCOMPANY_REVIEW';
    }
    acc.escalationRequired = true;
    if (acc.escalationLevel === 'NONE') acc.escalationLevel = 'TEAM_LEAD';
    acc.escalationReason.push('Cross-company pattern detected.');
    fire(acc, 'ANOMALY_CROSS_COMPANY', 'Cross-company anomaly', 'ANOMALY',
      'queue=INTERCOMPANY_REVIEW escalation=TEAM_LEAD');
  }
}

// ─── Rule: Amount-based decisions ─────────────────────────────────────────────

export function applyAmountRules(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
  highValue: number,
  criticalValue: number,
  escalationValue: number,
): void {
  const amount = input.transaction.amount;

  if (amount >= escalationValue) {
    acc.reviewRequired = true;
    acc.escalationRequired = true;
    acc.escalationLevel = 'EXECUTIVE';
    acc.escalationReason.push(`Amount ${amount.toLocaleString()} exceeds escalation threshold.`);
    acc.approvalRequired = true;
    acc.approvalLevel = 'COMMITTEE';
    acc.minApprovers = 3;
    acc.approvalReason.push('Transaction amount requires committee approval.');
    acc.priority = 'CRITICAL';
    acc.reviewLevel = 'EXECUTIVE';
    acc.reviewerRole = 'CFO';
    acc.policyReason.push(`Amount exceeds escalation threshold (${escalationValue.toLocaleString()}).`);
    fire(acc, 'AMOUNT_ESCALATION',
      `Amount ${amount} ≥ escalation value ${escalationValue}`, 'AMOUNT',
      'escalation=EXECUTIVE approval=COMMITTEE priority=CRITICAL reviewer=CFO');
  } else if (amount >= criticalValue) {
    acc.reviewRequired = true;
    acc.approvalRequired = true;
    acc.approvalLevel = 'DUAL';
    acc.minApprovers = 2;
    acc.approvalReason.push('Critical-value transaction requires dual approval.');
    if (acc.priority === 'NORMAL' || acc.priority === 'LOW') acc.priority = 'HIGH';
    if (acc.reviewLevel === 'NONE' || acc.reviewLevel === 'STANDARD') acc.reviewLevel = 'DIRECTOR';
    if (acc.reviewerRole === 'UNASSIGNED' || acc.reviewerRole === 'FINANCE_ANALYST') {
      acc.reviewerRole = 'FINANCE_DIRECTOR';
    }
    acc.policyReason.push(`Critical-value transaction (${amount.toLocaleString()}).`);
    fire(acc, 'AMOUNT_CRITICAL',
      `Amount ${amount} ≥ critical value ${criticalValue}`, 'AMOUNT',
      'approval=DUAL reviewLevel=DIRECTOR priority≥HIGH');
  } else if (amount >= highValue) {
    acc.reviewRequired = true;
    acc.approvalRequired = true;
    acc.approvalLevel = 'SINGLE';
    acc.minApprovers = 1;
    acc.approvalReason.push('High-value transaction requires manager approval.');
    if (acc.reviewLevel === 'NONE' || acc.reviewLevel === 'STANDARD') acc.reviewLevel = 'MANAGER';
    if (acc.reviewerRole === 'UNASSIGNED') acc.reviewerRole = 'ACCOUNTING_MANAGER';
    acc.policyReason.push(`High-value transaction (${amount.toLocaleString()}).`);
    fire(acc, 'AMOUNT_HIGH',
      `Amount ${amount} ≥ high value ${highValue}`, 'AMOUNT',
      'approval=SINGLE reviewLevel=MANAGER');
  }
}

// ─── Rule: Conflict flag rules ────────────────────────────────────────────────

export function applyFlagRules(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
  forceFlags: Set<string>,
): void {
  const flags = [
    ...(input.phase4.ambiguity?.map((f) => f.type) ?? []),
    ...(input.phase7.conflictFlags ?? []),
  ];

  for (const flag of flags) {
    if (forceFlags.has(flag)) {
      acc.reviewRequired = true;
      if (acc.queue === 'AUTO_CLEAR_CANDIDATE') acc.queue = 'HIGH_RISK_REVIEW';
      acc.policyReason.push(`Forced review flag: ${flag}`);
      fire(acc, `FLAG_FORCE_${flag}`, `Force-review flag "${flag}"`, 'FLAG',
        `reviewRequired=true queue=${acc.queue}`);
    }
  }

  // COA-intent mismatch flag
  if (flags.some((f) => f === 'COA_INTENT_MISMATCH' || f === 'INTENT_COA_CONFLICT')) {
    acc.reviewRequired = true;
    if (acc.queue === 'AUTO_CLEAR_CANDIDATE') acc.queue = 'ACCOUNTING_REVIEW';
    acc.policyReason.push('COA and intent mismatch detected.');
    fire(acc, 'FLAG_COA_MISMATCH', 'COA-intent mismatch flag', 'FLAG',
      'reviewRequired=true queue=ACCOUNTING_REVIEW');
  }

  // Direction conflict
  if (flags.some((f) => f.includes('DIRECTION'))) {
    if (acc.queue === 'AUTO_CLEAR_CANDIDATE') acc.queue = 'STANDARD_FINANCE_REVIEW';
    acc.reviewRequired = true;
    acc.policyReason.push('Direction conflict flag present.');
    fire(acc, 'FLAG_DIRECTION', 'Direction conflict flag', 'FLAG', 'reviewRequired=true');
  }
}

// ─── Rule: COA-related decisions ─────────────────────────────────────────────

export function applyCoaRules(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
): void {
  const { primaryRecommendation: recommendedCoa, conflictFlags } = input.phase3;

  if (!recommendedCoa) {
    acc.reviewRequired = true;
    if (acc.queue === 'AUTO_CLEAR_CANDIDATE') acc.queue = 'ACCOUNTING_REVIEW';
    acc.reviewerRole = acc.reviewerRole === 'UNASSIGNED' ? 'SENIOR_ACCOUNTANT' : acc.reviewerRole;
    acc.policyReason.push('No COA recommendation available — manual assignment required.');
    fire(acc, 'COA_NO_RECOMMENDATION', 'Missing COA recommendation', 'COA',
      'reviewRequired=true queue=ACCOUNTING_REVIEW');
  }

  if (conflictFlags && conflictFlags.length > 0) {
    acc.reviewRequired = true;
    if (acc.queue === 'AUTO_CLEAR_CANDIDATE') acc.queue = 'ACCOUNTING_REVIEW';
    acc.policyReason.push(`COA conflict flags: ${conflictFlags.join(', ')}`);
    fire(acc, 'COA_CONFLICT_FLAGS', `COA conflict flags present: ${conflictFlags.join(', ')}`,
      'COA', 'reviewRequired=true queue=ACCOUNTING_REVIEW');
  }
}

// ─── Rule: Counterparty rules ─────────────────────────────────────────────────

export function applyCounterpartyRules(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
): void {
  const anomalyTypes = input.phase7.anomalyTypes;

  if (anomalyTypes.includes('NEW_COUNTERPARTY') || anomalyTypes.includes('UNUSUAL_COUNTERPARTY')) {
    acc.reviewRequired = true;
    if (acc.queue === 'AUTO_CLEAR_CANDIDATE') acc.queue = 'STANDARD_FINANCE_REVIEW';
    acc.policyReason.push('Unusual or new counterparty detected.');
    fire(acc, 'COUNTERPARTY_UNUSUAL', 'Unusual/new counterparty', 'COUNTERPARTY',
      'reviewRequired=true');
  }
}

// ─── Rule: Risk-based priority boosts ────────────────────────────────────────

export function applyRiskPriorityRules(
  input: DecisionPolicyInput,
  acc: PolicyAccumulator,
): void {
  const { riskLevel } = input.phase7;

  const priorityOrder: ReviewPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT', 'CRITICAL'];
  const currentIdx = priorityOrder.indexOf(acc.priority);

  if (riskLevel === 'CRITICAL' && currentIdx < 4) {
    acc.priority = 'CRITICAL';
    fire(acc, 'RISK_CRITICAL_PRIORITY', 'Critical risk forces CRITICAL priority', 'RISK',
      'priority=CRITICAL');
  } else if (riskLevel === 'HIGH' && currentIdx < 3) {
    acc.priority = 'URGENT';
    fire(acc, 'RISK_HIGH_PRIORITY', 'High risk boosts to URGENT priority', 'RISK',
      'priority=URGENT');
  } else if (riskLevel === 'MEDIUM' && currentIdx < 2) {
    acc.priority = 'HIGH';
    fire(acc, 'RISK_MEDIUM_PRIORITY', 'Medium risk boosts to HIGH priority', 'RISK',
      'priority=HIGH');
  }
}

// ─── Rule: Final queue assignment (ensure non-AUTO-CLEAR if review required) ──

export function applyQueueFallback(acc: PolicyAccumulator): void {
  if (acc.reviewRequired && acc.queue === 'AUTO_CLEAR_CANDIDATE') {
    acc.queue = 'STANDARD_FINANCE_REVIEW';
    fire(acc, 'QUEUE_FALLBACK', 'Fallback to STANDARD_FINANCE_REVIEW (review required but no specific queue)', 'QUEUE',
      'queue=STANDARD_FINANCE_REVIEW');
  }

  if (!acc.reviewRequired) {
    acc.queue = 'AUTO_CLEAR_CANDIDATE';
    acc.reviewLevel = 'NONE';
    acc.reviewerRole = 'UNASSIGNED';
  }
}

// ─── Rule: Reviewer role fallback ────────────────────────────────────────────

export function applyReviewerFallback(acc: PolicyAccumulator): void {
  if (acc.reviewRequired && acc.reviewerRole === 'UNASSIGNED') {
    const queueRoleMap: Partial<Record<string, ReviewerRole>> = {
      ACCOUNTING_REVIEW: 'SENIOR_ACCOUNTANT',
      TAX_REVIEW: 'TAX_SPECIALIST',
      PAYROLL_REVIEW: 'PAYROLL_OFFICER',
      TREASURY_REVIEW: 'TREASURY_ANALYST',
      INTERCOMPANY_REVIEW: 'ACCOUNTING_MANAGER',
      ANOMALY_REVIEW: 'SENIOR_ACCOUNTANT',
      HIGH_RISK_REVIEW: 'COMPLIANCE_OFFICER',
      DATA_QUALITY_REVIEW: 'DATA_QUALITY_ANALYST',
      STANDARD_FINANCE_REVIEW: 'FINANCE_ANALYST',
      AUTO_CLEAR_CANDIDATE: 'UNASSIGNED',
    };
    acc.reviewerRole = queueRoleMap[acc.queue] ?? 'FINANCE_ANALYST';
    fire(acc, 'REVIEWER_FALLBACK', `Assign reviewer ${acc.reviewerRole} for queue ${acc.queue}`,
      'REVIEWER', `reviewerRole=${acc.reviewerRole}`);
  }

  if (acc.reviewLevel === 'NONE' && acc.reviewRequired) {
    acc.reviewLevel = 'STANDARD';
    fire(acc, 'REVIEW_LEVEL_FALLBACK', 'Default review level STANDARD', 'REVIEWER',
      'reviewLevel=STANDARD');
  }
}
