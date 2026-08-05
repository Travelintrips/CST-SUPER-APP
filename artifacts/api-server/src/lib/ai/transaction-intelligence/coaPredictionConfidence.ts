/**
 * AI Transaction Intelligence — Phase 3
 * COA Prediction Confidence Model
 *
 * Weight Budget (sums to 1.00):
 *   - Historical approved mapping  : 0.30
 *   - Phase 2 intent compatibility : 0.25
 *   - Account keyword/alias match  : 0.15
 *   - Account category/type        : 0.10
 *   - Direction/normal balance     : 0.10
 *   - Counterparty mapping         : 0.05
 *   - Transaction code/reference   : 0.05
 *
 * Penalties (applied after weighted sum):
 *   - Direction conflict            : -0.20
 *   - Historical rejected mapping   : -0.25
 *   - Unknown intent                : -0.20
 *   - AR/revenue ambiguity          : -0.15
 *   - AP/expense ambiguity          : -0.15
 *
 * Rules:
 *   - No Math.random(). Deterministic.
 *   - Output clamped to [0.00, 1.00].
 *   - All weights are named constants.
 */

import type { TransactionIntent } from './transactionTypes.js';
import { isTaxIntent } from './transactionTypes.js';

// ─── Weight constants ──────────────────────────────────────────────────────────

export const COA_CONFIDENCE_WEIGHTS = {
  /** Approved historical mapping boost. */
  HISTORICAL_APPROVED:        0.30,
  /** Phase 2 intent-to-account compatibility. */
  INTENT_COMPATIBILITY:       0.25,
  /** Account keyword and alias matching. */
  KEYWORD_ALIAS_MATCH:        0.15,
  /** Account category / type compatibility. */
  CATEGORY_TYPE_COMPATIBILITY: 0.10,
  /** Direction vs. normal balance compatibility. */
  DIRECTION_NORMAL_BALANCE:   0.10,
  /** Counterparty name match. */
  COUNTERPARTY_MAPPING:       0.05,
  /** Transaction code / reference evidence. */
  TRANSACTION_CODE_REFERENCE: 0.05,
} as const;

/** Verify weights sum to 1.00 at load time. */
const _WEIGHT_SUM = Object.values(COA_CONFIDENCE_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(_WEIGHT_SUM - 1.00) > 0.001) {
  console.warn(`[coaPredictionConfidence] Weight sum = ${_WEIGHT_SUM} (expected 1.00)`);
}

// ─── Penalty constants ─────────────────────────────────────────────────────────

export const COA_CONFIDENCE_PENALTIES = {
  /** Transaction direction conflicts with account's normal balance. */
  DIRECTION_CONFLICT:        -0.20,
  /** Historical mapping has significant rejection history. */
  HISTORICAL_REJECTED:       -0.25,
  /** Intent is UNKNOWN — no reliable COA evidence. */
  UNKNOWN_INTENT:            -0.20,
  /** CUSTOMER_PAYMENT being routed to a revenue account. */
  AR_REVENUE_AMBIGUITY:      -0.15,
  /** VENDOR_PAYMENT being routed to an expense account. */
  AP_EXPENSE_AMBIGUITY:      -0.15,
} as const;

// ─── Manual review thresholds ──────────────────────────────────────────────────

export const COA_REVIEW_THRESHOLDS = {
  /** requiresManualReview = true when confidence < this. */
  MANUAL_REVIEW_CONFIDENCE:  0.80,
  /** requiresManualReview = true when gap between #1 and #2 < this. */
  AMBIGUITY_DELTA:           0.10,
  /**
   * Accounts with score < this are excluded from output.
   * Set very low (0.05) so keyword-only matches for minimal-keyword accounts
   * (e.g. test/synthetic accounts) are still included; the
   * manualReviewThreshold (0.80) governs when human review is needed.
   */
  MINIMUM_CONFIDENCE:        0.05,
  /** Max number of alternatives returned (default). */
  MAX_ALTERNATIVES:          4,
} as const;

// ─── Composite score builder ───────────────────────────────────────────────────

export interface CoaCandidateScoreInput {
  /** Normalised [0, 1] signal from historical approved mappings. */
  historicalScore: number;
  /** Whether the historical mapping had significant rejections. */
  historicalRejected: boolean;
  /** Phase 2 intent compatibility: normalised keyword score against intent. */
  intentKeywordScore: number;
  /** Account keyword/alias match score [0, 1]. */
  keywordAliasScore: number;
  /** Category/type score delta (typically −0.10 to +0.10). */
  categoryScore: number;
  /** Direction/normal balance delta (typically −0.10 to +0.10). */
  directionScore: number;
  /** Counterparty match score [0, 0.05]. */
  counterpartyScore: number;
  /** Transaction code match score [0, 0.05]. */
  transactionCodeScore: number;
  /** Primary intent classification. */
  intent: TransactionIntent;
  /** Whether there is an AR/revenue ambiguity for this account. */
  arRevenueAmbiguity: boolean;
  /** Whether there is an AP/expense ambiguity for this account. */
  apExpenseAmbiguity: boolean;
  /** Whether there is a strict direction conflict (different sign). */
  directionConflict: boolean;
}

/**
 * Compute a composite confidence score for a single COA candidate.
 * Output is clamped to [0.00, 1.00] and rounded to 3 decimal places.
 */
