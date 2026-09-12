/**
 * AI Transaction Intelligence — Phase 3
 * COA Prediction Engine
 *
 * Public API:
 *   predictCoa(input, deps?): Promise<CoaPredictionResult>
 *   predictCoaBatch(inputs, deps?): Promise<CoaPredictionResult[]>
 *
 * Contract:
 *  - Additive: Phase 1 and Phase 2 APIs unchanged.
 *  - No DB queries — use CoaPredictionDependencies for external lookups.
 *  - No Math.random(). Deterministic.
 *  - No mutation of input objects.
 *  - Batch preserves input order.
 *  - Engine can run Phase 1 + Phase 2 internally if not supplied.
 *  - Engine NEVER posts journal entries or auto-approves transactions.
 */

import { analyzeTransactionDescription } from './transactionUnderstanding.js';
import { classifyTransactionIntent } from './intentClassifier.js';
import type { TransactionAnalysisResult } from './transactionTypes.js';
import type { IntentClassificationResult } from './intentClassificationTypes.js';
import type {
  CoaPredictionInput,
  CoaPredictionResult,
  CoaPredictionDependencies,
  CoaPredictionAlternative,
  CoaPredictionEvidence,
  _RankedCandidate,
} from './coaPredictionTypes.js';
import { mergePolicy, filterAccountCandidates, resolveRecommendationSource } from './coaMappingPolicy.js';
import { rankCoaCandidates } from './coaCandidateRanker.js';
import { evaluateManualReview } from './coaPredictionConfidence.js';
import { isArRevenueAmbiguity, isApExpenseAmbiguity } from './coaPredictionRules.js';
import { isTaxIntent } from './transactionTypes.js';

// ─── predictCoa ───────────────────────────────────────────────────────────────

/**
 * Predict the best COA account for a single transaction.
 *
 * Steps:
 *  1. Run Phase 1 (or reuse supplied result).
 *  2. Run Phase 2 (or reuse supplied result).
 *  3. Filter available accounts (safety + policy).
 *  4. Gather historical mappings.
 *  5. Gather intent hints.
 *  6. Rank candidates.
 *  7. Evaluate manual review conditions.
 *  8. Assemble result.
 */
