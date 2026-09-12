/**
 * AI Transaction Intelligence — Phase 3
 * COA Mapping Policy
 *
 * Evaluates policy rules against account candidates.
 * Returns the effective (merged) policy with safe defaults applied.
 * No DB calls, no Math.random(), deterministic.
 */

import type { TransactionIntent } from './transactionTypes.js';
import type { CoaAccountCandidate, CoaPredictionPolicy } from './coaPredictionTypes.js';
import { COA_REVIEW_THRESHOLDS } from './coaPredictionConfidence.js';

// ─── Default policy ────────────────────────────────────────────────────────────

/**
 * Safe defaults applied when no policy is supplied (or fields are absent).
 */
export const DEFAULT_COA_POLICY: Required<CoaPredictionPolicy> = {
  minimumConfidence:              COA_REVIEW_THRESHOLDS.MINIMUM_CONFIDENCE,
  manualReviewThreshold:          COA_REVIEW_THRESHOLDS.MANUAL_REVIEW_CONFIDENCE,
  ambiguityDelta:                 COA_REVIEW_THRESHOLDS.AMBIGUITY_DELTA,
  maxAlternatives:                COA_REVIEW_THRESHOLDS.MAX_ALTERNATIVES,
  blockedAccountCodes:            [],
  blockedAccountTypes:            [],
  allowedAccountTypesByIntent:    {},
  preferredAccountCodesByIntent:  {},
};

// ─── Policy merger ─────────────────────────────────────────────────────────────

/**
 * Merge a partial caller policy with safe defaults.
 * Never mutates the input.
 */
export function mergePolicy(partial?: CoaPredictionPolicy): Required<CoaPredictionPolicy> {
  if (!partial) return { ...DEFAULT_COA_POLICY };
  return {
    minimumConfidence:
      partial.minimumConfidence            ?? DEFAULT_COA_POLICY.minimumConfidence,
    manualReviewThreshold:
      partial.manualReviewThreshold        ?? DEFAULT_COA_POLICY.manualReviewThreshold,
    ambiguityDelta:
      partial.ambiguityDelta               ?? DEFAULT_COA_POLICY.ambiguityDelta,
    maxAlternatives:
      partial.maxAlternatives              ?? DEFAULT_COA_POLICY.maxAlternatives,
    blockedAccountCodes:
      partial.blockedAccountCodes          ?? DEFAULT_COA_POLICY.blockedAccountCodes,
    blockedAccountTypes:
      partial.blockedAccountTypes          ?? DEFAULT_COA_POLICY.blockedAccountTypes,
    allowedAccountTypesByIntent:
      partial.allowedAccountTypesByIntent  ?? DEFAULT_COA_POLICY.allowedAccountTypesByIntent,
    preferredAccountCodesByIntent:
      partial.preferredAccountCodesByIntent ?? DEFAULT_COA_POLICY.preferredAccountCodesByIntent,
  };
}

// ─── Policy evaluation ─────────────────────────────────────────────────────────

export interface PolicyEvalResult {
  /** Whether the account is blocked by policy. */
  blocked: boolean;
  /** Explanation if blocked. */
  blockedReason?: string;
  /** Score bonus from preferred account codes (+0.10). */
  preferenceBonus: number;
  /** Score penalty from mismatched allowed types (-0.10). */
  typeMismatchPenalty: number;
}

/**
 * Evaluate a single account against the effective policy for a given intent.
 * Returns block/allow decision and any score adjustments.
 */
