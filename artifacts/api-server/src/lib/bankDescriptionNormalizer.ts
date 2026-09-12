/**
 * Phase 2 — Bank Description Normalizer
 *
 * Pure function module: no DB deps, no side effects.
 * Input  : raw bank mutation description string (+ optional amount / direction)
 * Output : NormalizationResult — semantic enrichment of the raw description
 *
 * Detected categories:
 *   concession          — konsesi, sewa konsesi, biaya konsesi
 *   utility_electricity — PLN, listrik, token listrik, kwh
 *   utility_water       — PDAM, air minum, retribusi air
 *   ecommerce           — Shopee, Tokopedia, Lazada, Bukalapak, Blibli, TikTok Shop
 *   internal_transfer   — kas besar, petty cash, transfer internal, pemindahan dana
 *   bank_fee                  — biaya transfer, admin bank, provisi, materai, fee kliring
 *   interest_tax_withholding  — pajak bunga, pph bunga, pajak tabungan, standalone "pajak"
 *   payroll                   — gaji, salary, payroll, THR
 *   marketplace_settlement    — GoPay, OVO, DANA, LinkAja, QRIS, ShopeePay
 *   unknown                   — fallback
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type DescriptionCategory =
  | "concession"
  | "utility_electricity"
  | "utility_water"
  | "ecommerce"
  | "internal_transfer"
  | "bank_fee"
  | "interest_tax_withholding"
  | "payroll"
  | "marketplace_settlement"
  | "interest_income"
  | "unknown";

export type FeeType = "transfer" | "admin" | "kliring" | "materai" | "provisi" | "other";

export interface NormalizationResult {
  /** Original description unchanged */
  raw: string;
  /** Lowercased, special-char-stripped, multi-space-collapsed version */
  normalized: string;
  /** Word tokens ≥ 3 chars from normalized */
  tokens: string[];
  /** Detected semantic category */
  category: DescriptionCategory;
  /** Confidence 0–100 */
  confidence: number;
  /** Detected provider name (e.g. PLN, PDAM, Shopee) */
  provider?: string;
  /** Extracted transaction / order reference ID from description */
  providerOrderId?: string;
  /** Extracted counterparty name hint */
  counterpartyHint?: string;
  /** True when this mutation is a cash/bank-to-bank internal transfer, not a real expense */
  isInternalTransfer: boolean;
  /** True when this is a bank fee entry */
  isBankFee: boolean;
  /** Sub-type of bank fee when isBankFee = true */
  feeType?: FeeType;
  /** Arbitrary structured metadata key-value pairs */
  metadata: Record<string, string>;
}

// ─── Keyword maps ─────────────────────────────────────────────────────────────

interface CategoryRule {
  category: DescriptionCategory;
  keywords: string[];
  provider?: string;
  confidence: number;
}