export function computeCoaScore(input: CoaCandidateScoreInput): number {
  const {
    historicalScore,
    historicalRejected,
    intentKeywordScore,
    keywordAliasScore,
    categoryScore,
    directionScore,
    counterpartyScore,
    transactionCodeScore,
    intent,
    arRevenueAmbiguity,
    apExpenseAmbiguity,
    directionConflict,
  } = input;

  // ── Weighted signals ────────────────────────────────────────────────────────
  const s1 = clamp01(historicalScore)       * COA_CONFIDENCE_WEIGHTS.HISTORICAL_APPROVED;
  const s2 = clamp01(intentKeywordScore)    * COA_CONFIDENCE_WEIGHTS.INTENT_COMPATIBILITY;
  const s3 = clamp01(keywordAliasScore)     * COA_CONFIDENCE_WEIGHTS.KEYWORD_ALIAS_MATCH;
  const s4 = categoryScore                  * COA_CONFIDENCE_WEIGHTS.CATEGORY_TYPE_COMPATIBILITY;
  const s5 = directionScore                 * COA_CONFIDENCE_WEIGHTS.DIRECTION_NORMAL_BALANCE;
  const s6 = clamp01(counterpartyScore)     * COA_CONFIDENCE_WEIGHTS.COUNTERPARTY_MAPPING;
  const s7 = clamp01(transactionCodeScore)  * COA_CONFIDENCE_WEIGHTS.TRANSACTION_CODE_REFERENCE;

  let raw = s1 + s2 + s3 + s4 + s5 + s6 + s7;

  // ── Penalties ───────────────────────────────────────────────────────────────
  if (historicalRejected)    raw += COA_CONFIDENCE_PENALTIES.HISTORICAL_REJECTED;
  if (intent === 'UNKNOWN')  raw += COA_CONFIDENCE_PENALTIES.UNKNOWN_INTENT;
  if (arRevenueAmbiguity)    raw += COA_CONFIDENCE_PENALTIES.AR_REVENUE_AMBIGUITY;
  if (apExpenseAmbiguity)    raw += COA_CONFIDENCE_PENALTIES.AP_EXPENSE_AMBIGUITY;
  // NOTE: DIRECTION_CONFLICT is intentionally NOT penalised in scoring.
  // Many valid accounting postings oppose the account's normal balance
  // (e.g. DEBIT to a liability to pay it off). The flag is still set for
  // informational purposes but must not reduce the score of good candidates.

  return Math.round(clamp01(raw) * 1000) / 1000;
}

// ─── Manual review evaluator ───────────────────────────────────────────────────

export interface ManualReviewInput {
  primaryConfidence: number | null;
  secondConfidence:  number | null;
  phase2RequiresReview: boolean;
  intent: TransactionIntent;
  conflictFlags: readonly string[];
  noActiveAccounts: boolean;
  crossCompanyAccount: boolean;
  onlyWeakKeywordEvidence: boolean;
  policy: {
    manualReviewThreshold?: number;
    ambiguityDelta?: number;
  };
}

/**
 * Evaluate whether the prediction requires manual review.
 * Deterministic — based only on the provided signals.
 */
export function evaluateManualReview(input: ManualReviewInput): {
  requiresManualReview: boolean;
  reasons: string[];
} {
  const {
    primaryConfidence,
    secondConfidence,
    phase2RequiresReview,
    intent,
    conflictFlags,
    noActiveAccounts,
    crossCompanyAccount,
    onlyWeakKeywordEvidence,
    policy,
  } = input;

  const reviewThreshold = policy.manualReviewThreshold ?? COA_REVIEW_THRESHOLDS.MANUAL_REVIEW_CONFIDENCE;
  const ambiguityDelta  = policy.ambiguityDelta        ?? COA_REVIEW_THRESHOLDS.AMBIGUITY_DELTA;

  const reasons: string[] = [];

  if (primaryConfidence === null) {
    reasons.push('No primary recommendation available');
  }

  if (primaryConfidence !== null && primaryConfidence < reviewThreshold) {
    reasons.push(`Confidence ${primaryConfidence.toFixed(3)} is below review threshold ${reviewThreshold}`);
  }

  if (
    primaryConfidence !== null &&
    secondConfidence  !== null &&
    Math.abs(primaryConfidence - secondConfidence) < ambiguityDelta
  ) {
    reasons.push(
      `Top two candidates are too close (delta = ${Math.abs(primaryConfidence - secondConfidence).toFixed(3)})`,
    );
  }

  if (phase2RequiresReview) {
    reasons.push('Phase 2 flagged this transaction for manual review');
  }

  if (isTaxIntent(intent)) {
    reasons.push('Tax classification requires human approval before COA posting');
  }

  if (intent === 'UNKNOWN') {
    reasons.push('Transaction intent could not be classified');
  }

  const materialFlags = [
    'DIRECTION_CONFLICT',
    'INTENT_ACCOUNT_CONFLICT',
    'AR_REVENUE_AMBIGUITY',
    'AP_EXPENSE_AMBIGUITY',
    'INTERNAL_TRANSFER_UNVERIFIED',
    'HISTORICAL_MAPPING_REJECTED',
    'MULTIPLE_CLOSE_CANDIDATES',
  ];

  for (const flag of conflictFlags) {
    if (materialFlags.includes(flag)) {
      reasons.push(`Conflict flag: ${flag}`);
    }
  }

  if (noActiveAccounts) {
    reasons.push('No active accounts available for this company');
  }

  if (crossCompanyAccount) {
    reasons.push('Candidate account belongs to a different company');
  }

  if (onlyWeakKeywordEvidence) {
    reasons.push('Only weak keyword evidence — no intent or historical match');
  }

  return {
    requiresManualReview: reasons.length > 0,
    reasons,
  };
}

// ─── Utility ───────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
