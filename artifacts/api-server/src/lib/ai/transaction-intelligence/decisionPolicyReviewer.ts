/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Reviewer Role Assignment
 *
 * Maps queue, intent, and escalation level to the correct ReviewerRole.
 * Pure function, no side effects.
 */

import type { ReviewQueue } from './reviewOrchestrationTypes.js';
import type { TransactionIntent } from './transactionTypes.js';
import type {
  ReviewerRole,
  ReviewLevel,
  EscalationLevel,
} from './decisionPolicyTypes.js';

// ─── Queue → default reviewer ─────────────────────────────────────────────────

const QUEUE_REVIEWER_MAP: Record<ReviewQueue, ReviewerRole> = {
  AUTO_CLEAR_CANDIDATE: 'UNASSIGNED',
  STANDARD_FINANCE_REVIEW: 'FINANCE_ANALYST',
  ACCOUNTING_REVIEW: 'SENIOR_ACCOUNTANT',
  TAX_REVIEW: 'TAX_SPECIALIST',
  PAYROLL_REVIEW: 'PAYROLL_OFFICER',
  TREASURY_REVIEW: 'TREASURY_ANALYST',
  INTERCOMPANY_REVIEW: 'ACCOUNTING_MANAGER',
  ANOMALY_REVIEW: 'SENIOR_ACCOUNTANT',
  HIGH_RISK_REVIEW: 'COMPLIANCE_OFFICER',
  DATA_QUALITY_REVIEW: 'DATA_QUALITY_ANALYST',
};

// ─── Escalation level → required role ────────────────────────────────────────

const ESCALATION_REVIEWER_MAP: Partial<Record<EscalationLevel, ReviewerRole>> = {
  TEAM_LEAD: 'ACCOUNTING_MANAGER',
  MANAGER: 'ACCOUNTING_MANAGER',
  DIRECTOR: 'FINANCE_DIRECTOR',
  EXECUTIVE: 'CFO',
  COMPLIANCE: 'COMPLIANCE_OFFICER',
};

// ─── Review level → required role ────────────────────────────────────────────

const REVIEW_LEVEL_ROLE_MAP: Partial<Record<ReviewLevel, ReviewerRole>> = {
  SENIOR: 'SENIOR_ACCOUNTANT',
  MANAGER: 'ACCOUNTING_MANAGER',
  DIRECTOR: 'FINANCE_DIRECTOR',
  EXECUTIVE: 'CFO',
};

// ─── Compute reviewer role ────────────────────────────────────────────────────

export interface ReviewerResolutionInput {
  queue: ReviewQueue;
  intent: TransactionIntent;
  escalationLevel: EscalationLevel;
  reviewLevel: ReviewLevel;
  currentRole: ReviewerRole;
}

export function resolveReviewerRole(input: ReviewerResolutionInput): ReviewerRole {
  // Escalation overrides everything (e.g. escalation to executive level)
  const escalationRole = ESCALATION_REVIEWER_MAP[input.escalationLevel];
  if (escalationRole) return escalationRole;

  // If an intent-specific or rule-specific role was already assigned, keep it.
  // Review level only overrides UNASSIGNED roles to ensure a level-appropriate reviewer.
  if (input.currentRole !== 'UNASSIGNED') return input.currentRole;

  // No specific role assigned yet — derive from review level
  const levelRole = REVIEW_LEVEL_ROLE_MAP[input.reviewLevel];
  if (levelRole) return levelRole;

  // Derive from queue
  return QUEUE_REVIEWER_MAP[input.queue] ?? 'FINANCE_ANALYST';
}

// ─── Review level from approval level ────────────────────────────────────────

export function approvalLevelToReviewLevel(
  approvalLevel: string,
  current: ReviewLevel,
): ReviewLevel {
  const reviewLevelOrder: ReviewLevel[] = ['NONE', 'STANDARD', 'SENIOR', 'MANAGER', 'DIRECTOR', 'EXECUTIVE'];
  const currentIdx = reviewLevelOrder.indexOf(current);

  if (approvalLevel === 'COMMITTEE') {
    const target = reviewLevelOrder.indexOf('EXECUTIVE');
    return reviewLevelOrder[Math.max(currentIdx, target)]!;
  }
  if (approvalLevel === 'DUAL') {
    const target = reviewLevelOrder.indexOf('DIRECTOR');
    return reviewLevelOrder[Math.max(currentIdx, target)]!;
  }
  if (approvalLevel === 'SINGLE') {
    const target = reviewLevelOrder.indexOf('MANAGER');
    return reviewLevelOrder[Math.max(currentIdx, target)]!;
  }
  return current;
}