export async function predictCoa(
  input: CoaPredictionInput,
  deps?: CoaPredictionDependencies,
): Promise<CoaPredictionResult> {
  // ── 0. Freeze input reference (no mutation) ────────────────────────────────
  const tx      = input.transaction;
  const compId  = input.companyId;

  // ── 1. Phase 1: Transaction Understanding ─────────────────────────────────
  const phase1: TransactionAnalysisResult =
    input.phase1Analysis ?? analyzeTransactionDescription(tx.description);

  // ── 2. Phase 2: Intent Classification ─────────────────────────────────────
  const phase2: IntentClassificationResult = input.phase2Classification ??
    await classifyTransactionIntent(
      {
        description:        tx.description,
        direction:          tx.direction,
        amount:             tx.amount,
        transactionDate:    tx.transactionDate,
        bankAccountId:      tx.bankAccountId,
        bankName:           tx.bankName,
        counterpartyName:   tx.counterpartyName,
        counterpartyAccount: tx.counterpartyAccount,
        referenceNumber:    tx.referenceNumber,
        transactionCode:    tx.transactionCode,
        currency:           tx.currency,
      },
      /* deps */ {},
    );

  const intent    = phase2.primaryIntent;
  const normDesc  = phase2.normalizedDescription;

  // ── 3. Effective policy ────────────────────────────────────────────────────
  const policy = mergePolicy(input.policy);

  // ── 4. Historical mappings ─────────────────────────────────────────────────
  let historicalMappings = input.historicalMappings ?? [];
  if (historicalMappings.length === 0 && deps?.getHistoricalMappings) {
    historicalMappings = await deps.getHistoricalMappings(input);
  }

  // ── 5. Intent account hints ────────────────────────────────────────────────
  let intentHints: string[] = [];
  if (deps?.getIntentAccountHints) {
    intentHints = await deps.getIntentAccountHints(intent, compId);
  }

  // ── 6. Filter available accounts ──────────────────────────────────────────
  let filteredAccounts = filterAccountCandidates(
    input.availableAccounts,
    compId,
    intent,
    policy,
  );

  // Optional external account validator
  if (deps?.validateAccount) {
    const validatedFiltered = [];
    for (const fa of filteredAccounts) {
      const result = await deps.validateAccount(fa.account, input);
      if (result.allowed) {
        validatedFiltered.push(fa);
      }
    }
    filteredAccounts = validatedFiltered;
  }

  const noActiveAccounts = filteredAccounts.length === 0;

  // ── 7. Rank candidates ─────────────────────────────────────────────────────
  const ranked = rankCoaCandidates({
    filteredAccounts,
    input,
    phase2,
    historicalMappings,
    intentHints,
    policy,
  });

  // ── 8. Determine primary + alternatives ───────────────────────────────────
  const [primary, ...rest] = ranked;

  const primaryRecommendation = primary
    ? {
        coaId:      primary.account.id,
        coaCode:    primary.account.code,
        coaName:    primary.account.name,
        confidence: primary.confidence,
        score:      primary.score,
      }
    : null;

  const alternatives: CoaPredictionAlternative[] = rest
    .slice(0, policy.maxAlternatives)
    .map((c) => ({
      coaId:      c.account.id,
      coaCode:    c.account.code,
      coaName:    c.account.name,
      confidence: c.confidence,
      score:      c.score,
      reason:     c.reason,
    }));

  // ── 9. Collect all evidence and flags ─────────────────────────────────────
  const allEvidence: CoaPredictionEvidence[] = primary?.evidence ?? [];
  const conflictFlags: string[] = [...(primary?.conflictFlags ?? [])];

  // Cross-company accounts filtered out → add flag if input accounts had them
  const hasCrossCompany = input.availableAccounts.some(
    (a) => String(a.companyId) !== String(compId),
  );
  if (hasCrossCompany) conflictFlags.push('CROSS_COMPANY_ACCOUNT');

  // AR/AP ambiguity: detect even when ambiguous account scored below minimumConfidence.
  // Scan safe (company-match + active + postable) input accounts directly so these
  // flags are always raised when the account type contradicts the intent.
  const safeInputAccounts = input.availableAccounts.filter(
    (a) =>
      String(a.companyId) === String(compId) &&
      a.isActive &&
      a.allowsManualPosting !== false,
  );
  if (!conflictFlags.includes('AR_REVENUE_AMBIGUITY') &&
      safeInputAccounts.some((a) => isArRevenueAmbiguity(intent, a))) {
    conflictFlags.push('AR_REVENUE_AMBIGUITY');
  }
  if (!conflictFlags.includes('AP_EXPENSE_AMBIGUITY') &&
      safeInputAccounts.some((a) => isApExpenseAmbiguity(intent, a))) {
    conflictFlags.push('AP_EXPENSE_AMBIGUITY');
  }

  // Unknown intent flag
  if (intent === 'UNKNOWN') conflictFlags.push('UNKNOWN_INTENT');
  if (isTaxIntent(intent)) conflictFlags.push('TAX_REVIEW_REQUIRED');

  // Multiple close candidates flag
  if (
    primary &&
    rest.length > 0 &&
    Math.abs(primary.confidence - rest[0].confidence) < policy.ambiguityDelta
  ) {
    conflictFlags.push('MULTIPLE_CLOSE_CANDIDATES');
  }

  // INTERNAL_TRANSFER unverified (no confirmed internal account evidence)
  if (intent === 'INTERNAL_TRANSFER') {
    const hasInternalEvidence = allEvidence.some(
      (e) => e.type === 'HISTORICAL_APPROVED' || e.type === 'COUNTERPARTY',
    );
    if (!hasInternalEvidence) {
      conflictFlags.push('INTERNAL_TRANSFER_UNVERIFIED');
    }
  }

  // Deduplicate conflict flags
  const uniqueFlags = [...new Set(conflictFlags)];

  // ── 10. Manual review evaluation ──────────────────────────────────────────
  const hasApprovedHistorical = allEvidence.some((e) => e.type === 'HISTORICAL_APPROVED');
  const hasIntentKeywordMatch  = allEvidence.some((e) => e.type === 'INTENT_KEYWORD');
  const hasKeywordAliasMatch   = allEvidence.some((e) => e.type === 'KEYWORD_ALIAS');
  const hasCounterpartyMatch   = allEvidence.some((e) => e.type === 'COUNTERPARTY');
  const hasPreferredPolicy     = allEvidence.some((e) => e.type === 'POLICY_PREFERRED');
  const onlyWeakEvidence       = !hasApprovedHistorical && !hasIntentKeywordMatch && !hasKeywordAliasMatch;

  const { requiresManualReview, reasons: reviewReasons } = evaluateManualReview({
    primaryConfidence:       primaryRecommendation?.confidence ?? null,
    secondConfidence:        rest[0]?.confidence ?? null,
    phase2RequiresReview:    phase2.requiresManualReview,
    intent,
    conflictFlags:           uniqueFlags,
    noActiveAccounts,
    crossCompanyAccount:     hasCrossCompany,
    onlyWeakKeywordEvidence: onlyWeakEvidence,
    policy,
  });

  // ── 11. Build reason list ──────────────────────────────────────────────────
  const reason: string[] = [
    `Phase 2 intent: ${intent} (confidence: ${phase2.confidence.toFixed(3)})`,
    ...(primary?.reason ?? []),
    ...(primaryRecommendation === null ? ['No eligible account candidates found'] : []),
    ...reviewReasons.map((r) => `Manual review: ${r}`),
  ];

  // ── 12. Recommendation source ──────────────────────────────────────────────
  const recommendationSource = resolveRecommendationSource({
    hasApprovedHistorical,
    hasIntentKeywordMatch,
    hasKeywordAliasMatch,
    hasCounterpartyMatch,
    hasPreferredPolicy,
    noEvidence: primaryRecommendation === null,
  });

  // ── 13. Assemble final result ──────────────────────────────────────────────
  return {
    companyId:             compId,
    primaryRecommendation,
    alternatives,
    intent,
    normalizedDescription: normDesc,
    evidence:              allEvidence,
    reason,
    conflictFlags:         uniqueFlags,
    requiresManualReview,
    recommendationSource,
    phase1Analysis:        phase1,
    phase2Classification:  phase2,
  };
}

// ─── predictCoaBatch ──────────────────────────────────────────────────────────

/**
 * Predict COA accounts for a batch of transactions.
 *
 * Contract:
 *  - Output array has the same length and order as input array.
 *  - Each item is independently processed (no cross-item mutation).
 *  - Async deps are awaited per item (not parallelized — keeps order deterministic).
 *  - No side effects.
 */
export async function predictCoaBatch(
  inputs: CoaPredictionInput[],
  deps?: CoaPredictionDependencies,
): Promise<CoaPredictionResult[]> {
  const results: CoaPredictionResult[] = [];
  for (const input of inputs) {
    results.push(await predictCoa(input, deps));
  }
  return results;
}
