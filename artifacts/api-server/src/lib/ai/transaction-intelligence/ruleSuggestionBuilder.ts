/**
 * AI Transaction Intelligence — Phase 5
 * Rule Suggestion Builder
 *
 * Derives rule and dictionary suggestions from feedback patterns.
 * The engine never applies these — they are read-only recommendations.
 * Pure function — no DB, no side effects.
 */

import type {
  FeedbackRecord,
  SuggestedRule,
  SuggestedDictionaryTerm,
  FeedbackSummary,
  FeedbackReliability,
} from './learningTypes.js';

import type { TransactionIntent } from './transactionTypes.js';

// ─── Thresholds ────────────────────────────────────────────────────────────────

/** Minimum feedback count to suggest a new rule. */
const MIN_RECORDS_FOR_RULE = 3;

/** Minimum approval/change consistency to suggest a rule. */
const MIN_CONSISTENCY_FOR_RULE = 0.7;

/** Minimum feedback count to suggest a dictionary term. */
const MIN_RECORDS_FOR_DICT = 2;

/** Minimum reliability score to produce any suggestion. */
const MIN_RELIABILITY_FOR_SUGGESTION = 0.30;

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Extract candidate keywords from a normalised description. */
function extractKeywords(normalizedDescription: string): string[] {
  // Split on common separators, filter short tokens and numbers
  return normalizedDescription
    .toLowerCase()
    .split(/[\s\-_/.,;:|]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !/^\d+$/.test(t));
}

/** Find tokens that appear in most records (>= threshold fraction). */
function dominantTokens(
  records: FeedbackRecord[],
  threshold = 0.6,
): string[] {
  const descs = records
    .map(r => r.normalizedDescription)
    .filter((d): d is string => !!d);

  if (descs.length === 0) return [];

  const tokenCounts = new Map<string, number>();
  for (const desc of descs) {
    const unique = new Set(extractKeywords(desc));
    for (const t of unique) {
      tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
    }
  }

  return [...tokenCounts.entries()]
    .filter(([, count]) => count / descs.length >= threshold)
    .map(([token]) => token);
}

// ─── Rule Suggestion Builder ───────────────────────────────────────────────────

/**
 * Build rule suggestions from a body of feedback.
 *
 * Rules are only suggested when there is enough consistent evidence.
 * All suggestions require human approval — this is enforced structurally.
 */
export function buildRuleSuggestions(
  allRecords: FeedbackRecord[],
  summary: FeedbackSummary,
  reliability: FeedbackReliability,
  currentIntent: TransactionIntent,
): SuggestedRule[] {
  const rules: SuggestedRule[] = [];

  if (
    reliability.score < MIN_RELIABILITY_FOR_SUGGESTION ||
    allRecords.length < MIN_RECORDS_FOR_RULE
  ) {
    return rules;
  }

  // ── Counterparty mapping suggestion ────────────────────────────────────────
  // If all records share the same counterparty and have consistent decisions
  const counterpartyNames = allRecords
    .map(r => r.counterpartyName?.trim())
    .filter((n): n is string => !!n);

  if (counterpartyNames.length >= MIN_RECORDS_FOR_RULE) {
    const uniqueNames = new Set(counterpartyNames);
    if (uniqueNames.size === 1) {
      const name = [...uniqueNames][0]!;
      const targetCoa = summary.dominantCorrectedCoaCode ??
        allRecords.find(r => r.aiRecommendedCoaCode)?.aiRecommendedCoaCode;

      rules.push({
        type: 'COUNTERPARTY_MAPPING',
        label: `Map counterparty "${name}" to intent ${currentIntent}`,
        description: `${allRecords.length} feedback records all involve counterparty "${name}". Mapping this counterparty to ${currentIntent} would improve classification.`,
        value: name,
        intent: currentIntent,
        coaCode: targetCoa,
        confidence: Math.min(0.95, reliability.score * 1.1),
        supportingCount: counterpartyNames.length,
        requiresHumanApproval: true,
      });
    }
  }

  // ── Historical mapping suggestion ──────────────────────────────────────────
  // If most records have the same normalized description and dominant COA
  if (
    summary.dominantCorrectedCoaCode &&
    summary.changeRate >= MIN_CONSISTENCY_FOR_RULE &&
    allRecords.length >= MIN_RECORDS_FOR_RULE
  ) {
    const descriptions = allRecords.map(r => r.normalizedDescription).filter(Boolean);
    const uniqueDescs = new Set(descriptions);

    if (uniqueDescs.size === 1 && descriptions.length >= MIN_RECORDS_FOR_RULE) {
      rules.push({
        type: 'HISTORICAL_MAPPING',
        label: `Historical mapping: "${descriptions[0]}" → ${summary.dominantCorrectedCoaCode}`,
        description: `Reviewers consistently corrected this description to COA ${summary.dominantCorrectedCoaCode} (${summary.changedCoaCount} times). Adding a historical mapping would allow the AI to learn this preference.`,
        value: descriptions[0]!,
        intent: currentIntent,
        coaCode: summary.dominantCorrectedCoaCode,
        confidence: Math.min(0.95, summary.changeRate * reliability.score),
        supportingCount: summary.changedCoaCount,
        requiresHumanApproval: true,
      });
    }
  }

  // ── Threshold candidate suggestion ─────────────────────────────────────────
  // If many records require manual review despite high AI confidence
  const highConfidenceManualReview = allRecords.filter(
    r =>
      (r.aiConfidenceAtReview ?? 0) >= 0.8 &&
      (r.decision === 'CHANGED_COA' || r.decision === 'REJECTED'),
  );

  if (highConfidenceManualReview.length >= MIN_RECORDS_FOR_RULE) {
    const avgConfidence =
      highConfidenceManualReview.reduce((acc, r) => acc + (r.aiConfidenceAtReview ?? 0.8), 0) /
      highConfidenceManualReview.length;

    rules.push({
      type: 'THRESHOLD_CANDIDATE',
      label: `Lower confidence threshold for intent ${currentIntent}`,
      description: `${highConfidenceManualReview.length} transactions with AI confidence ≥ 0.80 (avg: ${avgConfidence.toFixed(2)}) were corrected by reviewers. Consider lowering the auto-accept threshold for this intent.`,
      value: (avgConfidence * 0.9).toFixed(2),
      intent: currentIntent,
      confidence: Math.min(0.9, highConfidenceManualReview.length / allRecords.length),
      supportingCount: highConfidenceManualReview.length,
      requiresHumanApproval: true,
    });
  }

  return rules;
}

