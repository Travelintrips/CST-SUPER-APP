/**
 * AI Transaction Intelligence — Phase 3
 * COA Candidate Ranker
 *
 * Scores and ranks filtered account candidates using all available evidence.
 * Returns candidates sorted by confidence descending, duplicates removed.
 * No DB calls, no Math.random(), deterministic.
 */

import type { TransactionIntent } from './transactionTypes.js';
import type { IntentClassificationResult } from './intentClassificationTypes.js';
import type {
  CoaAccountCandidate,
  CoaPredictionInput,
  CoaPredictionPolicy,
  HistoricalCoaMapping,
  CoaPredictionEvidence,
  _RankedCandidate,
} from './coaPredictionTypes.js';
import type { FilteredAccount } from './coaMappingPolicy.js';
import {
  INTENT_COA_KEYWORDS,
  scoreAccountKeywords,
  scoreAccountCategory,
  scoreHistoricalMapping,
  scoreCounterparty,
  scoreTransactionCode,
  directionNormalBalanceDelta,
  isArRevenueAmbiguity,
  isApExpenseAmbiguity,
} from './coaPredictionRules.js';
import {
  computeCoaScore,
  COA_CONFIDENCE_WEIGHTS,
} from './coaPredictionConfidence.js';

// ─── Ranker input ──────────────────────────────────────────────────────────────

export interface RankCoaCandidatesInput {
  filteredAccounts:   FilteredAccount[];
  input:              CoaPredictionInput;
  phase2:             IntentClassificationResult;
  historicalMappings: HistoricalCoaMapping[];
  intentHints:        string[];
  policy:             Required<CoaPredictionPolicy>;
}

// ─── Main ranker ───────────────────────────────────────────────────────────────

/**
 * Rank a pre-filtered list of account candidates by composite confidence.
 *
 * Steps:
 *  1. Score each candidate against all evidence signals.
 *  2. Apply policy bonuses/penalties.
 *  3. Sort descending by confidence.
 *  4. Remove duplicates (by account id).
 *  5. Filter out scores below minimumConfidence.
 *  6. Return full _RankedCandidate[] (caller limits to maxAlternatives+1).
 */
