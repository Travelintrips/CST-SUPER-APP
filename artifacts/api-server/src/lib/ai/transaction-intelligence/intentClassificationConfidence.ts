/**
 * AI Transaction Intelligence — Phase 2
 * Confidence Model
 *
 * Combines Phase 1 analysis with Phase 2 contextual signals into a
 * final normalized confidence score.
 *
 * Weight Budget (sums to 1.00):
 *   - Phase 1 semantic match  : 0.35
 *   - Direction consistency   : 0.20
 *   - Counterparty role       : 0.20
 *   - Transaction code        : 0.10
 *   - Internal account        : 0.10
 *   - Supporting keyword      : 0.05
 *
 * Rules:
 *   - No Math.random(). Deterministic.
 *   - Output is always clamped to [0.00, 1.00].
 *   - All weights are named constants.
 */

import type { TransactionIntent } from './transactionTypes.js';
import type { CounterpartyRole } from './intentClassificationTypes.js';
import {
  directionDelta,
  counterpartyBoost,
  transactionCodeBoost,
  internalAccountBoost,
} from './intentClassificationRules.js';

// ─── Weight constants ─────────────────────────────────────────────────────────

/**
 * The Phase 2 confidence model weights.
 * All weights must sum to 1.00.
 *
 * These are documented in AI_TRANSACTION_INTENT_CLASSIFICATION.md under
 * the "Confidence Model" section.
 */
export const CONFIDENCE_WEIGHTS = {
  /** Phase 1 semantic keyword match (base signal). */
  PHASE1_MATCH:       0.35,
  /** Direction consistency bonus/penalty (applied as a scaled signal). */
  DIRECTION:          0.20,
  /** Counterparty role match. */
  COUNTERPARTY:       0.20,
  /** Bank transaction code hint. */
  TRANSACTION_CODE:   0.10,
  /** Confirmed internal account (for INTERNAL_TRANSFER). */
  INTERNAL_ACCOUNT:   0.10,
  /** Supporting keywords not part of Phase 1 primary match. */
  SUPPORTING_KEYWORD: 0.05,
} as const;

/** Verify weights sum to 1.00 at load time (type-level documentation). */
const _SUM = Object.values(CONFIDENCE_WEIGHTS).reduce((a, b) => a + b, 0);
// Rounding tolerance: allow 0.001 drift
if (Math.abs(_SUM - 1.00) > 0.001) {
  // This is a coding-time invariant check — should never fire if weights are correct
  console.warn(`[intentClassificationConfidence] Weight sum = ${_SUM} (expected 1.00)`);
}

// ─── Composite score builder ──────────────────────────────────────────────────

export interface CompositeScoreInput {
  intent: TransactionIntent;
  phase1Confidence: number;
  direction?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
  counterpartyRole?: CounterpartyRole;
  transactionCode?: string;
  isInternalAccount?: boolean;
  /** Whether this intent had supporting keyword matches beyond Phase 1. */
  hasSupportingKeywords?: boolean;
}

/**
 * Compute a composite confidence score for one intent using all available signals.
 *
 * Formula:
 *   score = Σ(weight_i × signal_i)
 *
 * Each signal is normalized to [0, 1] before weighting.
 */
export function computeCompositeScore(input: CompositeScoreInput): number {
  const {
    intent,
    phase1Confidence,
    direction,
    counterpartyRole,
    transactionCode,
    isInternalAccount = false,
    hasSupportingKeywords = false,
  } = input;

  // ── Signal 1: Phase 1 match ──────────────────────────────────────────────
  const s1 = clamp01(phase1Confidence) * CONFIDENCE_WEIGHTS.PHASE1_MATCH;

  // ── Signal 2: Direction ──────────────────────────────────────────────────
  // directionDelta returns BOOST (+0.20) or PENALTY (−0.15) normalized against max boost
  const dd = directionDelta(intent, direction);
  // Normalize: +0.20 → +1.0 of the weight, −0.15 → −0.75, 0 → 0
  const dirSignal = dd >= 0 ? dd / 0.20 : dd / 0.20; // scale to [-0.75, 1.0]
  const s2 = dirSignal * CONFIDENCE_WEIGHTS.DIRECTION;

  // ── Signal 3: Counterparty ───────────────────────────────────────────────
  const cp = counterpartyBoost(intent, counterpartyRole, direction);
  const s3 = (cp / 0.20) * CONFIDENCE_WEIGHTS.COUNTERPARTY; // normalize 0.20→1.0

  // ── Signal 4: Transaction code ───────────────────────────────────────────
  const tc = transactionCodeBoost(intent, transactionCode);
  const s4 = (tc / 0.10) * CONFIDENCE_WEIGHTS.TRANSACTION_CODE;

  // ── Signal 5: Internal account ───────────────────────────────────────────
  const ia = internalAccountBoost(intent, isInternalAccount);
  const s5 = (ia / 0.10) * CONFIDENCE_WEIGHTS.INTERNAL_ACCOUNT;

  // ── Signal 6: Supporting keyword ─────────────────────────────────────────
  const s6 = (hasSupportingKeywords ? 1.0 : 0.0) * CONFIDENCE_WEIGHTS.SUPPORTING_KEYWORD;

  const raw = s1 + s2 + s3 + s4 + s5 + s6;
  return Math.round(clamp01(raw) * 1000) / 1000;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
