/**
 * Marketplace Semantic Search — Bilingual Commodity Synonym Dictionary
 *
 * Rules:
 * - Case-insensitive (all entries lowercase)
 * - Multi-word phrases take priority over single tokens during matching
 * - Only for search term expansion, NOT for claiming product availability
 * - No LLM calls — fully deterministic
 * - Conservative: avoid overly broad synonyms that produce false positives
 */

export interface SynonymEntry {
  /** The canonical / primary term (usually Indonesian) */
  canonical: string;
  /** All equivalent terms (other language, spelling variants, trade names) */
  synonyms: string[];
}

/**
 * Bidirectional synonym dictionary.
 *
 * Each group maps ALL terms to each other.
 * Multi-word phrases MUST appear before single-word entries for the same
 * commodity so that phrase-priority matching works correctly.
 */
export const SYNONYM_GROUPS: SynonymEntry[] = [
  // ── Kopi / Coffee ─────────────────────────────────────────────────────────
  { canonical: "kopi arabika", synonyms: ["arabica coffee", "arabica coffee bean", "arabica coffee beans", "arabika", "arabica"] },
  { canonical: "kopi robusta", synonyms: ["robusta coffee", "robusta coffee bean", "robusta coffee beans", "robusta"] },
  { canonical: "kopi", synonyms: ["coffee", "coffee bean", "coffee beans", "biji kopi"] },

  // ── Arang / Charcoal ──────────────────────────────────────────────────────
  { canonical: "arang kelapa", synonyms: ["coconut charcoal", "charcoal briquette", "coconut charcoal briquette", "coconut shell charcoal", "briket arang kelapa", "briket kelapa"] },
  { canonical: "arang", synonyms: ["charcoal", "wood charcoal"] },

  // ── Kelapa / Coconut ──────────────────────────────────────────────────────
  { canonical: "minyak kelapa", synonyms: ["coconut oil", "virgin coconut oil", "vco"] },
  { canonical: "santan kelapa", synonyms: ["coconut milk", "coconut cream"] },
  { canonical: "kelapa", synonyms: ["coconut"] },

  // ── Nanas / Pineapple ─────────────────────────────────────────────────────
  { canonical: "nanas kalengan", synonyms: ["canned pineapple", "pineapple can", "pineapple canned"] },
  { canonical: "nanas", synonyms: ["pineapple", "pinaple", "pineaple"] },

  // ── Bawang / Onion ────────────────────────────────────────────────────────
  { canonical: "bawang putih", synonyms: ["garlic", "garlick", "white garlic", "bawang puti", "bwang putih"] },
  { canonical: "bawang merah", synonyms: ["shallot", "red onion", "bawang bombay merah"] },
  { canonical: "bawang bombay", synonyms: ["onion", "yellow onion", "white onion"] },

  // ── Ikan & Seafood ────────────────────────────────────────────────────────
  { canonical: "ikan tuna beku", synonyms: ["frozen tuna", "tuna frozen", "tuna beku", "frozen tuna fish"] },
  { canonical: "tuna", synonyms: ["tuna fish", "yellowfin tuna", "skipjack tuna", "bluefin tuna"] },
  { canonical: "udang vannamei", synonyms: ["vannamei shrimp", "whiteleg shrimp", "pacific white shrimp"] },
  { canonical: "udang", synonyms: ["shrimp", "prawn", "udang segar"] },
  { canonical: "ikan", synonyms: ["fish", "seafood"] },

  // ── Kacang / Nuts ─────────────────────────────────────────────────────────
  { canonical: "kacang mete", synonyms: ["cashew", "cashew nut", "cashew nuts", "mete", "mede", "kacang mede", "jambu mete"] },
  { canonical: "kacang tanah", synonyms: ["peanut", "groundnut", "peanuts"] },
  { canonical: "kedelai", synonyms: ["soybean", "soy bean", "kacang kedelai"] },

  // ── Rempah-rempah / Spices ────────────────────────────────────────────────
  { canonical: "lada hitam", synonyms: ["black pepper", "black peppercorn", "merica hitam"] },
  { canonical: "lada putih", synonyms: ["white pepper", "white peppercorn", "merica putih"] },
  { canonical: "lada", synonyms: ["pepper", "merica", "peppercorn"] },
  { canonical: "kayu manis", synonyms: ["cinnamon", "cinnammon", "cinammon", "cinnamon stick"] },
  { canonical: "cengkeh", synonyms: ["clove", "cloves"] },
  { canonical: "pala", synonyms: ["nutmeg", "mace", "nutmeg seed"] },
  { canonical: "kunyit", synonyms: ["turmeric", "turmeric powder"] },
  { canonical: "jahe", synonyms: ["ginger", "ginger root"] },
  { canonical: "vanili", synonyms: ["vanilla", "vanilla bean"] },

  // ── Komoditas Perkebunan ───────────────────────────────────────────────────
  { canonical: "minyak sawit mentah", synonyms: ["crude palm oil", "cpo", "palm oil crude"] },
  { canonical: "minyak sawit", synonyms: ["palm oil", "palm olein", "refined palm oil", "rpo"] },
  { canonical: "sawit", synonyms: ["oil palm", "palm"] },
  { canonical: "karet alam", synonyms: ["natural rubber", "rubber sheet", "rss", "tsr", "latex"] },
  { canonical: "karet", synonyms: ["rubber", "latex"] },
  { canonical: "kakao", synonyms: ["cocoa", "cacao", "cocoa bean", "kakao"] },
  { canonical: "tembakau", synonyms: ["tobacco", "tobacco leaf"] },
  { canonical: "tebu", synonyms: ["sugarcane", "sugar cane"] },
  { canonical: "kopra", synonyms: ["copra", "dried coconut"] },

  // ── Beras & Serealia ──────────────────────────────────────────────────────
  { canonical: "beras putih", synonyms: ["white rice", "milled rice"] },
  { canonical: "beras merah", synonyms: ["red rice", "brown rice"] },
  { canonical: "beras", synonyms: ["rice", "paddy"] },
  { canonical: "jagung", synonyms: ["corn", "maize", "sweet corn"] },
  { canonical: "gandum", synonyms: ["wheat", "wheat flour", "flour"] },

  // ── Gula ──────────────────────────────────────────────────────────────────
  { canonical: "gula pasir", synonyms: ["white sugar", "crystal sugar", "refined sugar"] },
  { canonical: "gula merah", synonyms: ["palm sugar", "brown sugar", "coconut sugar", "gula jawa", "gula aren"] },
  { canonical: "gula", synonyms: ["sugar"] },

  // ── Hasil Pertambangan ────────────────────────────────────────────────────
  { canonical: "batubara termal", synonyms: ["thermal coal", "steam coal", "coking coal"] },
  { canonical: "batubara", synonyms: ["coal", "batu bara"] },
  { canonical: "bijih besi", synonyms: ["iron ore", "iron ore pellet"] },
  { canonical: "besi", synonyms: ["iron", "iron scrap"] },
  { canonical: "baja", synonyms: ["steel", "steel bar", "steel plate", "steel coil"] },
  { canonical: "nikel", synonyms: ["nickel", "nickel ore"] },
  { canonical: "tembaga", synonyms: ["copper", "copper ore"] },
  { canonical: "timah", synonyms: ["tin", "tin ore", "tin ingot"] },
  { canonical: "emas", synonyms: ["gold", "gold bar"] },
  { canonical: "bauksit", synonyms: ["bauxite", "aluminium ore"] },

  // ── Produk Hortikultura ───────────────────────────────────────────────────
  { canonical: "sayur segar", synonyms: ["fresh vegetable", "fresh vegetables", "vegetable", "vegetables"] },
  { canonical: "buah segar", synonyms: ["fresh fruit", "fresh fruits", "fruit"] },
  { canonical: "tomat", synonyms: ["tomato", "tomatoes"] },
  { canonical: "cabai", synonyms: ["chili", "chilli", "chili pepper", "red chili", "cayenne"] },
  { canonical: "kentang", synonyms: ["potato", "potatoes"] },
  { canonical: "wortel", synonyms: ["carrot", "carrots"] },
  { canonical: "pisang", synonyms: ["banana", "bananas"] },
  { canonical: "mangga", synonyms: ["mango", "mangoes"] },
  { canonical: "durian", synonyms: ["durian fruit"] },

  // ── Minyak Asam / Lainnya ─────────────────────────────────────────────────
  { canonical: "minyak asam", synonyms: ["palm acid oil", "acid oil", "fatty acid"] },

  // ── Kayu & Produk Hutan ───────────────────────────────────────────────────
  { canonical: "kayu jati", synonyms: ["teak", "teak wood", "teak timber"] },
  { canonical: "kayu", synonyms: ["wood", "timber", "lumber"] },
  { canonical: "rotan", synonyms: ["rattan", "cane"] },

  // ── Produk Olahan ─────────────────────────────────────────────────────────
  { canonical: "mie instan", synonyms: ["instant noodle", "instant noodles", "noodle"] },
  { canonical: "tepung terigu", synonyms: ["wheat flour", "all purpose flour"] },
  { canonical: "minyak goreng", synonyms: ["cooking oil", "frying oil", "vegetable oil"] },
];

