/**
 * Expense AI Classifier — Fase 6D
 *
 * Fallback AI classifier menggunakan OpenAI GPT-4o-mini untuk mendeteksi
 * kategori pengeluaran dari deskripsi mutasi bank yang tidak ter-cover
 * oleh rule engine deterministik.
 *
 * Konteks: Platform B2B Indonesia (CST Super App)
 *   - Deskripsi bank biasanya dalam bahasa Indonesia / campuran
 *   - Kategori selaras dengan COA subtype yang ada di sistem
 *   - Cache in-memory (LRU 500 entries) untuk hindari biaya berulang
 *
 * Output: AiClassificationResult
 *   - category: label semantik (snake_case, Bahasa Indonesia friendly)
 *   - suggestedAccountType: "expense" | "revenue" | "asset" | "liability"
 *   - suggestedAccountSubtype: hint COA subtype
 *   - confidence: 0–100
 *   - explanation: alasan singkat dari AI (untuk display ke user)
 *   - detectedVendor: nama vendor/counterparty jika terdeteksi
 */

import { getOpenAI } from "./openaiClient.js";
import { logger } from "./logger.js";
import type { NormalizationResult } from "./bankDescriptionNormalizer.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AiClassificationResult {
  category: string;
  suggestedAccountType: "expense" | "revenue" | "asset" | "liability";
  suggestedAccountSubtype: string;
  confidence: number;
  explanation: string;
  detectedVendor?: string;
  /** "ai_classifier" — agar dapat dibedakan dari rule engine */
  source: "ai_classifier";
}

export interface AiClassifierInput {
  rawDescription: string;
  norm: NormalizationResult;
  amount?: number;
  direction?: "IN" | "OUT";
  companyContext?: string;
}

// ─── Category catalogue (untuk prompt few-shot examples) ─────────────────────

/**
 * Katalog kategori yang dikenali sistem.
 * AI akan memilih salah satu category + accountType + accountSubtype dari daftar ini
 * atau menghasilkan yang baru jika tidak ada yang cocok.
 */
export const EXPENSE_CATEGORY_CATALOGUE = [
  { category: "utility_electricity", accountType: "expense", accountSubtype: "utility",        label: "Listrik (PLN, token, tagihan)" },
  { category: "utility_water",       accountType: "expense", accountSubtype: "utility",        label: "Air (PDAM, air galon)" },
  { category: "utility_internet",    accountType: "expense", accountSubtype: "utility",        label: "Internet / Telepon (Telkom, IndiHome, dll)" },
  { category: "payroll",             accountType: "expense", accountSubtype: "payroll",        label: "Gaji, THR, bonus karyawan" },
  { category: "bank_fee",            accountType: "expense", accountSubtype: "bank_charge",    label: "Biaya bank / transfer / admin" },
  { category: "concession",          accountType: "expense", accountSubtype: "concession",     label: "Biaya konsesi / sewa area" },
  { category: "rent",                accountType: "expense", accountSubtype: "rent",           label: "Sewa gedung / tempat usaha" },
  { category: "office_supply",       accountType: "expense", accountSubtype: "office_expense", label: "ATK, alat kantor, kertas, tinta" },
  { category: "travel",              accountType: "expense", accountSubtype: "travel",         label: "Perjalanan dinas, transport, bensin, tol" },
  { category: "marketing",           accountType: "expense", accountSubtype: "marketing",      label: "Iklan, promosi, endorse, spanduk" },
  { category: "maintenance",         accountType: "expense", accountSubtype: "maintenance",    label: "Servis, perbaikan, perawatan aset" },
  { category: "tax_payment",         accountType: "expense", accountSubtype: "tax",            label: "Pembayaran pajak (PPN, PPh, PBB, dll)" },
  { category: "insurance",           accountType: "expense", accountSubtype: "insurance",      label: "Premi asuransi" },
  { category: "professional_fee",    accountType: "expense", accountSubtype: "professional",   label: "Jasa konsultan, notaris, pengacara" },
  { category: "food_beverage",       accountType: "expense", accountSubtype: "consumable",     label: "Konsumsi rapat, snack, makan karyawan" },
  { category: "consumable",          accountType: "expense", accountSubtype: "consumable",     label: "Perlengkapan habis pakai, bahan operasional" },
  { category: "security",            accountType: "expense", accountSubtype: "service",        label: "Jasa keamanan, satpam" },
  { category: "cleaning",            accountType: "expense", accountSubtype: "service",        label: "Kebersihan, cleaning service" },
  { category: "freight",             accountType: "expense", accountSubtype: "freight",        label: "Ongkos kirim, biaya pengiriman barang" },
  { category: "supplier_payment",    accountType: "expense", accountSubtype: "cogs",           label: "Pembayaran ke supplier / vendor barang" },
  { category: "ecommerce_settlement",accountType: "revenue", accountSubtype: "ecommerce",      label: "Settlement masuk dari platform e-commerce" },
  { category: "internal_transfer",   accountType: "asset",   accountSubtype: "cash_bank",      label: "Transfer kas internal, bukan beban P&L" },
  { category: "investment",          accountType: "asset",   accountSubtype: "investment",     label: "Pembelian aset, investasi" },
  { category: "loan_repayment",      accountType: "liability",accountSubtype: "loan",          label: "Cicilan pinjaman / kredit bank" },
  { category: "other_expense",       accountType: "expense", accountSubtype: "other",          label: "Pengeluaran lain-lain yang belum ter-kategorikan" },
] as const;

