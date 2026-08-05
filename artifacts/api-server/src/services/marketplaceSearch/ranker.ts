/**
 * Marketplace Semantic Search — Hybrid Ranker
 *
 * Scores each candidate row against the normalized query using a layered
 * matching strategy. Deduplicates by product ID (keeps highest score).
 * Sorts: score DESC → isFeatured (tie-break) → name ASC (deterministic).
 *
 * All scoring is in-memory — no additional DB queries.
 */

import type { CandidateRow, MatchStrategy, SearchResultProduct } from "./types.js";
import { SCORE } from "./types.js";
import { fuzzyTokenMatch } from "./fuzzy.js";
import { MIN_FUZZY_LENGTH } from "./normalizer.js";

/** Customer-friendly stock label mapping */
function mapStockLabel(status: string | null): string {
  if (!status) return "Silakan konfirmasi ketersediaan";
  const v = status.toLowerCase();
  if (v === "available" || v === "in_stock") return "Tersedia";
  if (v === "limited") return "Stok terbatas";
  if (v === "on_inquiry" || v === "on_order") return "Ketersediaan berdasarkan konfirmasi";
  if (v === "out_of_stock") return "Tidak tersedia saat ini";
  return "Silakan konfirmasi ketersediaan";
}

/** Price display — only priceSell, never priceBase/markup */
function mapPriceStatus(priceSell: string | null): string {
  if (!priceSell) return "Harga berdasarkan permintaan";
  const n = Number(priceSell);
  if (!isFinite(n) || n <= 0) return "Harga berdasarkan permintaan";
  return `Rp ${n.toLocaleString("id-ID")}`;
}

interface ScoredCandidate {
  row: CandidateRow;
  score: number;
  matchedFields: string[];
  matchStrategy: MatchStrategy;
}

/**
 * Score a single candidate against ALL expanded terms + HS codes.
 * Returns the best-matching score, strategy, and matched fields.
 */
function scoreCandidate(
  row: CandidateRow,
  normalizedQuery: string,
  tokens: string[],
  expandedTerms: string[],
  hsCodeTerms: string[],
): ScoredCandidate {
  let bestScore: number = SCORE.FUZZY_WEAK;
  let bestStrategy: MatchStrategy = "none";
  const matchedFields: Set<string> = new Set();

  const name = (row.name ?? "").toLowerCase();
  const kategori = (row.kategori ?? "").toLowerCase();
  const categoryKey = (row.categoryKey ?? "").toLowerCase();
  const description = (row.description ?? "").slice(0, 800).toLowerCase();
  const hsCode = (row.hsCode ?? "").toLowerCase();

  // ── 1. Exact full-name match ───────────────────────────────────────────────
  if (name === normalizedQuery) {
    if (SCORE.EXACT_FULL_NAME > bestScore) {
      bestScore = SCORE.EXACT_FULL_NAME;
      bestStrategy = "exact_name";
    }
    matchedFields.add("name");
  }

  // ── 2. HS Code exact / prefix match ───────────────────────────────────────
  if (hsCode && hsCodeTerms.length > 0) {
    for (const code of hsCodeTerms) {
      const c = code.toLowerCase();
      if (hsCode === c || hsCode.replace(/\./g, "") === c.replace(/\./g, "")) {
        if (SCORE.HS_CODE_EXACT > bestScore) {
          bestScore = SCORE.HS_CODE_EXACT;
          bestStrategy = "hs_code_exact";
        }
        matchedFields.add("hsCode");
      } else if (hsCode.startsWith(c) || hsCode.replace(/\./g, "").startsWith(c.replace(/\./g, ""))) {
        if (SCORE.HS_CODE_PREFIX > bestScore) {
          bestScore = SCORE.HS_CODE_PREFIX;
          bestStrategy = "hs_code_prefix";
        }
        matchedFields.add("hsCode");
      }
    }
  }

  // ── 3. Exact token match in name ──────────────────────────────────────────
  for (const token of tokens) {
    if (name === token || name.includes(token)) {
      if (SCORE.EXACT_TOKEN > bestScore) {
        bestScore = SCORE.EXACT_TOKEN;
        bestStrategy = "exact_token";
      }
      matchedFields.add("name");
    }
    if (kategori === token || kategori.includes(token)) {
      if (SCORE.CATEGORY_EXACT > bestScore) {
        bestScore = SCORE.CATEGORY_EXACT;
        bestStrategy = "category_exact";
      }
      matchedFields.add("category");
    }
    if (categoryKey === token || categoryKey.includes(token)) {
      if (SCORE.CATEGORY_EXACT > bestScore) {
        bestScore = SCORE.CATEGORY_EXACT;
        bestStrategy = "category_exact";
      }
      matchedFields.add("categoryKey");
    }
  }

  // ── 4. Expanded term (synonym) matching ───────────────────────────────────
  for (const term of expandedTerms) {
    if (!term || term === normalizedQuery) continue; // already scored above

    const isOriginalToken = tokens.includes(term);

    if (name.includes(term)) {
      const score = name === term ? SCORE.SYNONYM_PHRASE : (isOriginalToken ? SCORE.EXACT_TOKEN : SCORE.SYNONYM_PHRASE);
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = isOriginalToken ? "exact_token" : "synonym_phrase";
      }
      matchedFields.add("name");
      matchedFields.add("synonym");
    }

    if (kategori.includes(term) || categoryKey.includes(term)) {
      const score = SCORE.SYNONYM_TOKEN;
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = "synonym_token";
      }
      matchedFields.add("category");
      matchedFields.add("synonym");
    }

    if (description && description.includes(term)) {
      if (SCORE.DESCRIPTION > bestScore) {
        bestScore = SCORE.DESCRIPTION;
        bestStrategy = "description";
      }
      matchedFields.add("description");
    }
  }

  // ── 5. Fuzzy matching (only if no good match yet and query is long enough) ──
  if (bestScore < SCORE.FUZZY_STRONG) {
    const qualifiedTokens = tokens.filter((t) => t.length >= MIN_FUZZY_LENGTH);
    if (qualifiedTokens.length > 0) {
      const fuzzyNameScore = fuzzyTokenMatch(qualifiedTokens, row.name ?? "");
      if (fuzzyNameScore > bestScore) {
        bestScore = fuzzyNameScore;
        bestStrategy = "fuzzy";
        matchedFields.add("name");
      }
      if (row.kategori) {
        const fuzzyCatScore = fuzzyTokenMatch(qualifiedTokens, row.kategori);
        if (fuzzyCatScore > bestScore) {
          bestScore = fuzzyCatScore;
          bestStrategy = "fuzzy";
          matchedFields.add("category");
        }
      }
    }
  }

  return { row, score: bestScore, matchedFields: [...matchedFields], matchStrategy: bestStrategy };
}

