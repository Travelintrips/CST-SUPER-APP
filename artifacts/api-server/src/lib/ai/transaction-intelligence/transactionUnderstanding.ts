/**
 * AI Transaction Intelligence — Phase 1
 * Transaction Understanding Engine
 *
 * Public API:
 *   analyzeTransactionDescription(description: string): TransactionAnalysisResult
 *
 * Contract:
 *  - Pure function: same input → identical output.
 *  - No DB calls. No network. No Math.random().
 *  - Works offline (test-safe).
 *  - Empty / blank description → UNKNOWN, low confidence, requiresManualReview = true.
 */

import type { TransactionAnalysisResult, IntentCandidate, KeywordMatch, TaxSubtype } from './transactionTypes.js';
import { isLegacyTaxDescription, isTaxIntent } from './transactionTypes.js';
import { CLASSIFIABLE_INTENTS, TRANSACTION_DICTIONARY } from './transactionDictionary.js';
import { assembleResult } from './transactionConfidence.js';

// ─── Text normalization ───────────────────────────────────────────────────────

/**
 * Normalize a raw description:
 *  1. Lowercase
 *  2. Replace punctuation (except space) with space
 *  3. Collapse multiple spaces
 *  4. Trim
 */
export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Matching ─────────────────────────────────────────────────────────────────

/**
 * Check whether a multi-word term appears as a contiguous subsequence in the
 * normalized description. Returns the matched substring or null.
 *
 * We use substring search (indexOf) rather than word-boundary regex so that
 * partial-word matches like "adm" inside "adm bln" still work.
 */
function matchTerm(normalized: string, term: string): string | null {
  // Abbreviations and codes must be whole tokens. This prevents "tax" from
  // matching inside unrelated words and "pph23x" from being treated as PPh23.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const idx = normalized.search(new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`));
  return idx >= 0 ? term : null;
}

export function inferTaxSubtype(normalizedDescription: string): TaxSubtype | undefined {
  const d = normalizedDescription;
  if (/\bppn\s+masukan\b|\bvat\s+input\b|\bfaktur\s+pajak\s+masukan\b/.test(d)) return 'VAT_INPUT';
  if (/\bppn\s+keluaran\b|\bvat\s+output\b|\bfaktur\s+pajak\s+keluaran\b/.test(d)) return 'VAT_OUTPUT';
  if (/\bppn\b|\bvat\b|\bpajak\s+pertambahan\s+nilai\b/.test(d)) return 'VAT_UNSPECIFIED';
  if (/\bpph\s*21\b|\bpasal\s+21\b/.test(d)) return 'PPh21';
  if (/\bpph\s*22\b|\bpasal\s+22\b/.test(d)) return 'PPh22';
  if (/\bpph\s*23\b|\bpasal\s+23\b/.test(d)) return 'PPh23';
  if (/\bpph\s*25\b|\bpasal\s+25\b/.test(d)) return 'PPh25';
  if (/\bpph\s*26\b|\bpasal\s+26\b/.test(d)) return 'PPh26';
  if (/\bpph\s+final\b|\bpasal\s+4\s+ayat\s+2\b/.test(d)) return 'PPh_FINAL';
  if (/\bpph\b|\bpajak\s+penghasilan\b/.test(d)) return 'INCOME_TAX_UNSPECIFIED';
  if (/\bbea\s+materai\b|\bbea\s+meterai\b|\be\s*materai\b|\be\s*meterai\b|\bmaterai\b|\bmeterai\b/.test(d)) return 'STAMP_DUTY';
  if (/\bbea\s+masuk\b|\bimport\s+duty\b|\bpajak\s+impor\b|\bimport\s+tax\b/.test(d)) return 'IMPORT_DUTY';
  if (/\bcustoms\b|\bkepabeanan\b|\bbea\s+cukai\b/.test(d)) return 'CUSTOMS_DUTY';
  if (/\bcukai\b|\bexcise\b/.test(d)) return 'EXCISE';
  if (/\bdenda\s+pajak\b|\bsanksi\s+pajak\b|\btax\s+penalty\b|\btax\s+fine\b/.test(d)) return 'TAX_PENALTY';
  if (/\bbunga\s+pajak\b|\btax\s+interest\b/.test(d)) return 'TAX_INTEREST';
  if (/\brestitusi\s+pajak\b|\bpengembalian\s+pajak\b|\btax\s+refund\b|\brefund\s+pajak\b/.test(d)) return 'TAX_REFUND';
  if (/\bpajak\s+kendaraan\b|\bpkb\b|\bsamsat\b/.test(d)) return 'VEHICLE_TAX';
  if (/\bpajak\s+daerah\b|\bretribusi\b|\bbphtb\b|\bpbb\b/.test(d)) return 'LOCAL_TAX';
  if (/\bpajak\b|\btax\b|\bssp\b|\bdjp\b|\bmpn\b|\bbilling\b/.test(d)) return 'UNKNOWN_TAX';
  return undefined;
}