// ─── LRU Cache ────────────────────────────────────────────────────────────────

const CACHE_MAX = 500;
const _cache = new Map<string, AiClassificationResult>();

function cacheKey(raw: string, direction?: string): string {
  return `${direction ?? ""}|${raw.toLowerCase().slice(0, 120)}`;
}

function cacheGet(key: string): AiClassificationResult | undefined {
  return _cache.get(key);
}

function cacheSet(key: string, result: AiClassificationResult): void {
  if (_cache.size >= CACHE_MAX) {
    // Evict oldest (first inserted)
    const firstKey = _cache.keys().next().value;
    if (firstKey) _cache.delete(firstKey);
  }
  _cache.set(key, result);
}

export function clearAiClassifierCache(): void {
  _cache.clear();
}

export function getAiClassifierCacheStats(): { size: number; max: number } {
  return { size: _cache.size, max: CACHE_MAX };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const catalogueLines = EXPENSE_CATEGORY_CATALOGUE.map(
    c => `  - category="${c.category}" accountType="${c.accountType}" accountSubtype="${c.accountSubtype}" → ${c.label}`,
  ).join("\n");

  return `Kamu adalah sistem klasifikasi pengeluaran keuangan untuk perusahaan B2B di Indonesia.
Tugasmu: analisa deskripsi mutasi bank dan tentukan kategori pengeluaran yang paling tepat.

Katalog kategori yang tersedia:
${catalogueLines}

Aturan:
1. Pilih category, accountType, accountSubtype dari katalog di atas.
2. Jika mutasi adalah penerimaan uang (direction=IN dan bukan e-commerce settlement), gunakan accountType="revenue".
3. Jika tidak ada yang cocok, gunakan category="other_expense" accountType="expense" accountSubtype="other".
4. confidence: 90-100 = sangat yakin, 70-89 = yakin, 50-69 = mungkin, <50 = tidak yakin.
5. explanation: 1 kalimat singkat dalam Bahasa Indonesia, jelaskan kenapa kategori ini dipilih.
6. detectedVendor: nama vendor/counterparty jika ada di deskripsi, atau null.

Respons HARUS berupa JSON valid saja, tanpa teks lain:
{
  "category": string,
  "accountType": "expense"|"revenue"|"asset"|"liability",
  "accountSubtype": string,
  "confidence": number,
  "explanation": string,
  "detectedVendor": string|null
}`;
}