// ─── Dictionary Term Suggestion Builder ───────────────────────────────────────

/**
 * Build dictionary term suggestions from feedback patterns.
 *
 * Terms are derived from tokens that consistently appear in descriptions
 * where reviewers made clear, consistent decisions.
 */
export function buildDictionaryTermSuggestions(
  allRecords: FeedbackRecord[],
  summary: FeedbackSummary,
  reliability: FeedbackReliability,
  currentIntent: TransactionIntent,
): SuggestedDictionaryTerm[] {
  const terms: SuggestedDictionaryTerm[] = [];

  if (
    reliability.score < MIN_RELIABILITY_FOR_SUGGESTION ||
    allRecords.length < MIN_RECORDS_FOR_DICT
  ) {
    return terms;
  }

  // Only suggest dictionary terms when decisions are consistent
  const consistentRecords = allRecords.filter(
    r => r.decision === 'APPROVED' || r.decision === 'CHANGED_COA',
  );

  if (consistentRecords.length < MIN_RECORDS_FOR_DICT) return terms;

  // Find tokens that dominate in consistent-decision records
  const tokens = dominantTokens(consistentRecords, 0.65);

  // Filter out very common stop words
  const stopWords = new Set([
    'the', 'dan', 'ke', 'dari', 'via', 'untuk', 'dengan', 'ref', 'no', 'nomor',
    'tanggal', 'tgl', 'bulan', 'tahun', 'transfer', 'bayar', 'pembayaran',
  ]);

  const candidateTokens = tokens.filter(t => !stopWords.has(t) && t.length >= 4);

  for (const token of candidateTokens.slice(0, 5)) {
    // Check if token already maps to an intent (simplified — no live dictionary lookup)
    const supportingCount = consistentRecords.filter(r =>
      (r.normalizedDescription ?? '').includes(token),
    ).length;

    if (supportingCount < MIN_RECORDS_FOR_DICT) continue;

    terms.push({
      term: token,
      intent: currentIntent,
      weight: Math.min(0.8, 0.3 + supportingCount / consistentRecords.length * 0.5),
      exactMatch: false,
      supportingCount,
      confidence: Math.min(0.90, reliability.score * (supportingCount / consistentRecords.length)),
      requiresHumanApproval: true,
    });
  }

  // Also suggest alias if reviewers consistently use a corrected COA for one specific term
  if (summary.dominantCorrectedCoaCode && summary.changeRate >= 0.8) {
    const changedRecords = allRecords.filter(r => r.decision === 'CHANGED_COA');
    const changedTokens = dominantTokens(changedRecords, 0.75);

    for (const token of changedTokens.filter(t => !stopWords.has(t) && t.length >= 4).slice(0, 2)) {
      if (!terms.some(t => t.term === token)) {
        terms.push({
          term: token,
          intent: currentIntent,
          weight: 0.6,
          exactMatch: false,
          supportingCount: changedRecords.length,
          confidence: Math.min(0.85, reliability.score),
          requiresHumanApproval: true,
        });
      }
    }
  }

  return terms;
}
