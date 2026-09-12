/**
 * AI Transaction Intelligence — Phase 7
 * Anomaly Recommendation Builder
 *
 * Maps anomaly score, risk level, and detections to a reviewer action.
 * Also computes requiresManualReview flag.
 *
 * Engine does NOT modify transaction status — recommendation only.
 * Pure function — no side effects.
 */

import type {
  AnomalyDetection,
  AnomalyRecommendationAction,
  AnomalyRiskLevel,
} from './anomalyTypes.js';

// ─── Recommendation ───────────────────────────────────────────────────────────

export interface RecommendationInput {
  score: number;
  riskLevel: AnomalyRiskLevel;
  detections: AnomalyDetection[];
}

/**
 * Determine the recommended reviewer action.
 *
 * NO_ACTION    → no material anomaly
 * MONITOR      → low signal, limited baseline
 * MANUAL_REVIEW → medium risk or multiple weak signals
 * ESCALATE     → high risk with strong evidence
 * HOLD_FOR_REVIEW → critical, exact dup, or severe cross-company
 *
 * HOLD_FOR_REVIEW is a recommendation only — engine never blocks transactions.
 */
export function buildRecommendation(input: RecommendationInput): AnomalyRecommendationAction {
  const { score, riskLevel, detections } = input;
  const detected = detections.filter(d => d.detected);

  switch (riskLevel) {
    case 'CRITICAL':
      return 'HOLD_FOR_REVIEW';

    case 'HIGH': {
      // Exact dup with strong score → hold
      const strongExactDup = detected.some(
        d => d.type === 'EXACT_DUPLICATE' && d.severity === 'CRITICAL',
      );
      const severeCross = detected.some(
        d => d.type === 'CROSS_COMPANY_PATTERN' && d.severity === 'CRITICAL',
      );
      if (strongExactDup || severeCross) return 'HOLD_FOR_REVIEW';
      return 'ESCALATE';
    }

    case 'MEDIUM': {
      const multipleSignals = detected.filter(d => d.score >= 0.25).length >= 2;
      const hasCoaIssue = detected.some(
        d => d.type === 'COA_INTENT_MISMATCH' || d.type === 'UNUSUAL_COA',
      );
      const hasUnknownIntent = detected.some(d => d.type === 'UNUSUAL_DIRECTION');
      if (multipleSignals || hasCoaIssue || hasUnknownIntent) return 'MANUAL_REVIEW';
      return 'MANUAL_REVIEW';
    }

    case 'LOW': {
      const hasInsufficientBaseline = detected.some(d => d.type === 'INSUFFICIENT_BASELINE');
      if (hasInsufficientBaseline || score < 0.30) return 'MONITOR';
      return 'MONITOR';
    }

    case 'NONE':
    default:
      return 'NO_ACTION';
  }
}

// ─── requiresManualReview ─────────────────────────────────────────────────────

export function computeRequiresManualReview(
  riskLevel: AnomalyRiskLevel,
  recommendation: AnomalyRecommendationAction,
): boolean {
  return riskLevel === 'HIGH' ||
    riskLevel === 'CRITICAL' ||
    recommendation === 'MANUAL_REVIEW' ||
    recommendation === 'ESCALATE' ||
    recommendation === 'HOLD_FOR_REVIEW';
}