/** Order matters: first match wins (highest-confidence rules first) */
const CATEGORY_RULES: CategoryRule[] = [
  // ── internal_transfer (must be before generic bank_fee) ──────────────────
  {
    category: "internal_transfer",
    keywords: [
      "kas besar", "kas ke kas", "transfer kas besar", "petty cash", "kas kecil ke besar",
      "pemindahan dana", "transfer internal", "intrabank transfer", "antar rekening",
      "transfer antar rek", "kiriman internal",
    ],
    confidence: 90,
  },

  // ── concession ────────────────────────────────────────────────────────────
  {
    category: "concession",
    keywords: [
      "konsesi", "concession", "sewa konsesi", "biaya konsesi", "iuran konsesi",
      "retribusi konsesi", "fee konsesi",
    ],
    confidence: 92,
  },

  // ── utility_electricity ───────────────────────────────────────────────────
  {
    category: "utility_electricity",
    keywords: [
      "pln", "token listrik", "listrik prabayar", "listrik pascabayar",
      "biaya listrik", "tagihan listrik", "token pln", "pembayaran pln",
      "kwh", "daya listrik", "electricity",
    ],
    provider: "PLN",
    confidence: 90,
  },
  {
    // "listrik" alone (lower confidence to avoid false-positives like "listrik toko")
    category: "utility_electricity",
    keywords: ["listrik", "electric"],
    provider: "PLN",
    confidence: 75,
  },

  // ── utility_water ─────────────────────────────────────────────────────────
  {
    category: "utility_water",
    keywords: [
      "pdam", "air minum", "air bersih", "retribusi air", "tagihan air",
      "biaya air", "pembayaran air pdam", "water utility",
    ],
    provider: "PDAM",
    confidence: 90,
  },

  // ── ecommerce ─────────────────────────────────────────────────────────────
  {
    category: "ecommerce",
    keywords: [
      "shopee", "tokopedia", "tokped", "lazada", "bukalapak", "blibli",
      "tiktok shop", "tiktokshop", "toko online", "zalora", "jd.id",
      "elevenia", "orami", "mamikos",
    ],
    confidence: 90,
  },

  // ── marketplace_settlement ────────────────────────────────────────────────
  {
    category: "marketplace_settlement",
    keywords: [
      "dompet anak bangsa", "gopay", "gojek", "ovo", "dana", "linkaja",
      "link aja", "shopeepay", "qris", "e-wallet", "ewallet",
      "ovo merchant", "dana merchant",
    ],
    confidence: 85,
  },

  // ── bank_fee ──────────────────────────────────────────────────────────────
  {
    category: "bank_fee",
    keywords: [
      "biaya transfer", "fee transfer", "transfer fee", "biaya admin",
      "biaya adm", "adm bank", "adm rek",   // abbreviation variants
      "biaya administrasi", "admin bank", "bank charge", "provisi",
      "bea materai", "materai", "biaya pembukuan", "fee kliring",
      "biaya kliring", "rtgs fee", "biaya rtgs", "swift charge",
      "biaya sms banking", "biaya internet banking", "biaya atm",
    ],
    confidence: 88,
  },

  // ── interest_tax_withholding ───────────────────────────────────────────────
  // Bank-deducted withholding tax on interest/savings (PPh Final Pasal 4 Ayat 2).
  // Must come BEFORE the generic "bank_fee" catchall so that tax entries are
  // routed to the correct PPh expense account (5-3044) instead of 5-3010.
  {
    category: "interest_tax_withholding",
    keywords: [
      "pajak bunga", "pajak tabungan", "pajak deposito", "pajak giro",
      "pph bunga", "pph tabungan", "pph deposito", "pph giro",
      "pajak bunga deposito", "pajak bunga tabungan",
      "pph final", "pph pasal 4", "withholding tax bunga",
    ],
    confidence: 90,
  },
  // Lower-confidence catch for plain "pajak" on bank statements —
  // Indonesian banks often deduct withholding tax with only "Pajak <ref>".
  {
    category: "interest_tax_withholding",
    keywords: ["pajak"],
    confidence: 65,
  },

  // ── payroll ───────────────────────────────────────────────────────────────
  {
    category: "payroll",
    keywords: [
      "gaji", "payroll", "salary", "thr", "tunjangan hari raya",
      "bonus karyawan", "insentif karyawan", "uang makan karyawan",
      "gaji karyawan", "pembayaran gaji",
    ],
    confidence: 88,
  },

  // ── interest_income ───────────────────────────────────────────────────────
  // Must come AFTER bank_fee so "bunga pajak" / "bank charge" don't match here.
  {
    category: "interest_income",
    keywords: [
      "jasa giro", "bunga tabungan", "bunga deposito", "pendapatan bunga",
      "bunga berjangka", "kredit bunga", "interest income", "interest credit",
      "savings interest", "bunga rekening koran", "interest earned",
      "giro bunga",
    ],
    confidence: 90,
  },
  {
    // Lower-confidence catch for plain "bunga" — avoids false-positive on
    // "bunga pajak" (tax interest, which is an expense not income).
    category: "interest_income",
    keywords: ["bunga"],
    confidence: 60,
  },
];

// ─── Fee type detector ────────────────────────────────────────────────────────

const FEE_TYPE_MAP: Array<{ type: FeeType; keywords: string[] }> = [
  { type: "materai",  keywords: ["materai", "bea materai"] },
  { type: "kliring",  keywords: ["kliring", "rtgs"] },
  { type: "provisi",  keywords: ["provisi"] },
  { type: "admin",    keywords: ["admin", "administrasi"] },
  { type: "transfer", keywords: ["transfer"] },
];

function detectFeeType(normalized: string): FeeType {
  for (const { type, keywords } of FEE_TYPE_MAP) {
    if (keywords.some(kw => normalized.includes(kw))) return type;
  }
  return "other";
}

