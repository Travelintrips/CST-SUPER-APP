/**
 * Expense Classification Service — Orkestrasi 3-layer pipeline
 *
 * Pipeline urutan prioritas:
 *   Layer 1 — bankDescriptionNormalizer (deterministik, gratis, cepat)
 *             → Jika confidence ≥ 85 DAN bukan "unknown" → gunakan langsung
 *   Layer 2 — Rule Engine (DB rules + built-in seed, deterministik)
 *             → Jika ada rule match → gunakan
 *   Layer 3 — AI Classifier (OpenAI GPT-4o-mini, fallback)
 *             → Hanya dipanggil jika layer 1+2 tidak menghasilkan hasil yang cukup yakin
 *             → Bisa dinonaktifkan via useAi=false untuk performa/hemat biaya
 *
 * Output: ClassificationResult — unified type yang bisa disimpan ke bank_mutations
 *
 * Dipakai oleh:
 *   - POST /bank-recon/classify          (classify satu deskripsi)
 *   - POST /bank-recon/classify/bulk     (classify batch mutasi yang belum ter-klasi)
 *   - unifiedMatchingEngine              (auto-classify saat mutasi tidak ter-match)
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { normalizeDescription } from "./bankDescriptionNormalizer.js";
import { runRuleEngine, mergeRules, BUILT_IN_RULES } from "./expenseRuleEngine.js";
import { classifyWithAiSafe } from "./expenseAiClassifier.js";
import { logger } from "./logger.js";
import type { NormalizationResult } from "./bankDescriptionNormalizer.js";
import type { ExpenseRule, RuleEngineResult } from "./expenseRuleEngine.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClassificationSource =
  | "normalizer"    // Layer 1: keyword normalizer sudah sangat yakin
  | "rule_engine"   // Layer 2: DB rule atau built-in rule match
  | "ai_classifier" // Layer 3: OpenAI classifier
  | "unclassified"; // Tidak ada layer yang berhasil

export interface ClassificationResult {
  source: ClassificationSource;
  category: string;
  suggestedAccountType: "expense" | "revenue" | "asset" | "liability" | null;
  suggestedAccountSubtype: string | null;
  confidence: number;
  notes: string;
  /** ID rule yang match (layer 2) */
  ruleId?: number;
  ruleName?: string;
  /** Nama vendor/counterparty terdeteksi (layer 3) */
  detectedVendor?: string;
  /** True jika ini transfer internal — SKIP pembuatan jurnal beban */
  isInternalTransfer: boolean;
  /** Snapshot normalisasi untuk debug/display */
  normalization: NormalizationResult;
}

export interface ClassifyOptions {
  description: string;
  amount?: number;
  direction?: "IN" | "OUT";
  companyId?: number | null;
  companyContext?: string;
  /** Apakah layer AI diaktifkan. Default: true */
  useAi?: boolean;
  /** Threshold minimum confidence layer 1 untuk skip ke layer 2+. Default: 85 */
  normalizerConfidenceThreshold?: number;
  /** Threshold minimum rule engine confidence untuk skip AI. Default: 60 */
  ruleEngineConfidenceThreshold?: number;
}

// ─── Row mapper untuk expense_rules ──────────────────────────────────────────

function rowToRule(r: Record<string, unknown>): ExpenseRule {
  return {
    id:         Number(r["id"]),
    companyId:  r["company_id"] != null ? Number(r["company_id"]) : null,
    name:       String(r["name"] ?? ""),
    priority:   Number(r["priority"] ?? 50),
    conditions: Array.isArray(r["conditions"])
      ? r["conditions"]
      : JSON.parse(String(r["conditions"] ?? "[]")),
    action:     typeof r["action"] === "object" && r["action"] !== null
      ? r["action"] as ExpenseRule["action"]
      : JSON.parse(String(r["action"] ?? "{}")),
    isActive:   Boolean(r["is_active"]),
  };
}