export function evaluateAccountPolicy(
  account: CoaAccountCandidate,
  intent: TransactionIntent,
  policy: Required<CoaPredictionPolicy>,
): PolicyEvalResult {
  // ── Hard block: blocked codes ──────────────────────────────────────────────
  if (policy.blockedAccountCodes.includes(account.code)) {
    return {
      blocked: true,
      blockedReason: `Account code ${account.code} is explicitly blocked by policy`,
      preferenceBonus:      0,
      typeMismatchPenalty:  0,
    };
  }

  // ── Hard block: blocked types ──────────────────────────────────────────────
  if (account.accountType) {
    const typeLower = account.accountType.toLowerCase();
    if (policy.blockedAccountTypes.some((t) => typeLower.includes(t.toLowerCase()))) {
      return {
        blocked: true,
        blockedReason: `Account type "${account.accountType}" is blocked by policy`,
        preferenceBonus:      0,
        typeMismatchPenalty:  0,
      };
    }
  }

  // ── Soft: allowed types by intent ────────────────────────────────────────────
  let typeMismatchPenalty = 0;
  const allowedTypes = policy.allowedAccountTypesByIntent[intent];
  if (allowedTypes && allowedTypes.length > 0 && account.accountType) {
    const typeLower = account.accountType.toLowerCase();
    const allowed   = allowedTypes.some((t) => typeLower.includes(t.toLowerCase()));
    if (!allowed) {
      typeMismatchPenalty = -0.10;
    }
  }

  // ── Soft: preferred codes by intent ─────────────────────────────────────────
  let preferenceBonus = 0;
  const preferredCodes = policy.preferredAccountCodesByIntent[intent];
  if (preferredCodes && preferredCodes.includes(account.code)) {
    preferenceBonus = 0.10;
  }

  return {
    blocked:             false,
    preferenceBonus,
    typeMismatchPenalty,
  };
}

// ─── Account list pre-filter ──────────────────────────────────────────────────

export interface FilteredAccount {
  account:      CoaAccountCandidate;
  policyResult: PolicyEvalResult;
}

/**
 * Pre-filter a list of candidates:
 *  1. Remove hard safety rejections (company mismatch, inactive, non-postable).
 *  2. Remove policy-blocked accounts.
 *  3. Return the rest with their policy evaluation attached.
 *
 * Does NOT score — scoring happens in coaCandidateRanker.
 */
export function filterAccountCandidates(
  accounts: readonly CoaAccountCandidate[],
  companyId: string | number,
  intent: TransactionIntent,
  policy: Required<CoaPredictionPolicy>,
): FilteredAccount[] {
  const result: FilteredAccount[] = [];

  for (const account of accounts) {
    // Hard safety: company match
    if (String(account.companyId) !== String(companyId)) continue;
    // Hard safety: active
    if (!account.isActive) continue;
    // Hard safety: postable
    if (account.allowsManualPosting === false) continue;

    // Policy evaluation
    const policyResult = evaluateAccountPolicy(account, intent, policy);
    if (policyResult.blocked) continue;

    result.push({ account, policyResult });
  }

  return result;
}

// ─── Recommendation source resolver ──────────────────────────────────────────

import type { CoaRecommendationSource } from './coaPredictionTypes.js';

/**
 * Determine the primary recommendation source from the evidence signals.
 */
export function resolveRecommendationSource(params: {
  hasApprovedHistorical: boolean;
  hasIntentKeywordMatch: boolean;
  hasKeywordAliasMatch:  boolean;
  hasCounterpartyMatch:  boolean;
  hasPreferredPolicy:    boolean;
  noEvidence:            boolean;
}): CoaRecommendationSource {
  const {
    hasApprovedHistorical,
    hasIntentKeywordMatch,
    hasKeywordAliasMatch,
    hasCounterpartyMatch,
    hasPreferredPolicy,
    noEvidence,
  } = params;

  if (noEvidence) return 'NONE';

  const sources: CoaRecommendationSource[] = [];
  if (hasApprovedHistorical) sources.push('HISTORICAL_MAPPING');
  if (hasIntentKeywordMatch)  sources.push('INTENT_MAPPING');
  if (hasKeywordAliasMatch)   sources.push('KEYWORD_MAPPING');
  if (hasCounterpartyMatch)   sources.push('COUNTERPARTY_MAPPING');
  if (hasPreferredPolicy)     sources.push('ACCOUNT_POLICY');

  if (sources.length === 0) return 'NONE';
  if (sources.length === 1) return sources[0];
  return 'COMBINED';
}
