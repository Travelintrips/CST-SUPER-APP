/**
 * Marketplace Semantic Search — Fuzzy Matching Utilities
 *
 * Lightweight Levenshtein-based fuzzy matching.
 * NO external dependencies — uses in-process computation.
 *
 * Rules:
 * - Only applied AFTER exact and synonym matching fails
 * - Conservative threshold: max distance = min(2, floor(len/4))
 * - Minimum query length to attempt fuzzy: 4 characters
 * - Short queries (1–3 chars) never fuzzied
 * - Returns 0 (SCORE.FUZZY_WEAK) if confidence too low to surface
 */

import { MIN_FUZZY_LENGTH } from "./normalizer.js";
import { SCORE } from "./types.js";

/**
 * Compute Levenshtein edit distance between two strings.
 * Uses the classic DP approach — O(n*m) time, O(n) space.
 * Inputs should be lowercase.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Keep only one row (space optimization)
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // deletion
        prev[j] + 1,            // insertion
        prev[j - 1] + cost,     // substitution
      );
    }
    prev = curr;
  }

  return prev[b.length];
}

/**
 * Maximum allowed edit distance for a given query length.
 * Conservative: short queries get distance 1, longer queries up to 2.
 */
export function maxEditDistance(queryLength: number): number {
  if (queryLength < MIN_FUZZY_LENGTH) return 0; // no fuzzy for very short
  if (queryLength <= 5) return 1;
  if (queryLength <= 8) return 1;
  return 2; // max 2 for all longer queries
}

/**
 * Score a candidate field value against a query token using fuzzy matching.
 *
 * Returns:
 * - SCORE.FUZZY_STRONG (70) if within threshold
 * - SCORE.FUZZY_WEAK (0) if not confident enough
 */
export function fuzzyScore(queryToken: string, candidateField: string): number {
  const q = queryToken.toLowerCase().trim();
  const c = candidateField.toLowerCase().trim();

  if (q.length < MIN_FUZZY_LENGTH) return SCORE.FUZZY_WEAK;

  const maxDist = maxEditDistance(q.length);
  const dist = levenshtein(q, c);

  if (dist === 0) return SCORE.EXACT_TOKEN; // exact match
  if (dist <= maxDist) return SCORE.FUZZY_STRONG;
  return SCORE.FUZZY_WEAK;
}

/**
 * Check if any token in the query fuzzy-matches any token in the candidate
 * field value. Splits both sides on whitespace and compares each pair.
 *
 * Returns the best score found (0 if no match above threshold).
 */
export function fuzzyTokenMatch(queryTokens: string[], candidateValue: string): number {
  const candidateTokens = candidateValue.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  let best: number = SCORE.FUZZY_WEAK;

  for (const qt of queryTokens) {
    if (qt.length < MIN_FUZZY_LENGTH) continue;
    const maxDist = maxEditDistance(qt.length);
    for (const ct of candidateTokens) {
      const dist = levenshtein(qt, ct);
      if (dist === 0) return SCORE.EXACT_TOKEN;
      if (dist <= maxDist && SCORE.FUZZY_STRONG > best) {
        best = SCORE.FUZZY_STRONG;
      }
    }
  }

  return best;
}