// ─── Provider order ID extraction ─────────────────────────────────────────────

const ORDER_ID_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "gopay_order",   pattern: /\b(ID\d{12,20}[A-Z]{0,4})\b/i },
  { name: "shopee_order",  pattern: /\b(SHP\d{12,20})\b/i },
  { name: "tokopedia_ref", pattern: /\b(INV\/\d{8,}\/[A-Z0-9\-]+)\b/i },
  { name: "general_ref",   pattern: /\b([A-Z]{2,6}[-\/]\d{6,20})\b/ },
  { name: "numeric_ref",   pattern: /\bREF[:\s]?(\d{8,20})\b/i },
];

function extractProviderOrderId(raw: string): string | undefined {
  for (const { pattern } of ORDER_ID_PATTERNS) {
    const m = raw.match(pattern);
    if (m) return m[1].toUpperCase();
  }
  return undefined;
}

// ─── Counterparty hint extraction ─────────────────────────────────────────────

/**
 * Extracts a name-like token from the description that looks like a counterparty.
 * Heuristic: token after "DARI:", "TO:", "KE:", "DARI ", "ATM " patterns.
 */
function extractCounterpartyHint(raw: string): string | undefined {
  const patterns = [
    /(?:DARI|FROM|PENGIRIM)[:\s]+([A-Z][A-Z\s\-\.]{3,40}?)(?:\s+\d|\s*$)/i,
    /(?:KE|TO|TUJUAN)[:\s]+([A-Z][A-Z\s\-\.]{3,40}?)(?:\s+\d|\s*$)/i,
    /(?:A\/N|AN|ATAS NAMA)[:\s]+([A-Z][A-Z\s\-\.]{3,40}?)(?:\s+\d|\s*$)/i,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return undefined;
}

// ─── Main normalization function ───────────────────────────────────────────────

/**
 * Normalize a raw bank description string into a structured NormalizationResult.
 *
 * This function is pure (no DB, no side effects) and safe to call repeatedly.
 */
export function normalizeDescription(raw: string): NormalizationResult {
  if (!raw || typeof raw !== "string") {
    return emptyResult(raw ?? "");
  }

  // 1. Build normalized form
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s\/\-\.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 2. Tokenize (words ≥ 3 chars)
  const tokens = normalized.split(/\s+/).filter(t => t.length >= 3);

  // 3. Category detection — first rule whose keyword matches wins
  let detectedCategory: DescriptionCategory = "unknown";
  let confidence = 0;
  let provider: string | undefined;

  for (const rule of CATEGORY_RULES) {
    const matched = rule.keywords.some(kw => normalized.includes(kw.toLowerCase()));
    if (matched) {
      detectedCategory = rule.category;
      confidence = rule.confidence;
      if (rule.provider) provider = rule.provider;
      break;
    }
  }

  // 4. Derive flags from category
  const isInternalTransfer = detectedCategory === "internal_transfer";
  const isBankFee          = detectedCategory === "bank_fee";
  const feeType            = isBankFee ? detectFeeType(normalized) : undefined;

  // 5. Extract structured entities
  const providerOrderId    = extractProviderOrderId(raw);
  const counterpartyHint   = extractCounterpartyHint(raw);

  // 6. Build metadata
  const metadata: Record<string, string> = {};
  if (isBankFee && feeType) metadata["fee_type"] = feeType;
  if (isInternalTransfer)   metadata["transfer_type"] = "internal";
  if (providerOrderId)      metadata["order_id"] = providerOrderId;

  return {
    raw,
    normalized,
    tokens,
    category: detectedCategory,
    confidence,
    provider,
    providerOrderId,
    counterpartyHint,
    isInternalTransfer,
    isBankFee,
    feeType,
    metadata,
  };
}

function emptyResult(raw: string): NormalizationResult {
  return {
    raw,
    normalized: "",
    tokens: [],
    category: "unknown",
    confidence: 0,
    isInternalTransfer: false,
    isBankFee: false,
    metadata: {},
  };
}

// ─── Batch helper ─────────────────────────────────────────────────────────────

/** Normalize multiple descriptions at once (pure, no DB). */
export function normalizeDescriptions(
  inputs: string[],
): NormalizationResult[] {
  return inputs.map(normalizeDescription);
}

// ─── Re-export types for consumers ───────────────────────────────────────────

export type { FeeType as BankFeeType };