/**
 * Score a single intent against the normalized description.
 * Returns an IntentCandidate (score = 0 if nothing matched).
 */
function scoreIntent(
  intent: typeof CLASSIFIABLE_INTENTS[number],
  normalized: string,
): IntentCandidate {
  const entries = TRANSACTION_DICTIONARY[intent];
  const matchedKeywords: KeywordMatch[] = [];
  let rawScore = 0;

  // Track already-counted terms to avoid double-counting overlapping phrases
  const countedTerms = new Set<string>();

  // Sort entries descending by weight so longer / higher-weight terms are
  // checked first. When a longer phrase matches, shorter sub-terms are still
  // evaluated independently (they may appear elsewhere in the string).
  const sorted = [...entries].sort((a, b) => b.weight - a.weight);

  for (const entry of sorted) {
    if (countedTerms.has(entry.term)) continue;
    const matched = matchTerm(normalized, entry.term);
    if (matched) {
      countedTerms.add(entry.term);
      matchedKeywords.push({
        keyword: entry.term,
        matchedToken: matched,
        weight: entry.weight,
      });
      rawScore += entry.weight;
    }
  }

  return { intent, score: rawScore, matchedKeywords };
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Phase 1 main entry point.
 *
 * @param description - Raw bank mutation description (any case, any encoding).
 * @returns TransactionAnalysisResult — fully populated, ready for Phase 2 or direct use.
 */
export function analyzeTransactionDescription(description: string): TransactionAnalysisResult {
  const normalized = normalizeText(description ?? '');

  // Empty description → UNKNOWN immediately
  if (normalized.length === 0) {
    return emptyResult(description ?? '');
  }

  // Score all classifiable intents
  const candidates: IntentCandidate[] = CLASSIFIABLE_INTENTS.map((intent) =>
    scoreIntent(intent, normalized),
  );

  // Sort descending by score; ties broken by alphabetical intent name for stability
  const sorted = candidates
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.intent.localeCompare(b.intent));

  // If nothing matched at all, return UNKNOWN
  if (sorted.length === 0) {
    return unknownResult(normalized, description);
  }

  const assembled = assembleResult(sorted, normalized);
  const legacyTax = isLegacyTaxDescription(normalized);

  return {
    ...assembled,
    intent: legacyTax ? 'TAX_PAYMENT' : assembled.intent,
    normalizedDescription: normalized,
    taxSubtype: isTaxIntent(assembled.intent)
      ? inferTaxSubtype(normalized)
      : undefined,
  };
}

// ─── Batch helper ─────────────────────────────────────────────────────────────

/**
 * Analyze multiple descriptions at once.
 * Preserves input order. Pure, no side effects.
 */
export function analyzeTransactionDescriptions(
  descriptions: string[],
): TransactionAnalysisResult[] {
  return descriptions.map(analyzeTransactionDescription);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function emptyResult(_raw: string): TransactionAnalysisResult {
  return {
    intent: 'UNKNOWN',
    confidence: 0,
    normalizedDescription: '',
    candidates: [],
    explanation: {
      primaryReason: 'Description is empty — cannot classify.',
      supportingFactors: [],
      keywordsMatched: [],
      lowConfidenceReasons: ['Empty description provided.'],
    },
    requiresManualReview: true,
    taxSubtype: undefined,
  };
}

function unknownResult(normalized: string, _raw: string): TransactionAnalysisResult {
  return {
    intent: 'UNKNOWN',
    confidence: 0,
    normalizedDescription: normalized,
    candidates: [],
    explanation: {
      primaryReason: 'No transaction keywords found in description.',
      supportingFactors: [],
      keywordsMatched: [],
      lowConfidenceReasons: [
        'Description contains no recognizable transaction vocabulary.',
        'Consider adding to the semantic dictionary or assigning a manual intent.',
      ],
    },
    requiresManualReview: true,
    taxSubtype: undefined,
  };
}
