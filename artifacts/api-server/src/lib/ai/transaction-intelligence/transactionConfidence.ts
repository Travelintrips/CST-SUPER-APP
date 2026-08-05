/**
 * AI Transaction Intelligence — Phase 1
 * Confidence Engine
 *
 * Converts raw keyword-match scores into a normalized 0.00–1.00 confidence
 * and decides whether the result requires manual review.
 *
 * Rules:
 *  - Deterministic: same input → same output always.
 *  - No Math.random(). No DB calls.
 *  - All thresholds are named constants, never scattered magic numbers.
 */

import type { IntentCandidate, TransactionAnalysisResult, Explanation } from './transactionTypes.js';
import { isTaxIntent as isTaxIntentValue } from './transactionTypes.js';

// ─── Thresholds — single source of truth ─────────────────────────────────────

export const CONFIDENCE_THRESHOLDS = {
  /**
   * Minimum confidence to omit requiresManualReview flag.
   * Below this → always manual review.
   */
  MIN_AUTO_APPROVE: 0.70,

  /**
   * Maximum gap between #1 and #2 candidates to trigger manual review.
   * If gap < this, the top two intents are too close to auto-decide.
   */
  TOP_TWO_MIN_GAP: 0.10,

  /**
   * Phase 1 confidence below this is considered "low" and mentioned in explanation.
   */
  LOW_CONFIDENCE_NOTICE: 0.50,

  /**
   * Raw score ceiling for a single intent before normalization.
   * Prevents one intent with many weak keywords from dominating.
   */
  RAW_SCORE_CEILING: 1.50,
} as const;

// ─── Score normalization ──────────────────────────────────────────────────────

/**
 * Normalize a raw accumulated score (which can exceed 1.0) into 0.00–1.00.
 *
 * Formula: sigmoid-like curve that keeps 0.80 raw → ~0.80, 1.50 raw → ~0.95
 * so that a single strong match saturates near 1.0 but does not overflow.
 *
 *   normalized = rawScore / (rawScore + CEILING - rawScore)
 *             = rawScore / CEILING  (when rawScore ≤ CEILING)
 *
 * We use simple linear clamp for transparency and testability.
 */
export function normalizeScore(rawScore: number): number {
  const clamped = Math.max(0, Math.min(rawScore, CONFIDENCE_THRESHOLDS.RAW_SCORE_CEILING));
  return Math.round((clamped / CONFIDENCE_THRESHOLDS.RAW_SCORE_CEILING) * 1000) / 1000;
}

// ─── Explanation builder ──────────────────────────────────────────────────────

export function buildExplanation(
  sorted: IntentCandidate[],
  normalized: string,
): Explanation {
  const top = sorted[0];
  if (!top || top.intent === 'UNKNOWN') {
    return {
      primaryReason: 'No keywords matched any known transaction intent.',
      supportingFactors: [],
      keywordsMatched: [],
      lowConfidenceReasons: [
        'Description contains no recognizable transaction vocabulary.',
        'Consider adding a manual intent label.',
      ],
    };
  }

  const keywordsMatched = top.matchedKeywords.map((m) => m.keyword);
  const supportingFactors: string[] = [];
  const lowConfidenceReasons: string[] = [];

  // Report secondary candidates
  if (sorted.length > 1) {
    const second = sorted[1];
    supportingFactors.push(
      `Alternative candidate: ${second.intent} (score ${normalizeScore(second.score).toFixed(2)})`,
    );
  }

  const topScore = normalizeScore(top.score);

  if (topScore < CONFIDENCE_THRESHOLDS.LOW_CONFIDENCE_NOTICE) {
    lowConfidenceReasons.push(
      `Only weak keyword signals found (confidence ${topScore.toFixed(2)}).`,
    );
  }

  if (
    sorted.length >= 2 &&
    normalizeScore(top.score) - normalizeScore(sorted[1].score) < CONFIDENCE_THRESHOLDS.TOP_TWO_MIN_GAP
  ) {
    lowConfidenceReasons.push(
      `Top two intents are close: ${top.intent} vs ${sorted[1].intent}.`,
    );
  }

  if (normalized.length < 3) {
    lowConfidenceReasons.push('Description is very short — limited signal available.');
  }

  return {
    primaryReason: `Intent "${top.intent}" matched via keywords: ${keywordsMatched.slice(0, 3).join(', ')}.`,
    supportingFactors,
    keywordsMatched,
    lowConfidenceReasons,
  };
}

// ─── Manual review flag ───────────────────────────────────────────────────────

export function shouldRequireManualReview(
  sorted: IntentCandidate[],
): boolean {
  if (sorted.length === 0) return true;

  const top = sorted[0];
  if (top.intent === 'UNKNOWN') return true;

  const topNorm = normalizeScore(top.score);

  // Below confidence threshold
  if (topNorm < CONFIDENCE_THRESHOLDS.MIN_AUTO_APPROVE) return true;

  // Top two too close
  if (sorted.length >= 2) {
    const secondNorm = normalizeScore(sorted[1].score);
    if (topNorm - secondNorm < CONFIDENCE_THRESHOLDS.TOP_TWO_MIN_GAP) return true;
  }

  return false;
}

// ─── Final result assembler ───────────────────────────────────────────────────

/**
 * Given a sorted list of candidates (descending score) and the normalized description,
 * produce the final TransactionAnalysisResult.
 */
export function assembleResult(
  sorted: IntentCandidate[],
  normalizedDescription: string,
): Pick<TransactionAnalysisResult, 'intent' | 'confidence' | 'candidates' | 'explanation' | 'requiresManualReview'> {
  const top = sorted[0];
  const intent = top?.intent ?? 'UNKNOWN';
  const rawScore = top?.score ?? 0;
  const confidence = normalizeScore(rawScore);

  // Cap candidates list at 5 for output cleanliness
  const candidates = sorted.slice(0, 5).map((c) => ({
    ...c,
    score: normalizeScore(c.score),
  }));

  const explanation = buildExplanation(sorted, normalizedDescription);
  const requiresManualReview =
    shouldRequireManualReview(sorted) ||
    isTaxIntentValue(intent);

  return { intent, confidence, candidates, explanation, requiresManualReview };
}