function buildUserPrompt(input: AiClassifierInput): string {
  const parts: string[] = [];
  parts.push(`Deskripsi bank: "${input.rawDescription}"`);
  if (input.norm.normalized !== input.rawDescription.toLowerCase()) {
    parts.push(`Deskripsi ternormalisasi: "${input.norm.normalized}"`);
  }
  if (input.norm.tokens.length) {
    parts.push(`Kata kunci: ${input.norm.tokens.slice(0, 10).join(", ")}`);
  }
  if (input.amount !== undefined) {
    parts.push(`Nominal: Rp ${input.amount.toLocaleString("id-ID")}`);
  }
  if (input.direction) {
    parts.push(`Arah: ${input.direction === "OUT" ? "Pengeluaran (debit)" : "Penerimaan (kredit)"}`);
  }
  if (input.norm.provider) {
    parts.push(`Provider terdeteksi: ${input.norm.provider}`);
  }
  if (input.companyContext) {
    parts.push(`Konteks perusahaan: ${input.companyContext}`);
  }
  return parts.join("\n");
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * Klasifikasi deskripsi mutasi bank menggunakan OpenAI.
 *
 * Gunakan hanya ketika rule engine deterministik tidak menghasilkan match,
 * atau confidence rule engine < 60.
 *
 * @throws Error jika OPENAI_API_KEY tidak dikonfigurasi atau API error
 */
export async function classifyWithAi(
  input: AiClassifierInput,
): Promise<AiClassificationResult> {
  const key = cacheKey(input.rawDescription, input.direction);

  // Check cache first
  const cached = cacheGet(key);
  if (cached) {
    logger.debug({ key: key.slice(0, 60) }, "[expenseAiClassifier] cache hit");
    return cached;
  }

  const openai = getOpenAI();

  const systemPrompt = buildSystemPrompt();
  const userPrompt   = buildUserPrompt(input);

  let raw: string;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      temperature: 0.1,   // deterministik sebisa mungkin
      max_tokens: 300,
      response_format: { type: "json_object" },
    });
    raw = response.choices[0]?.message?.content ?? "{}";
  } catch (err: any) {
    logger.error({ err: err.message, desc: input.rawDescription.slice(0, 60) }, "[expenseAiClassifier] OpenAI error");
    throw new Error(`OpenAI API error: ${err.message}`);
  }

  // Parse response
  let parsed: {
    category?: string;
    accountType?: string;
    accountSubtype?: string;
    confidence?: number;
    explanation?: string;
    detectedVendor?: string | null;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ raw: raw.slice(0, 200) }, "[expenseAiClassifier] invalid JSON from OpenAI");
    parsed = {};
  }

  // Validate accountType
  const validTypes = ["expense", "revenue", "asset", "liability"] as const;
  const accountType = validTypes.includes(parsed.accountType as any)
    ? (parsed.accountType as "expense" | "revenue" | "asset" | "liability")
    : "expense";

  // Guard against NaN/Infinity from non-numeric AI output before SQL interpolation
  const rawConfidence = Number(parsed.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.min(100, Math.max(0, rawConfidence))
    : 50; // safe default when AI returns null / string / undefined

  const result: AiClassificationResult = {
    category:             parsed.category        || "other_expense",
    suggestedAccountType: accountType,
    suggestedAccountSubtype: parsed.accountSubtype || "other",
    confidence,
    explanation:          parsed.explanation     || "Tidak dapat menentukan kategori dengan pasti.",
    detectedVendor:       parsed.detectedVendor  || undefined,
    source:               "ai_classifier",
  };

  logger.info(
    {
      category: result.category,
      confidence: result.confidence,
      desc: input.rawDescription.slice(0, 60),
    },
    "[expenseAiClassifier] classified",
  );

  cacheSet(key, result);
  return result;
}

/**
 * Versi safe: tangkap error dan kembalikan hasil default jika AI gagal.
 * Gunakan ini di reconciliation flow agar tidak memblokir proses utama.
 */
export async function classifyWithAiSafe(
  input: AiClassifierInput,
): Promise<AiClassificationResult | null> {
  try {
    return await classifyWithAi(input);
  } catch (err: any) {
    logger.warn({ err: err.message, desc: input.rawDescription.slice(0, 60) }, "[expenseAiClassifier] safe: AI unavailable");
    return null;
  }
}
