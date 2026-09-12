/**
 * AI Transaction Intelligence — Phase 8
 * Review Queue Router
 *
 * Deterministic queue routing based on Phase 1–7 results + policy.
 * Pure function — no side effects, no DB calls.
 *
 * Priority rules when multiple queues match:
 *   HIGH_RISK_REVIEW > INTERCOMPANY_REVIEW > ANOMALY_REVIEW >
 *   TAX_REVIEW > PAYROLL_REVIEW > TREASURY_REVIEW >
 *   ACCOUNTING_REVIEW > DATA_QUALITY_REVIEW >
 *   STANDARD_FINANCE_REVIEW > AUTO_CLEAR_CANDIDATE
 */

import type { ReviewQueue, ReviewOrchestrationPolicy } from './reviewOrchestrationTypes.js';
import type { ReviewOrchestrationInput } from './reviewOrchestrationTypes.js';

// ─── Queue priority order (highest index = highest precedence) ────────────────

const QUEUE_PRECEDENCE: ReviewQueue[] = [
  'AUTO_CLEAR_CANDIDATE',
  'STANDARD_FINANCE_REVIEW',
  'DATA_QUALITY_REVIEW',
  'ACCOUNTING_REVIEW',
  'TREASURY_REVIEW',
  'PAYROLL_REVIEW',
  'TAX_REVIEW',
  'ANOMALY_REVIEW',
  'INTERCOMPANY_REVIEW',
  'HIGH_RISK_REVIEW',
];

function maxQueue(candidates: ReviewQueue[]): ReviewQueue {
  if (candidates.length === 0) return 'STANDARD_FINANCE_REVIEW';
  return candidates.reduce((best, q) => {
    return QUEUE_PRECEDENCE.indexOf(q) > QUEUE_PRECEDENCE.indexOf(best) ? q : best;
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * Route a review case to the appropriate queue.
 *
 * Deterministic — same inputs always produce same queue.
 * Returns the highest-precedence matching queue.
 */
export function routeReviewCase(input: ReviewOrchestrationInput): ReviewQueue {
  const { phase2, phase3, phase4, phase7, policy } = input;
  const candidates: ReviewQueue[] = [];

  const intent = phase2.primaryIntent;
  const anomalyRisk = phase7.riskLevel;
  const anomalyScore = phase7.anomalyScore;
  const conflictFlags = [
    ...(phase3.conflictFlags ?? []),
    ...(phase4.ambiguity?.map(a => a.type) ?? []),
    ...(phase7.conflictFlags ?? []),
  ];

  // ── Policy intent override ─────────────────────────────────────────────────
  if (policy?.queueOverridesByIntent?.[intent]) {
    return policy.queueOverridesByIntent[intent]!;
  }

  // ── HIGH / CRITICAL anomaly → HIGH_RISK_REVIEW ────────────────────────────
  if (anomalyRisk === 'CRITICAL' || anomalyRisk === 'HIGH') {
    candidates.push('HIGH_RISK_REVIEW');
  }

  // ── Anomaly score ≥ 0.35 → ANOMALY_REVIEW ────────────────────────────────
  if (anomalyScore >= 0.35 && anomalyRisk !== 'NONE') {
    candidates.push('ANOMALY_REVIEW');
  }

  // ── Cross-company → INTERCOMPANY_REVIEW ───────────────────────────────────
  if (
    phase7.anomalyTypes?.includes('CROSS_COMPANY_PATTERN') ||
    conflictFlags.some(f => /cross.company|intercompany/i.test(f))
  ) {
    candidates.push('INTERCOMPANY_REVIEW');
  }

  // ── Intent-based routing ──────────────────────────────────────────────────
  if (intent === 'TAX_PAYMENT') {
    candidates.push('TAX_REVIEW');
  }
  if (intent === 'PAYROLL') {
    candidates.push('PAYROLL_REVIEW');
  }
  if (intent === 'INTERNAL_TRANSFER') {
    candidates.push('TREASURY_REVIEW');
  }

  // ── AR/AP ambiguity → ACCOUNTING_REVIEW ──────────────────────────────────
  const hasArAmbiguity = conflictFlags.some(f => /AR_VS_REVENUE|ar.*vs/i.test(f));
  const hasApAmbiguity = conflictFlags.some(f => /AP_VS_EXPENSE|ap.*vs/i.test(f));
  const hasAccountingAmbiguity =
    hasArAmbiguity ||
    hasApAmbiguity ||
    phase4.ambiguity?.some(a =>
      a.type === 'AR_VS_REVENUE' || a.type === 'AP_VS_EXPENSE',
    );

  if (hasAccountingAmbiguity) {
    candidates.push('ACCOUNTING_REVIEW');
  }

  // ── Unknown intent / insufficient data → DATA_QUALITY_REVIEW ─────────────
  if (
    intent === 'UNKNOWN' ||
    phase2.confidence < 0.30 ||
    !input.transaction.description?.trim()
  ) {
    candidates.push('DATA_QUALITY_REVIEW');
  }

  // ── Force manual review flags ─────────────────────────────────────────────
  if (policy?.forceManualReviewForIntents?.includes(intent)) {
    candidates.push('STANDARD_FINANCE_REVIEW');
  }
  if (
    policy?.forceManualReviewForFlags?.some(flag =>
      conflictFlags.some(cf => cf.includes(flag)),
    )
  ) {
    candidates.push('STANDARD_FINANCE_REVIEW');
  }

  // ── AUTO_CLEAR_CANDIDATE — high confidence, low anomaly, no conflicts ──────
  const minConfidence = policy?.autoClearMinimumConfidence ?? 0.85;
  const maxAnomaly = policy?.autoClearMaximumAnomalyScore ?? 0.15;
  const isClean =
    phase2.confidence >= minConfidence &&
    (phase3.primaryRecommendation?.confidence ?? 0) >= minConfidence &&
    anomalyScore <= maxAnomaly &&
    !phase7.requiresManualReview &&
    !phase3.requiresManualReview &&
    !phase4.recommendation?.status?.includes('REVIEW') &&
    conflictFlags.length === 0 &&
    candidates.length === 0;

  if (isClean) {
    return 'AUTO_CLEAR_CANDIDATE';
  }

  // ── Default ───────────────────────────────────────────────────────────────
  if (candidates.length === 0) {
    candidates.push('STANDARD_FINANCE_REVIEW');
  }

  return maxQueue(candidates);
}
