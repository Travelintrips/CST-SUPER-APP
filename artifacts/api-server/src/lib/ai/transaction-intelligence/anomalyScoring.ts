/**
 * AI Transaction Intelligence — Phase 7
 * Anomaly Scoring Model
 *
 * Deterministic score aggregation using complement product formula.
 * Pure function — no side effects.
 */

import type {
  AnomalyDetection,
  AnomalyRiskLevel,
  AnomalyRecommendationAction,
  BaselineQuality,
} from './anomalyTypes.js';
import type { AnomalyDetectionPolicy } from './anomalyTypes.js';
import { mergePolicy } from './anomalyRules.js';

// ─── Detector base scores ─────────────────────────────────────────────────────

/** Base weight per anomaly type — deterministic, not learned. */
export const ANOMALY_BASE_WEIGHTS: Record<string, number> = {
  EXACT_DUPLICATE:       0.90,
  CROSS_COMPANY_PATTERN: 0.85,
  SPLIT_TRANSACTION:     0.75,
  COA_INTENT_MISMATCH:   0.65,
  NEAR_DUPLICATE:        0.60,
  REFERENCE_REUSE:       0.60,
  AMOUNT_OUTLIER:        0.55,  // scaled by evidence
  RAPID_REVERSAL:        0.55,
  FREQUENCY_SPIKE:       0.55,
  UNUSUAL_COA:           0.35,
  DESCRIPTION_MISMATCH:  0.30,
  NEW_COUNTERPARTY:      0.25,
  UNUSUAL_COUNTERPARTY:  0.25,
  ROUND_AMOUNT_PATTERN:  0.20,
  UNUSUAL_TRANSACTION_TIME: 0.20,
  UNUSUAL_TRANSACTION_DAY:  0.18,
  UNUSUAL_DIRECTION:     0.30,
  INSUFFICIENT_BASELINE: 0.10,
  UNKNOWN:               0.05,
};

// ─── Complement-product aggregation ──────────────────────────────────────────

/**
 * Combine multiple detector scores deterministically.
 *
 * Formula: combined = 1 − ∏(1 − score_i)
 *
 * This prevents naive addition from exceeding 1.0 while ensuring that
 * multiple independent detectors each contribute positively.
 */
export function combineScores(scores: number[]): number {
  if (scores.length === 0) return 0;
  const product = scores.reduce(
    (acc, s) => acc * (1 - Math.min(1, Math.max(0, s))),
    1,
  );
  return Math.min(1, Math.max(0, 1 - product));
}

// ─── Score → Risk level ───────────────────────────────────────────────────────

export function scoreToRiskLevel(
  score: number,
  policy?: AnomalyDetectionPolicy,
): AnomalyRiskLevel {
  const p = mergePolicy(policy);
  if (score >= p.criticalRiskThreshold) return 'CRITICAL';
  if (score >= p.highRiskThreshold)     return 'HIGH';
  if (score >= p.reviewThreshold)       return 'MEDIUM';
  if (score >= p.anomalyThreshold)      return 'LOW';
  return 'NONE';
}

// ─── Recommendation ───────────────────────────────────────────────────────────

export function scoreToRecommendation(
  score: number,
  detections: AnomalyDetection[],
  policy?: AnomalyDetectionPolicy,
): AnomalyRecommendationAction {
  const p = mergePolicy(policy);
  const detected = detections.filter(d => d.detected);

  // HOLD_FOR_REVIEW: critical score OR exact duplicate with reference OR severe cross-company
  if (
    score >= p.criticalRiskThreshold ||
    detected.some(d => d.type === 'EXACT_DUPLICATE' && d.severity === 'CRITICAL') ||
    detected.some(d => d.type === 'CROSS_COMPANY_PATTERN' && d.severity === 'CRITICAL')
  ) {
    return 'HOLD_FOR_REVIEW';
  }

  // ESCALATE: high score OR strong duplicate OR strong split OR strong cross-company
  if (
    score >= p.highRiskThreshold ||
    detected.some(d =>
      (d.type === 'EXACT_DUPLICATE' || d.type === 'NEAR_DUPLICATE') && d.score >= 0.7,
    ) ||
    detected.some(d => d.type === 'SPLIT_TRANSACTION' && d.score >= 0.6) ||
    detected.some(d => d.type === 'CROSS_COMPANY_PATTERN' && d.score >= 0.6)
  ) {
    return 'ESCALATE';
  }

  // MANUAL_REVIEW: medium score OR multiple weak signals OR unusual COA
  if (
    score >= p.reviewThreshold ||
    detected.filter(d => d.score >= 0.25).length >= 2 ||
    detected.some(d => d.type === 'COA_INTENT_MISMATCH') ||
    detected.some(d => d.type === 'UNUSUAL_COA')
  ) {
    return 'MANUAL_REVIEW';
  }

  // MONITOR: low anomaly score OR limited baseline
  if (
    score >= p.anomalyThreshold ||
    detected.some(d => d.type === 'INSUFFICIENT_BASELINE')
  ) {
    return 'MONITOR';
  }

  return 'NO_ACTION';
}

// ─── Confidence model ─────────────────────────────────────────────────────────

/**
 * Compute overall detection confidence based on baseline quality and
 * number of active detectors.
 */
export function computeDetectionConfidence(
  baselineQuality: BaselineQuality,
  activeDetectorCount: number,
  detectedCount: number,
): number {
  let base: number;
  switch (baselineQuality) {
    case 'STRONG':       base = 0.90; break;
    case 'GOOD':         base = 0.75; break;
    case 'LIMITED':      base = 0.55; break;
    case 'INSUFFICIENT': base = 0.30; break;
  }
  // More active detectors = more coverage = higher confidence
  const coverage = Math.min(1, activeDetectorCount / 8);
  // If nothing detected, high confidence in "clean" assessment when data is good
  const noDetectBonus = detectedCount === 0 && baselineQuality !== 'INSUFFICIENT' ? 0.05 : 0;
  return Math.min(0.99, base * 0.8 + coverage * 0.15 + noDetectBonus);
}

// ─── Aggregate anomaly types ──────────────────────────────────────────────────

export function aggregateAnomalyTypes(detections: AnomalyDetection[]) {
  return detections
    .filter(d => d.detected)
    .map(d => d.type);
}
