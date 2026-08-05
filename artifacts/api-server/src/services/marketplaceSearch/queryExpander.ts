/**
 * Marketplace Semantic Search — Query Expander
 *
 * Takes a normalized query and produces an ordered, deduplicated list of
 * search terms using: original, bilingual synonym, category alias, and HS Code.
 *
 * NO LLM calls. Fully deterministic.
 */

import { expandTerms, getCategoryAliases, CATEGORY_ALIASES } from "./synonymDictionary.js";
import { extractHsCodes, tokenize } from "./normalizer.js";
import type { NormalizedQuery } from "./types.js";

/** Max expanded terms to avoid query explosion */
const MAX_EXPANDED_TERMS = 15;

/**
 * Build a NormalizedQuery object from a raw and normalized query string.
 */
export function buildNormalizedQuery(
  originalQuery: string,
  normalizedQuery: string,
  language: "id" | "en" | "mixed",
): NormalizedQuery {
  const tokens = tokenize(normalizedQuery);

  // Expand terms via synonym dictionary
  const synonymExpanded = expandTerms(tokens, normalizedQuery);

  // Detect category intent terms
  const detectedCategoryTerms: string[] = [];
  const categoryAliasTerms: string[] = [];
  for (const token of tokens) {
    if (CATEGORY_ALIASES[token]) {
      detectedCategoryTerms.push(token);
      const aliases = getCategoryAliases(token);
      for (const a of aliases) {
        if (!categoryAliasTerms.includes(a)) categoryAliasTerms.push(a);
      }
    }
  }
  // Also check full phrase
  if (CATEGORY_ALIASES[normalizedQuery]) {
    if (!detectedCategoryTerms.includes(normalizedQuery)) {
      detectedCategoryTerms.push(normalizedQuery);
    }
    const aliases = getCategoryAliases(normalizedQuery);
    for (const a of aliases) {
      if (!categoryAliasTerms.includes(a)) categoryAliasTerms.push(a);
    }
  }

  // Extract HS Code patterns
  const hsCodeTerms = extractHsCodes(originalQuery);

  // Build final expanded terms list
  // Order: original → synonyms → category aliases → HS codes
  const allTerms: string[] = [];
  const seen = new Set<string>();

  const add = (t: string) => {
    const normalized = t.toLowerCase().trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      allTerms.push(normalized);
    }
  };

  // 1. Original normalized query (highest precision)
  add(normalizedQuery);

  // 2. Synonym-expanded terms (already includes original)
  for (const t of synonymExpanded) add(t);

  // 3. Category alias terms
  for (const t of categoryAliasTerms) add(t);

  // 4. Individual tokens (already in synonymExpanded but explicit pass)
  for (const t of tokens) add(t);

  // 5. HS codes
  for (const t of hsCodeTerms) add(t);

  // Cap
  const expandedTerms = allTerms.slice(0, MAX_EXPANDED_TERMS);

  return {
    originalQuery,
    normalizedQuery,
    language,
    tokens,
    expandedTerms,
    detectedCategoryTerms,
    hsCodeTerms,
  };
}