/**
 * Precomputed lookup: term → Set of synonym terms (bidirectional).
 * Built once at module load time.
 */
const TERM_TO_GROUP = new Map<string, Set<string>>();

for (const group of SYNONYM_GROUPS) {
  const allTerms = [group.canonical, ...group.synonyms].map((t) => t.toLowerCase().trim());
  const termSet = new Set(allTerms);
  for (const term of allTerms) {
    const existing = TERM_TO_GROUP.get(term);
    if (existing) {
      // Merge groups (shouldn't happen with well-maintained dict)
      for (const t of termSet) existing.add(t);
    } else {
      TERM_TO_GROUP.set(term, new Set(termSet));
    }
  }
}

/**
 * Get all synonym terms for a given input term (case-insensitive).
 * Returns empty Set if no synonyms found.
 * The input term itself is included in the result set.
 */
export function getSynonyms(term: string): Set<string> {
  const key = term.toLowerCase().trim();
  return TERM_TO_GROUP.get(key) ?? new Set([key]);
}

/**
 * Get synonym expansions for a full multi-token phrase AND its individual tokens.
 * Multi-word phrases are checked first (higher precision).
 *
 * Returns deduplicated array of all expanded terms.
 */
export function expandTerms(tokens: string[], normalizedQuery: string): string[] {
  const result = new Set<string>();

  // 1. Always include the normalized query itself
  result.add(normalizedQuery);

  // 2. Check full phrase in dictionary
  const fullSynonyms = getSynonyms(normalizedQuery);
  for (const s of fullSynonyms) result.add(s);

  // 3. Check multi-word sub-phrases (bigrams, trigrams) from dictionary
  for (let len = tokens.length - 1; len >= 2; len--) {
    for (let start = 0; start <= tokens.length - len; start++) {
      const phrase = tokens.slice(start, start + len).join(" ");
      const phraseSynonyms = getSynonyms(phrase);
      if (phraseSynonyms.size > 1 || phraseSynonyms.has(phrase)) {
        // Only add if actually found in dict (size > 1 means real synonyms exist)
        for (const s of phraseSynonyms) result.add(s);
      }
    }
  }

  // 4. Check individual tokens
  for (const token of tokens) {
    const tokenSynonyms = getSynonyms(token);
    for (const s of tokenSynonyms) result.add(s);
  }

  return [...result];
}