export function rankCoaCandidates(params: RankCoaCandidatesInput): _RankedCandidate[] {
  const { filteredAccounts, input, phase2, historicalMappings, intentHints, policy } = params;

  const intent    = phase2.primaryIntent;
  const direction = (input.transaction.direction ?? 'UNKNOWN') as 'DEBIT' | 'CREDIT' | 'UNKNOWN';
  const normDesc  = phase2.normalizedDescription;

  // Merge intent keywords with caller-supplied hints
  const baseKeywords   = INTENT_COA_KEYWORDS[intent] ?? [];
  const mergedKeywords = [...new Set([...baseKeywords, ...intentHints.map((h) => h.toLowerCase())])];

  const seen   = new Set<string>();
  const ranked: _RankedCandidate[] = [];

  for (const { account, policyResult } of filteredAccounts) {
    // Deduplicate by company + code
    const key = `${String(account.companyId)}::${account.code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const evidence: CoaPredictionEvidence[] = [];
    const reason:   string[]               = [];
    const flags:    string[]               = [];

    // ── 1. Historical mapping ─────────────────────────────────────────────────
    const hist = scoreHistoricalMapping({
      accountCode:           account.code,
      intent,
      normalizedDescription: normDesc,
      counterpartyName:      input.transaction.counterpartyName,
      counterpartyAccount:   input.transaction.counterpartyAccount,
      transactionCode:       input.transaction.transactionCode,
      companyId:             input.companyId,
      mappings:              historicalMappings,
    });

    if (hist.hasApprovedMatch) {
      evidence.push({
        type:    'HISTORICAL_APPROVED',
        value:   `Account ${account.code} has approved historical mappings`,
        weight:  COA_CONFIDENCE_WEIGHTS.HISTORICAL_APPROVED,
        coaCode: account.code,
      });
      reason.push(`Approved historical mapping exists for account ${account.code}`);
    }
    if (hist.hasRejectedMatch) {
      evidence.push({
        type:    'HISTORICAL_REJECTED',
        value:   `Account ${account.code} has rejection history`,
        weight:  0,
        coaCode: account.code,
      });
      flags.push('HISTORICAL_MAPPING_REJECTED');
      reason.push(`Historical mapping for ${account.code} was previously rejected`);
    }

    // ── 2. Intent keyword compatibility ───────────────────────────────────────
    const intentKwScore = mergedKeywords.length > 0
      ? scoreAccountKeywords(account, mergedKeywords)
      : 0;

    if (intentKwScore > 0) {
      evidence.push({
        type:    'INTENT_KEYWORD',
        value:   `Account "${account.name}" matches intent keywords for ${intent}`,
        weight:  COA_CONFIDENCE_WEIGHTS.INTENT_COMPATIBILITY,
        coaCode: account.code,
      });
      reason.push(`Account name/keywords match intent ${intent}`);
    }

    // ── 3. Account keyword/alias raw match (can overlap with intent) ──────────
    const kwAliasScore = kwAliasOnly(account, mergedKeywords);
    if (kwAliasScore > 0) {
      evidence.push({
        type:    'KEYWORD_ALIAS',
        value:   `Account "${account.name}" keyword/alias match`,
        weight:  COA_CONFIDENCE_WEIGHTS.KEYWORD_ALIAS_MATCH,
        coaCode: account.code,
      });
    }

    // ── 4. Category/type compatibility ────────────────────────────────────────
    const catScore = scoreAccountCategory(account, intent);
    if (catScore > 0) {
      evidence.push({
        type:    'ACCOUNT_TYPE',
        value:   `Account type "${account.accountType}" is preferred for ${intent}`,
        weight:  COA_CONFIDENCE_WEIGHTS.CATEGORY_TYPE_COMPATIBILITY,
        coaCode: account.code,
      });
      reason.push(`Account type matches expected type for ${intent}`);
    } else if (catScore < 0) {
      flags.push('INTENT_ACCOUNT_CONFLICT');
      reason.push(`Account type "${account.accountType}" is not typical for ${intent}`);
    }

    // ── 5. Direction / normal balance ─────────────────────────────────────────
    const dirDelta    = directionNormalBalanceDelta(direction, account.normalBalance);
    const dirConflict = dirDelta < 0;
    if (dirConflict) {
      flags.push('DIRECTION_CONFLICT');
      evidence.push({
        type:    'DIRECTION',
        value:   `Transaction direction ${direction} conflicts with account normal balance ${account.normalBalance}`,
        weight:  0,
        coaCode: account.code,
      });
      reason.push(`Direction ${direction} conflicts with normal balance ${account.normalBalance}`);
    } else if (dirDelta > 0) {
      evidence.push({
        type:    'DIRECTION',
        value:   `Transaction direction ${direction} compatible with account normal balance`,
        weight:  COA_CONFIDENCE_WEIGHTS.DIRECTION_NORMAL_BALANCE,
        coaCode: account.code,
      });
    }

    // ── 6. Counterparty ────────────────────────────────────────────────────────
    const cpScore = scoreCounterparty(account, input.transaction.counterpartyName);
    if (cpScore > 0) {
      evidence.push({
        type:    'COUNTERPARTY',
        value:   `Counterparty "${input.transaction.counterpartyName}" found in account metadata`,
        weight:  COA_CONFIDENCE_WEIGHTS.COUNTERPARTY_MAPPING,
        coaCode: account.code,
      });
      reason.push(`Counterparty name suggests account ${account.code}`);
    }

    // ── 7. Transaction code / reference ───────────────────────────────────────
    const tcScore = scoreTransactionCode(account, input.transaction.transactionCode, mergedKeywords);
    if (tcScore > 0) {
      evidence.push({
        type:    'TRANSACTION_CODE',
        value:   `Transaction code "${input.transaction.transactionCode}" matched`,
        weight:  COA_CONFIDENCE_WEIGHTS.TRANSACTION_CODE_REFERENCE,
        coaCode: account.code,
      });
      reason.push(`Transaction code ${input.transaction.transactionCode} supports account ${account.code}`);
    }

    // ── 8. Ambiguity checks ────────────────────────────────────────────────────
    const arAmb = isArRevenueAmbiguity(intent, account);
    const apAmb = isApExpenseAmbiguity(intent, account);
    if (arAmb) {
      flags.push('AR_REVENUE_AMBIGUITY');
      reason.push('CUSTOMER_PAYMENT mapped to revenue account — prefer AR/receivable');
    }
    if (apAmb) {
      flags.push('AP_EXPENSE_AMBIGUITY');
      reason.push('VENDOR_PAYMENT mapped to expense account — prefer AP/payable');
    }

    // ── 9. Policy adjustment ───────────────────────────────────────────────────
    const policyBonus = policyResult.preferenceBonus + policyResult.typeMismatchPenalty;
    if (policyResult.preferenceBonus > 0) {
      evidence.push({
        type:    'POLICY_PREFERRED',
        value:   `Account ${account.code} is preferred by policy for intent ${intent}`,
        weight:  policyResult.preferenceBonus,
        coaCode: account.code,
      });
      reason.push(`Account ${account.code} is policy-preferred for ${intent}`);
    }

    // ── 9b. Counterparty dedicated-account bonus ────────────────────────────
    // When a specific counterparty name appears directly in an account's
    // keywords or aliases (dedicated supplier/customer account pattern),
    // apply a significant bonus on top of the weighted score.  This is
    // intentionally outside the weight budget so it can decisively rank a
    // dedicated account above a generic one without distorting other signals.
    const counterpartyDedicatedBonus = cpScore > 0 ? 0.20 : 0;

    // ── 10. Composite score ────────────────────────────────────────────────────
    const rawScore = computeCoaScore({
      historicalScore:       Math.max(0, hist.score),
      historicalRejected:    hist.hasRejectedMatch,
      intentKeywordScore:    intentKwScore,
      keywordAliasScore:     kwAliasScore,
      categoryScore:         catScore,
      directionScore:        dirDelta,
      counterpartyScore:     cpScore,
      transactionCodeScore:  tcScore,
      intent,
      arRevenueAmbiguity:    arAmb,
      apExpenseAmbiguity:    apAmb,
      directionConflict:     dirConflict,
    }) + policyBonus + counterpartyDedicatedBonus;

    const confidence = Math.round(Math.max(0, Math.min(1, rawScore)) * 1000) / 1000;

    // Filter below minimum
    if (confidence < policy.minimumConfidence) continue;

    // Insufficient evidence guard
    if (evidence.filter((e) => e.weight > 0).length === 0 && confidence < 0.50) {
      flags.push('INSUFFICIENT_EVIDENCE');
    }

    ranked.push({ account, score: rawScore, confidence, evidence, reason, conflictFlags: flags });
  }

  // Sort by confidence descending, then code ascending (deterministic tie-break)
  ranked.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.account.code.localeCompare(b.account.code);
  });

  return ranked;
}

// ─── Internal: keyword/alias-only score (pure account match) ─────────────────

/**
 * Score account.keywords[] and account.aliases[] directly against mergedKeywords.
 * Distinct from intentKwScore which also checks account.name.
 */
function kwAliasOnly(account: CoaAccountCandidate, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const fields = [
    ...(account.keywords ?? []).map((k) => k.toLowerCase()),
    ...(account.aliases  ?? []).map((a) => a.toLowerCase()),
  ];
  if (fields.length === 0) return 0;
  let hits = 0;
  for (const kw of keywords) {
    if (fields.some((f) => f.includes(kw))) hits++;
  }
  return Math.min(hits / keywords.length, 1.0);
}
