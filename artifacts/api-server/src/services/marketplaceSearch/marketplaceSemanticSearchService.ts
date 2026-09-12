/**
 * Marketplace Semantic Search Service — Main Orchestrator
 *
 * Bilingual, synonym-aware, fuzzy-tolerant product search.
 *
 * Pipeline:
 *   1. Validate & normalize input
 *   2. Expand terms (synonyms, bilingual, category, HS Code)
 *   3. Fetch candidates (ONE efficient DB query)
 *   4. Score & rank in-memory (hybrid: exact → synonym → category → HS → fuzzy)
 *   5. Deduplicate by product ID
 *   6. Build structured response
 *
 * Safety guarantees:
 *   - Only publicly visible products (same filter as Customer Portal)
 *   - Never returns priceBase, markupPct, cost, margin, audit notes
 *   - Empty query rejected before DB call
 *   - Max 5 products per call
 *   - Max 15 expanded terms per call (prevents query explosion)
 *   - Fuzzy only after exact/synonym finds nothing
 */

import { normalizeQuery, tokenize, detectLanguage } from "./normalizer.js";
import { buildNormalizedQuery } from "./queryExpander.js";
import { fetchCandidates, fetchActiveCategories } from "./candidateSearch.js";
import { rankCandidates } from "./ranker.js";
import { SCORE } from "./types.js";
import type { SearchInput, SearchResult, MatchStrategy } from "./types.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 5;

/** Max suggestions to return when product not found */
const MAX_SUGGESTIONS = 3;

/**
 * Main entry point for the marketplace semantic search.
 *
 * @throws never — all errors are caught and returned as SearchResult with found=false
 */
export async function searchMarketplace(input: SearchInput): Promise<SearchResult> {
  const { query: rawQuery, limit: limitParam, includeSuggestions = false } = input;

  // ── 1. Validate ────────────────────────────────────────────────────────────
  if (typeof rawQuery !== "string" || !rawQuery.trim()) {
    return {
      query: "",
      found: false,
      matchStrategy: "none",
      products: [],
      suggestions: [],
      truncated: false,
    };
  }

  const limit = Math.min(Math.max(1, limitParam ?? DEFAULT_LIMIT), MAX_LIMIT);

  // ── 2. Normalize ───────────────────────────────────────────────────────────
  const normalized = normalizeQuery(rawQuery);
  if (!normalized) {
    return {
      query: rawQuery.slice(0, 100),
      found: false,
      matchStrategy: "none",
      products: [],
      suggestions: [],
      truncated: false,
    };
  }

  const tokens = tokenize(normalized);
  const language = detectLanguage(tokens);

  // ── 3. Expand terms ────────────────────────────────────────────────────────
  const nq = buildNormalizedQuery(rawQuery, normalized, language);

  // ── 4. Fetch candidates ────────────────────────────────────────────────────
  let candidates: Awaited<ReturnType<typeof fetchCandidates>>;
  try {
    candidates = await fetchCandidates(nq.expandedTerms, nq.hsCodeTerms);
  } catch {
    return {
      query: rawQuery,
      found: false,
      matchStrategy: "none",
      products: [],
      suggestions: [],
      truncated: false,
    };
  }

  // ── 5. Rank ────────────────────────────────────────────────────────────────
  const ranked = rankCandidates(
    candidates,
    normalized,
    nq.tokens,
    nq.expandedTerms,
    nq.hsCodeTerms,
    limit,
  );

  const found = ranked.length > 0;

  // Best match strategy across returned results
  const bestStrategy: MatchStrategy =
    ranked.length > 0 ? ranked[0].matchStrategy : "none";

  // ── 6. Suggestions (only when not found and caller wants them) ────────────
  let suggestions: string[] = [];
  if (!found && includeSuggestions) {
    try {
      const activeCategories = await fetchActiveCategories(8);
      suggestions = activeCategories.slice(0, MAX_SUGGESTIONS);
    } catch {
      // non-critical
    }
  }

  // ── 7. Truncated flag ─────────────────────────────────────────────────────
  // true if we had more candidates than the limit (user should know there may be more)
  const truncated = candidates.length > limit && found;

  return {
    query: rawQuery,
    found,
    matchStrategy: bestStrategy,
    products: ranked,
    suggestions,
    truncated,
  };
}