/**
 * Score, deduplicate, and sort a set of candidate rows.
 *
 * @param candidates - raw DB rows
 * @param normalizedQuery - cleaned query string
 * @param tokens - tokenized query
 * @param expandedTerms - all synonym-expanded terms
 * @param hsCodeTerms - extracted HS Code patterns
 * @param limit - max results to return (1–5)
 * @returns ranked, deduplicated product results
 */
export function rankCandidates(
  candidates: CandidateRow[],
  normalizedQuery: string,
  tokens: string[],
  expandedTerms: string[],
  hsCodeTerms: string[],
  limit: number,
): SearchResultProduct[] {
  // Score all candidates
  const scored = candidates.map((row) =>
    scoreCandidate(row, normalizedQuery, tokens, expandedTerms, hsCodeTerms),
  );

  // Deduplicate by product ID — keep highest score per ID
  const byId = new Map<number, ScoredCandidate>();
  for (const s of scored) {
    const existing = byId.get(s.row.id);
    if (!existing || s.score > existing.score) {
      byId.set(s.row.id, s);
    } else if (existing && s.score === existing.score) {
      // Merge matched fields
      const merged = new Set([...existing.matchedFields, ...s.matchedFields]);
      byId.set(s.row.id, { ...existing, matchedFields: [...merged] });
    }
  }

  // Filter out FUZZY_WEAK results (confidence too low)
  const valid = [...byId.values()].filter((s) => s.score > SCORE.FUZZY_WEAK);

  // Sort: score DESC → featured (tie-break, only if relevance equal) → name ASC
  valid.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // isFeatured only breaks ties at same score — never overrides relevance
    if (a.row.isFeatured && !b.row.isFeatured) return -1;
    if (!a.row.isFeatured && b.row.isFeatured) return 1;
    return (a.row.name ?? "").localeCompare(b.row.name ?? "");
  });

  // Take top-N
  const topN = valid.slice(0, limit);

  // Map to output shape (never expose priceBase, markupPct, cost)
  return topN.map((s): SearchResultProduct => {
    const { row } = s;
    const priceSellNum = row.priceSell && Number(row.priceSell) > 0
      ? Number(row.priceSell)
      : null;

    return {
      id: row.id,
      name: row.name ?? "",
      category: row.kategori ?? null,
      supplierName: row.supplierPublicName ?? row.vendorName ?? null,
      stockStatus: row.stockStatus ?? "unknown",
      stockLabel: mapStockLabel(row.stockStatus),
      priceSell: priceSellNum,
      priceStatus: mapPriceStatus(row.priceSell),
      unit: row.unit ?? null,
      publicUrl: `/marketplace/${row.id}`,
      score: s.score,
      matchedFields: s.matchedFields,
      matchStrategy: s.matchStrategy,
    };
  });
}