// ─── DB rule loader ───────────────────────────────────────────────────────────

async function loadDbRules(companyId: number | null): Promise<ExpenseRule[]> {
  try {
    const companyFilter = companyId != null
      ? `AND (er.company_id IS NULL OR er.company_id = ${companyId})`
      : "AND er.company_id IS NULL";

    const { rows } = await db.execute(sql.raw(`
      SELECT er.*
      FROM expense_rules er
      WHERE er.is_active = TRUE ${companyFilter}
      ORDER BY er.priority ASC, er.id ASC
    `));
    return (rows as Record<string, unknown>[]).map(rowToRule);
  } catch {
    // DB tidak tersedia — fallback ke built-in only
    return [];
  }
}

// ─── Layer 1 helper: normalizer category → result ────────────────────────────

const NORMALIZER_CATEGORY_MAP: Record<string, {
  category: string;
  accountType: "expense" | "revenue" | "asset" | "liability";
  accountSubtype: string;
}> = {
  "utility_electricity": { category: "utility_electricity", accountType: "expense", accountSubtype: "utility" },
  "utility_water":       { category: "utility_water",       accountType: "expense", accountSubtype: "utility" },
  "ecommerce":           { category: "ecommerce_settlement",accountType: "revenue", accountSubtype: "ecommerce" },
  "internal_transfer":   { category: "internal_transfer",   accountType: "asset",   accountSubtype: "cash_bank" },
  "bank_fee":            { category: "bank_fee",            accountType: "expense", accountSubtype: "bank_charge" },
  "payroll":             { category: "payroll",             accountType: "expense", accountSubtype: "payroll" },
  "marketplace_settlement": { category: "marketplace_settlement", accountType: "revenue", accountSubtype: "ecommerce" },
  "concession":          { category: "concession",          accountType: "expense", accountSubtype: "concession" },
};

// ─── Main service ─────────────────────────────────────────────────────────────

/**
 * Klasifikasi satu deskripsi mutasi bank melalui pipeline 3-layer.
 */
