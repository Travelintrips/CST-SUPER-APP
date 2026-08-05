/**
 * Marketplace Semantic Search — Type Definitions
 *
 * Input/output contracts for the bilingual, synonym-aware,
 * fuzzy-tolerant marketplace product search service.
 */

export interface SearchInput {
  /** Raw user query string */
  query: string;
  /** Max products to return: 1–5, default 5 */
  limit?: number;
  /** Whether to include spelling/category suggestions when not found */
  includeSuggestions?: boolean;
  /** Override search mode. Default: "auto" */
  searchMode?: "auto" | "exact" | "category" | "hs_code";
}

export interface NormalizedQuery {
  originalQuery: string;
  normalizedQuery: string;
  /** Detected primary language */
  language: "id" | "en" | "mixed";
  /** Tokenized words from normalizedQuery */
  tokens: string[];
  /** All expanded search terms (original + synonyms + fuzzy candidates) */
  expandedTerms: string[];
  /** Detected category-intent terms (e.g. "makanan", "logam") */
  detectedCategoryTerms: string[];
  /** Detected HS Code patterns (e.g. "0901.11", "090111") */
  hsCodeTerms: string[];
}

/** Match strategy labels — used in score and response */
export type MatchStrategy =
  | "exact_name"
  | "exact_token"
  | "synonym_phrase"
  | "synonym_token"
  | "category_exact"
  | "category_alias"
  | "description"
  | "hs_code_exact"
  | "hs_code_prefix"
  | "fuzzy"
  | "none";

/** Scoring constants — guides ranking, not enforced per-pixel */
export const SCORE = {
  EXACT_FULL_NAME: 100,
  EXACT_TOKEN: 95,
  HS_CODE_EXACT: 95,
  SYNONYM_PHRASE: 90,
  HS_CODE_PREFIX: 85,
  CATEGORY_EXACT: 80,
  SYNONYM_TOKEN: 75,
  FUZZY_STRONG: 70,
  DESCRIPTION: 65,
  CATEGORY_ALIAS: 60,
  FUZZY_WEAK: 0, // Do not return
} as const;

/** Raw DB row returned by candidateSearch */
export interface CandidateRow {
  id: number;
  name: string;
  kategori: string | null;
  categoryKey: string | null;
  description: string | null;
  hsCode: string | null;
  stockStatus: string | null;
  priceSell: string | null;
  unit: string | null;
  vendorName: string | null;
  supplierPublicName: string | null;
  isFeatured: boolean | null;
}

/** Fully scored search result item */
export interface SearchResultProduct {
  id: number;
  name: string;
  category: string | null;
  supplierName: string | null;
  stockStatus: string;
  stockLabel: string;
  priceSell: number | null;
  priceStatus: string;
  unit: string | null;
  publicUrl: string;
  score: number;
  matchedFields: string[];
  matchStrategy: MatchStrategy;
}

/** Final response from the search service */
export interface SearchResult {
  query: string;
  found: boolean;
  matchStrategy: MatchStrategy;
  products: SearchResultProduct[];
  suggestions: string[];
  truncated: boolean;
}
