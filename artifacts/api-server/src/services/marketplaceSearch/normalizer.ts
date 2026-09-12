/**
 * Marketplace Semantic Search — Query Normalizer
 *
 * Deterministic, injection-safe query normalization.
 * Runs BEFORE any synonym expansion or DB query.
 */

/** Maximum allowed query length (characters). Truncated, not rejected. */
export const MAX_QUERY_LENGTH = 100;

/** Minimum query length to attempt fuzzy matching */
export const MIN_FUZZY_LENGTH = 4;

/** Minimum query length to be valid at all */
export const MIN_QUERY_LENGTH = 1;

/**
 * HS Code pattern — captures formats like "0901.11", "090111", "0901", "09.01.11".
 * Matches: 4–8 consecutive digits optionally interleaved with dots.
 * Examples: "0901.11", "090111", "0901", "2709.00"
 */
const HS_CODE_PATTERN = /\b(\d{2,4}(?:\.\d{2,4}){1,3}|\d{6,10}|\d{4})\b/g;

/**
 * Patterns that indicate an HS Code search intent.
 * E.g. "HS CODE 0901" or "kode hs 09"
 */
const HS_CODE_INTENT = /\b(?:hs\s*code|kode\s*hs|hs)\s+([\d.]+)/gi;

/**
 * Normalize a raw user query into a clean, searchable form.
 *
 * Steps:
 *   1. Enforce length cap
 *   2. Lowercase
 *   3. Collapse repeated whitespace
 *   4. Remove punctuation except: digits, letters, spaces, hyphens, dots
 *      (dots preserved for HS Codes)
 *   5. Trim leading/trailing whitespace
 *   6. Tokenize
 *
 * Returns null if the result is empty (caller should reject).
 */
export function normalizeQuery(raw: string): string | null {
  if (typeof raw !== "string") return null;

  // 1. Enforce length cap
  let q = raw.slice(0, MAX_QUERY_LENGTH);

  // 2. Lowercase
  q = q.toLowerCase();

  // 3. Remove control characters
  // eslint-disable-next-line no-control-regex
  q = q.replace(/[\x00-\x1f\x7f]/g, " ");

  // 4. Remove punctuation that is not relevant.
  //    Keep: letters (including Indonesian extended chars), digits, spaces, hyphens, dots.
  //    Dots are kept for HS Code patterns (will be stripped from non-HS contexts later).
  q = q.replace(/[^\p{L}\p{N}\s.\-]/gu, " ");

  // 5. Collapse repeated whitespace / hyphens
  q = q.replace(/\s+/g, " ").trim();

  // 6. Remove trailing/leading dots that are not part of HS codes
  //    e.g. "kopi." → "kopi"
  q = q.replace(/(?<!\d)\./g, " ").replace(/\.(?!\d)/g, " ");
  q = q.replace(/\s+/g, " ").trim();

  if (q.length < MIN_QUERY_LENGTH) return null;
  return q;
}

/** Tokenize a normalized query into individual words. */
export function tokenize(normalized: string): string[] {
  return normalized.split(/\s+/).filter((t) => t.length >= 2);
}

/**
 * Extract HS Code patterns from a raw or normalized query.
 *
 * Supports all common separator formats:
 *   "0901.11"  — dot-separated (canonical)
 *   "090111"   — no separator
 *   "0901"     — 4-digit chapter/heading only
 *   "0901-11"  — hyphen separator
 *   "0901 11"  — space separator (4-digit + 2-digit groups)
 *   "0901/11"  — slash separator
 *
 * Rules:
 *   - Leading zeros are preserved (codes are strings, never parsed as integers)
 *   - Original display value is preserved by the caller; this function returns
 *     canonical form (dot-separated and dotless variants) for matching.
 *   - Random characters / non-digit content never produces a false match.
 */
export function extractHsCodes(raw: string): string[] {
  const codes: string[] = [];

  /** Push a code and its dotless variant (deduped). */
  const push = (code: string) => {
    const c = code.trim();
    if (!c) return;
    if (!codes.includes(c)) codes.push(c);
    const dotless = c.replace(/\./g, "");
    if (dotless !== c && !codes.includes(dotless)) codes.push(dotless);
  };

  // Build normalized variants so all separator styles are handled uniformly.
  //   - hyphen/slash between digit groups → dot  ("0901-11" / "0901/11" → "0901.11")
  //   - space-separated 4-digit + 2-digit groups → dot  ("0901 11" → "0901.11")
  const sepNormalized = raw.replace(/(\d+)\s*[-/]\s*(\d+)/g, "$1.$2");
  const spaceNormalized = raw.replace(/\b(\d{4})\s+(\d{2})\b/g, "$1.$2");

  for (const source of new Set([raw, sepNormalized, spaceNormalized])) {
    // Match explicit intent keywords ("HS CODE 0901.11", "kode hs 0901-11", …)
    for (const m of source.matchAll(HS_CODE_INTENT)) {
      if (m[1]) push(m[1].replace(/\s/g, ""));
    }
    // Match bare HS-like numeric patterns
    for (const m of source.matchAll(HS_CODE_PATTERN)) {
      push(m[1]);
    }
  }

  return [...new Set(codes)];
}

/**
 * Detect the primary language of a query by checking for Indonesian-specific
 * words. Returns "id" for mostly Indonesian, "en" for mostly English, or
 * "mixed" if both appear.
 *
 * This is a lightweight heuristic — not a full language detector.
 */
const ID_SIGNAL_WORDS = new Set([
  "ada", "apa", "yang", "jual", "beli", "cari", "mau", "bisa", "tidak",
  "dan", "atau", "dengan", "untuk", "dari", "di", "ke", "pada",
  "berapa", "harga", "stok", "tersedia", "produk", "barang", "kategori",
  "saya", "kami", "tolong", "bantu", "informasi", "silakan",
  "kayu", "kelapa", "minyak", "sawit", "karet", "jagung", "beras",
  "bawang", "nanas", "ikan", "udang", "lada", "kayu", "tembakau",
  "baja", "besi", "batubara", "arang", "kopi", "kakao", "gula", "kacang",
]);

const EN_SIGNAL_WORDS = new Set([
  "the", "and", "or", "for", "from", "with", "of", "in", "to", "is", "are",
  "buy", "sell", "price", "stock", "available", "search", "product", "category",
  "coal", "iron", "steel", "rubber", "palm", "oil", "coffee", "cocoa",
  "garlic", "onion", "pineapple", "shrimp", "pepper", "cinnamon", "tobacco",
  "fish", "tuna", "cashew", "sugar", "rice", "corn",
]);

export function detectLanguage(tokens: string[]): "id" | "en" | "mixed" {
  let idCount = 0;
  let enCount = 0;
  for (const t of tokens) {
    if (ID_SIGNAL_WORDS.has(t)) idCount++;
    if (EN_SIGNAL_WORDS.has(t)) enCount++;
  }
  if (idCount === 0 && enCount === 0) return "id"; // default to Indonesian
  if (idCount > 0 && enCount === 0) return "id";
  if (enCount > 0 && idCount === 0) return "en";
  return "mixed";
}
