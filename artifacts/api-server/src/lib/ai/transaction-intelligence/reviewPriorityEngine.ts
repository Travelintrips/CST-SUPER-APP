/**
 * AI Transaction Intelligence — Phase 8
 * Review Priority Engine
 *
 * Deterministic multi-signal priority scoring.
 * Pure function — no side effects, no DB calls.
 *
 * Priority is determined by combining multiple evidence signals.
 * No single signal (e.g. large amount) can alone produce CRITICAL.
 */

import type {
  ReviewPriority,
  ReviewQueue,
  ReviewOrchestrationPolicy,
  ReviewSla,
} from './reviewOrchestrationTypes.js';
import type { ReviewOrchestrationInput } from './reviewOrchestrationTypes.js';

// ─── Scoring constants ────────────────────────────────────────────────────────

const SCORE_THRESHOLDS: Record<ReviewPriority, number> = {
  CRITICAL: 0.85,
  URGENT:   0.65,
  HIGH:     0.45,
  NORMAL:   0.25,
  LOW:      0,
};

function scoreToReviewPriority(score: number): ReviewPriority {
  if (score >= SCORE_THRESHOLDS.CRITICAL) return 'CRITICAL';
  if (score >= SCORE_THRESHOLDS.URGENT)   return 'URGENT';
  if (score >= SCORE_THRESHOLDS.HIGH)     return 'HIGH';
  if (score >= SCORE_THRESHOLDS.NORMAL)   return 'NORMAL';
  return 'LOW';
}

// ─── Priority engine ──────────────────────────────────────────────────────────

export interface PriorityInput {
  orchestrationInput: ReviewOrchestrationInput;
  queue: ReviewQueue;
  sla?: ReviewSla;
}

/**
 * Calculate review priority for a case.
 *
 * Score components (max combined via complement-product):
 *   - Anomaly risk level
 *   - Anomaly types (duplicate, split, cross-company)
 *   - Transaction amount vs policy thresholds
 *   - AI confidence (low confidence = higher priority)
 *   - Phase 3/4 manual review requirement
 *   - Accounting ambiguity
 *   - Tax / payroll sensitivity
 *   - SLA overdue
 *   - Queue-based baseline
 */
export function calculateReviewPriority(input: PriorityInput): ReviewPriority {
  const { orchestrationInput, queue, sla } = input;
  const { phase2, phase3, phase4, phase7, policy, transaction } = orchestrationInput;
  const intent = phase2.primaryIntent;
  const anomalyRisk = phase7.riskLevel;
  const scores: number[] = [];

  // ── Policy intent override ─────────────────────────────────────────────────
  if (policy?.priorityOverridesByIntent?.[intent]) {
    return policy.priorityOverridesByIntent[intent]!;
  }

  // ── Anomaly risk ───────────────────────────────────────────────────────────
  const anomalyRiskScore: Record<string, number> = {
    CRITICAL: 0.90,
    HIGH:     0.70,
    MEDIUM:   0.45,
    LOW:      0.20,
    NONE:     0,
  };
  scores.push(anomalyRiskScore[anomalyRisk] ?? 0);

  // ── Exact duplicate ────────────────────────────────────────────────────────
  if (phase7.anomalyTypes?.includes('EXACT_DUPLICATE')) {
    scores.push(0.85);
  }

  // ── Split transaction ──────────────────────────────────────────────────────
  if (phase7.anomalyTypes?.includes('SPLIT_TRANSACTION')) {
    scores.push(0.70);
  }

  // ── Cross-company pattern ──────────────────────────────────────────────────
  if (phase7.anomalyTypes?.includes('CROSS_COMPANY_PATTERN')) {
    scores.push(0.75);
  }

  // ── Near-duplicate ─────────────────────────────────────────────────────────
  if (phase7.anomalyTypes?.includes('NEAR_DUPLICATE')) {
    scores.push(0.55);
  }

  // ── Amount thresholds (require combination with another signal) ───────────
  const amount = transaction.amount;
  const criticalValue = policy?.criticalValueThreshold ?? 500_000_000;
  const highValue = policy?.highValueThreshold ?? 100_000_000;

  if (amount >= criticalValue) {
    // Amount alone doesn't make it CRITICAL — contributes moderately
    scores.push(0.50);
  } else if (amount >= highValue) {
    scores.push(0.30);
  }

  // ── Low AI confidence ─────────────────────────────────────────────────────
  const intentConf = phase2.confidence;
  const coaConf = phase3.primaryRecommendation?.confidence ?? 0;
  if (intentConf < 0.50 || coaConf < 0.50) {
    scores.push(0.40);
  } else if (intentConf < 0.70 || coaConf < 0.70) {
    scores.push(0.25);
  }

  // ── Manual review required ────────────────────────────────────────────────
  if (phase7.requiresManualReview || phase3.requiresManualReview) {
    scores.push(0.50);
  }

  // ── Accounting ambiguity ──────────────────────────────────────────────────
  if (
    phase4.ambiguity?.some(a =>
      a.type === 'AR_VS_REVENUE' ||
      a.type === 'AP_VS_EXPENSE',
    )
  ) {
    scores.push(0.35);
  }

  // ── Tax / payroll sensitivity ─────────────────────────────────────────────
  if (intent === 'TAX_PAYMENT') scores.push(0.55);
  if (intent === 'PAYROLL')     scores.push(0.50);

  // ── SLA overdue ───────────────────────────────────────────────────────────
  if (sla?.isOverdue) {
    scores.push(0.65);
  }

  // ── Queue-based baseline floor ────────────────────────────────────────────
  const queueFloor: Partial<Record<ReviewQueue, number>> = {
    HIGH_RISK_REVIEW:     0.70,
    INTERCOMPANY_REVIEW:  0.60,
    ANOMALY_REVIEW:       0.50,
    TAX_REVIEW:           0.45,
    PAYROLL_REVIEW:       0.45,
    TREASURY_REVIEW:      0.30,
    ACCOUNTING_REVIEW:    0.25,
    DATA_QUALITY_REVIEW:  0.20,
    STANDARD_FINANCE_REVIEW: 0.15,
    AUTO_CLEAR_CANDIDATE: 0.05,
  };
  scores.push(queueFloor[queue] ?? 0.15);

  // ── Combine via complement-product ────────────────────────────────────────
  const combined = scores.reduce((acc, s) => acc * (1 - Math.min(1, Math.max(0, s))), 1);
  const finalScore = Math.min(1, Math.max(0, 1 - combined));

  return scoreToReviewPriority(finalScore);
}