export async function classifyMutationDescription(
  opts: ClassifyOptions,
): Promise<ClassificationResult> {
  const {
    description,
    amount,
    direction,
    companyId = null,
    companyContext,
    useAi = true,
    normalizerConfidenceThreshold = 85,
    ruleEngineConfidenceThreshold = 60,
  } = opts;

  // ── Layer 1: Normalize ────────────────────────────────────────────────────
  const norm = normalizeDescription(description);

  // Layer 1 hit: normalizer yakin (confidence tinggi, bukan unknown)
  const normMap = NORMALIZER_CATEGORY_MAP[norm.category];
  if (normMap && norm.confidence >= normalizerConfidenceThreshold) {
    return {
      source: "normalizer",
      category: normMap.category,
      suggestedAccountType: normMap.accountType,
      suggestedAccountSubtype: normMap.accountSubtype,
      confidence: norm.confidence,
      notes: `Terdeteksi otomatis dari deskripsi bank: ${norm.category}`,
      isInternalTransfer: norm.isInternalTransfer,
      normalization: norm,
    };
  }

  // ── Layer 2: Rule Engine ──────────────────────────────────────────────────
  const dbRules = await loadDbRules(companyId);
  const mergedRules = mergeRules(dbRules, companyId);

  const ruleResult: RuleEngineResult = runRuleEngine(mergedRules, norm, { direction });

  if (ruleResult.matched && ruleResult.action) {
    const actionConfidence = ruleResult.action.confidence ?? 80;

    // Jika rule match tapi confidence rendah, tetap lanjut ke AI (jika enabled)
    if (actionConfidence >= ruleEngineConfidenceThreshold || !useAi) {
      return {
        source: "rule_engine",
        category: ruleResult.action.suggestedCategory ?? "other_expense",
        suggestedAccountType: (ruleResult.action.suggestedAccountType ?? "expense") as any,
        suggestedAccountSubtype: ruleResult.action.suggestedAccountSubtype ?? null,
        confidence: actionConfidence,
        notes: ruleResult.action.notes ?? `Rule "${ruleResult.matchedRule?.name}" match`,
        ruleId: ruleResult.matchedRule?.id,
        ruleName: ruleResult.matchedRule?.name,
        isInternalTransfer: ruleResult.action.isInternalTransfer ?? norm.isInternalTransfer,
        normalization: norm,
      };
    }
  }

  // ── Layer 3: AI Classifier ────────────────────────────────────────────────
  if (useAi) {
    const aiResult = await classifyWithAiSafe({
      rawDescription: description,
      norm,
      amount,
      direction,
      companyContext,
    });

    if (aiResult) {
      return {
        source: "ai_classifier",
        category: aiResult.category,
        suggestedAccountType: aiResult.suggestedAccountType,
        suggestedAccountSubtype: aiResult.suggestedAccountSubtype,
        confidence: aiResult.confidence,
        notes: aiResult.explanation,
        detectedVendor: aiResult.detectedVendor,
        isInternalTransfer: norm.isInternalTransfer,
        normalization: norm,
      };
    }
  }

  // ── Fallback: unclassified ────────────────────────────────────────────────
  // Jika normalizer punya petunjuk parsial, gunakan sebagai hint lemah
  if (normMap) {
    return {
      source: "normalizer",
      category: normMap.category,
      suggestedAccountType: normMap.accountType,
      suggestedAccountSubtype: normMap.accountSubtype,
      confidence: norm.confidence,
      notes: `Hint dari normalizer (confidence rendah): ${norm.category}`,
      isInternalTransfer: norm.isInternalTransfer,
      normalization: norm,
    };
  }

  return {
    source: "unclassified",
    category: direction === "IN" ? "other_income" : "other_expense",
    suggestedAccountType: direction === "IN" ? "revenue" : "expense",
    suggestedAccountSubtype: "other",
    confidence: 0,
    notes: "Tidak dapat diklasifikasikan secara otomatis. Perlu review manual.",
    isInternalTransfer: norm.isInternalTransfer,
    normalization: norm,
  };
}

// ─── Bulk classification ──────────────────────────────────────────────────────

export interface BulkClassifyOptions {
  companyId?: number | null;
  /** Hanya proses mutasi dengan direction ini */
  direction?: "IN" | "OUT";
  /** Hanya proses mutasi yang belum ter-klasifikasi */
  onlyUnclassified?: boolean;
  /** Max mutasi yang diproses dalam satu call */
  limit?: number;
  useAi?: boolean;
}

export interface BulkClassifyResult {
  processed: number;
  classified: number;
  skipped: number;
  errors: number;
  results: Array<{
    mutationId: number;
    description: string;
    result: ClassificationResult | null;
    error?: string;
  }>;
}

/**
 * Klasifikasi batch mutasi bank dari tabel bank_mutations.
 * Menyimpan hasil ke kolom expense_category, expense_classification_source, dll.
 */
