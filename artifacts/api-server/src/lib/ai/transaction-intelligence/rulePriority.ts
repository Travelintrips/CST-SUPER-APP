/**
 * AI Transaction Intelligence — Phase 6
 * Rule Priority Calculator
 *
 * Computes action priority (LOW / NORMAL / HIGH / URGENT) for a recommendation
 * based on: occurrence count, precision gain, manual review reduction,
 * recency of signals, and risk level.
 *
 * Pure function — no side effects, no DB calls.
 */

import type { RulePriority, RuleRiskLevel } from './adaptiveRuleTypes.js';

// ─── Priority input ────────────────────────────────────────────────────────────

export interface PriorityInput {
  /** Number of feedback occurrences supporting this recommendation. */
  occurrenceCount: number;
  /** Estimated precision gain if applied (0–1). */
  estimatedPrecisionGain: number;
  /** Estimated reduction in manual review rate (0–1, positive = fewer reviews). */
  estimatedManualReviewReduction: number;
  /** Risk level of the recommendation. */
  riskLevel: RuleRiskLevel;
  /** Signal confidence (0–1). */
  confidence: number;
  /** Whether this pattern is listed as "problematic" in historical statistics. */
  isProblematicPattern: boolean;
  /** Number of conflicts detected for this recommendation. */
  conflictCount: number;
}

/**
 * Compute a normalized priority score (0.0–1.0, higher = more urgent).
 */
export function computePriorityScore(input: PriorityInput): number {
  let score = 0;

  // Volume: log-scaled — up to 0.3 points
  const volumeScore = Math.min(1, Math.log10(Math.max(1, input.occurrenceCount)) / 3);
  score += volumeScore * 0.30;

  // Precision gain: direct factor — up to 0.25 points
  score += Math.min(1, input.estimatedPrecisionGain) * 0.25;

  // Manual review reduction — up to 0.20 points
  score += Math.min(1, input.estimatedManualReviewReduction) * 0.20;

  // Confidence — up to 0.15 points
  score += input.confidence * 0.15;

  // Problematic pattern flag — +0.10 bonus
  if (input.isProblematicPattern) score += 0.10;

  // Risk penalty: HIGH/CRITICAL recommendations are deprioritized slightly
  // because they need more careful review before acting
  if (input.riskLevel === 'CRITICAL') score -= 0.15;
  else if (input.riskLevel === 'HIGH') score -= 0.08;

  // Conflicts reduce priority (contradictory signals)
  score -= Math.min(0.15, input.conflictCount * 0.05);

  return Math.min(1, Math.max(0, score));
}

/**
 * Map a numeric priority score to a RulePriority label.
 */
export function scoreToPriority(score: number): RulePriority {
  if (score >= 0.62) return 'URGENT';
  if (score >= 0.42) return 'HIGH';
  if (score >= 0.22) return 'NORMAL';
  return 'LOW';
}

/**
 * Compute the action priority for a recommendation.
 */
export function computePriority(input: PriorityInput): RulePriority {
  return scoreToPriority(computePriorityScore(input));
}

/**
 * Aggregate a collection of priorities to the highest one.
 */
export function aggregatePriorities(priorities: RulePriority[]): RulePriority {
  if (priorities.includes('URGENT')) return 'URGENT';
  if (priorities.includes('HIGH')) return 'HIGH';
  if (priorities.includes('NORMAL')) return 'NORMAL';
  return 'LOW';
}

/**
 * Numeric value of a priority for sorting (higher = more urgent).
 */
export function priorityValue(p: RulePriority): number {
  switch (p) {
    case 'URGENT': return 4;
    case 'HIGH':   return 3;
    case 'NORMAL': return 2;
    case 'LOW':    return 1;
  }
}
