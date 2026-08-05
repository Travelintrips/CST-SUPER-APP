/**
 * AI Transaction Intelligence — Phase 6
 * Rule Risk Analyzer
 *
 * Computes risk level (LOW / MEDIUM / HIGH / CRITICAL) for a recommendation
 * based on: scope, occurrence count, consistency, conflict count, and
 * the magnitude of change being proposed.
 *
 * Pure function — no side effects, no DB calls.
 */

import type { RuleRiskLevel } from './adaptiveRuleTypes.js';

// ─── Risk scoring factors ──────────────────────────────────────────────────────

export interface RiskInput {
  /** Confidence of the recommendation (0–1). */
  confidence: number;
  /** Number of supporting feedback occurrences. */
  occurrenceCount: number;
  /** Consistency rate of the supporting feedback (0–1). */
  consistencyRate: number;
  /** Whether this recommendation is scoped to a single company. */
  isCompanyScoped: boolean;
  /** Number of existing rules that conflict with this recommendation. */
  conflictCount: number;
  /** Whether this recommendation changes a threshold parameter. */
  isThresholdChange: boolean;
  /** Whether this recommendation maps to a new COA not seen before. */
  isNewCoaMapping: boolean;
  /**
   * Magnitude of threshold change (0 if not a threshold change).
   * E.g. changing from 0.8 to 0.7 = magnitude 0.1.
   */
  thresholdChangeMagnitude?: number;
}

/**
 * Compute a normalized risk score (0.0–1.0, higher = riskier).
 */
export function computeRiskScore(input: RiskInput): number {
  let risk = 0;

  // Low confidence → higher risk
  risk += (1 - input.confidence) * 0.25;

  // Low consistency → higher risk
  risk += (1 - input.consistencyRate) * 0.20;

  // Sparse evidence → higher risk (log-scaled)
  const evidencePenalty = Math.max(0, 1 - Math.log10(Math.max(1, input.occurrenceCount)) / 2);
  risk += evidencePenalty * 0.15;

  // Conflicts increase risk
  const conflictFactor = Math.min(1, input.conflictCount * 0.2);
  risk += conflictFactor * 0.20;

  // Threshold changes are inherently riskier
  if (input.isThresholdChange) {
    const magnitude = input.thresholdChangeMagnitude ?? 0.05;
    risk += Math.min(0.3, magnitude * 3) * 0.10;
    risk += 0.10; // base threshold penalty
  }

  // New COA mapping has higher risk (unfamiliar territory)
  if (input.isNewCoaMapping) {
    risk += 0.10;
  }

  // Company-scoped is lower risk than global
  if (!input.isCompanyScoped) {
    risk += 0.05;
  }

  return Math.min(1, Math.max(0, risk));
}

/**
 * Map a numeric risk score to a RuleRiskLevel label.
 */
export function scoreToRiskLevel(score: number): RuleRiskLevel {
  if (score >= 0.75) return 'CRITICAL';
  if (score >= 0.50) return 'HIGH';
  if (score >= 0.25) return 'MEDIUM';
  return 'LOW';
}

/**
 * Compute the overall risk level for a recommendation.
 */
export function analyzeRisk(input: RiskInput): RuleRiskLevel {
  return scoreToRiskLevel(computeRiskScore(input));
}

/**
 * Compute the aggregate risk level for a collection of individual risk levels.
 * Returns the worst (highest) level in the set.
 */
export function aggregateRiskLevels(levels: RuleRiskLevel[]): RuleRiskLevel {
  if (levels.includes('CRITICAL')) return 'CRITICAL';
  if (levels.includes('HIGH')) return 'HIGH';
  if (levels.includes('MEDIUM')) return 'MEDIUM';
  return 'LOW';
}

/**
 * Numeric value of a risk level for sorting (higher = riskier).
 */
export function riskLevelValue(level: RuleRiskLevel): number {
  switch (level) {
    case 'CRITICAL': return 4;
    case 'HIGH':     return 3;
    case 'MEDIUM':   return 2;
    case 'LOW':      return 1;
  }
}