export async function bulkClassifyMutations(
  opts: BulkClassifyOptions = {},
): Promise<BulkClassifyResult> {
  const {
    companyId,
    direction,
    onlyUnclassified = true,
    limit = 50,
    useAi = true,
  } = opts;

  // Build query to fetch mutations
  const conditions: string[] = ["1=1"];
  if (companyId != null)    conditions.push(`bm.company_id = ${companyId}`);
  if (direction)            conditions.push(`bm.direction = '${direction}'`);
  if (onlyUnclassified)     conditions.push(`(bm.expense_category IS NULL OR bm.expense_category = '')`);
  // Only process OUT direction (expenses) by default
  if (!direction)           conditions.push(`bm.direction = 'OUT'`);

  let mutations: Array<{ id: number; description: string; amount: number; direction: string; company_id: number | null }>;
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT bm.id, bm.description, bm.amount, bm.direction, bm.company_id
      FROM bank_mutations bm
      WHERE ${conditions.join(" AND ")}
      ORDER BY bm.transaction_date DESC
      LIMIT ${limit}
    `));
    mutations = (rows as any[]).map(r => ({
      id: Number(r.id),
      description: String(r.description ?? ""),
      amount: Number(r.amount),
      direction: String(r.direction ?? "OUT"),
      company_id: r.company_id != null ? Number(r.company_id) : null,
    }));
  } catch (err: any) {
    logger.error({ err: err.message }, "[expenseClassification] bulkClassify: DB query failed");
    return { processed: 0, classified: 0, skipped: 0, errors: 1, results: [] };
  }

  const summary: BulkClassifyResult = {
    processed: mutations.length,
    classified: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  for (const mut of mutations) {
    if (!mut.description) {
      summary.skipped++;
      summary.results.push({ mutationId: mut.id, description: "", result: null });
      continue;
    }

    try {
      const result = await classifyMutationDescription({
        description: mut.description,
        amount: mut.amount,
        direction: mut.direction as "IN" | "OUT",
        companyId: mut.company_id,
        useAi,
      });

      // Persist to bank_mutations — throws on real DB error, returns false if mutationId not found
      const wrote = await persistClassification(mut.id, result);

      if (wrote && result.source !== "unclassified") summary.classified++;
      else summary.skipped++;

      summary.results.push({ mutationId: mut.id, description: mut.description, result });
    } catch (err: any) {
      summary.errors++;
      logger.warn({ err: err.message, mutationId: mut.id }, "[expenseClassification] bulkClassify: item error");
      summary.results.push({
        mutationId: mut.id,
        description: mut.description,
        result: null,
        error: err.message,
      });
    }
  }

  return summary;
}

// ─── Persist helper ───────────────────────────────────────────────────────────

/**
 * Simpan hasil klasifikasi ke kolom expense_* di bank_mutations.
 * Idempotent — UPDATE WHERE id.
 *
 * @returns true  jika baris berhasil diperbarui (rowCount ≥ 1)
 * @returns false jika mutationId tidak ditemukan di DB
 * @throws  Error jika terjadi DB error nyata (koneksi, constraint, dll.)
 */
export async function persistClassification(
  mutationId: number,
  result: ClassificationResult,
): Promise<boolean> {
  const categorySafe       = (result.category ?? "").replace(/'/g, "''");
  const sourceSafe         = (result.source ?? "").replace(/'/g, "''");
  const accountTypeSafe    = (result.suggestedAccountType ?? "").replace(/'/g, "''");
  const accountSubtypeSafe = (result.suggestedAccountSubtype ?? "").replace(/'/g, "''");
  const notesSafe          = (result.notes ?? "").slice(0, 500).replace(/'/g, "''");
  const vendorSafe         = (result.detectedVendor ?? "").replace(/'/g, "''");

  // Throws on real DB error — caller receives the exception
  const res = await db.execute(sql.raw(`
    UPDATE bank_mutations
    SET
      expense_category                    = '${categorySafe}',
      expense_classification_source       = '${sourceSafe}',
      expense_classification_confidence   = ${result.confidence},
      expense_suggested_account_type      = '${accountTypeSafe}',
      expense_suggested_account_subtype   = '${accountSubtypeSafe}',
      expense_classification_notes        = '${notesSafe}',
      expense_detected_vendor             = ${vendorSafe ? `'${vendorSafe}'` : "NULL"},
      expense_is_internal_transfer        = ${result.isInternalTransfer},
      expense_classified_at               = NOW(),
      updated_at                          = NOW()
    WHERE id = ${mutationId}
  `));

  // rowCount = 0 means the mutationId was not found — not a DB error, just not found
  const rowCount = (res as any).rowCount ?? (res as any).count ?? 1;
  const wrote = Number(rowCount) > 0;

  if (!wrote) {
    logger.warn({ mutationId }, "[expenseClassification] persistClassification: mutationId not found");
  }

  return wrote;
}