/**
 * Category alias mapping — maps broad Indonesian category intents
 * to searchable DB values. Conservative: only well-known groupings.
 */
export const CATEGORY_ALIASES: Record<string, string[]> = {
  makanan: ["food", "canned", "seafood", "agriculture", "hortikultura", "pangan", "frozen"],
  pangan: ["food", "agriculture", "hortikultura", "canned", "rice", "sugar", "flour"],
  "bahan pangan": ["food", "agriculture", "pangan", "hortikultura"],
  "hasil pertanian": ["agriculture", "hortikultura", "rice", "corn", "soybean", "vegetable"],
  "hasil perkebunan": ["coffee", "cocoa", "rubber", "palm", "coconut", "tobacco", "cashew"],
  "hasil laut": ["seafood", "fish", "shrimp", "tuna", "frozen"],
  seafood: ["seafood", "fish", "shrimp", "tuna", "frozen"],
  "bahan industri": ["rubber", "coal", "iron", "steel", "chemical", "palm_acid_oil"],
  pertambangan: ["coal", "iron", "nickel", "copper", "tin", "bauxite", "mineral"],
  "hasil tambang": ["coal", "iron", "nickel", "copper", "tin", "bauxite"],
  logam: ["iron", "steel", "copper", "nickel", "tin", "aluminium", "metal"],
  "komoditas ekspor": ["coffee", "cocoa", "palm", "rubber", "coal", "seafood", "cashew"],
  rempah: ["spice", "pepper", "cinnamon", "clove", "nutmeg", "turmeric", "ginger"],
  "rempah-rempah": ["spice", "pepper", "cinnamon", "clove", "nutmeg", "turmeric"],
  hortikultura: ["vegetable", "fruit", "hortikultura"],
  "buah-buahan": ["fruit", "pineapple", "banana", "mango", "fresh"],
  sayuran: ["vegetable", "fresh", "hortikultura"],
};

/** Get category alias terms for a given query token */
export function getCategoryAliases(token: string): string[] {
  const key = token.toLowerCase().trim();
  return CATEGORY_ALIASES[key] ?? [];
}
