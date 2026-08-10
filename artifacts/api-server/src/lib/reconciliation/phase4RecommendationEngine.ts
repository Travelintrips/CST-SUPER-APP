/**
 * Phase 4 — Combined Recommendation Engine
 *
 * Menggabungkan tiga sumber rekomendasi:
 *  1. Rule Engine result (dari expenseRuleEngine)
 *  2. ERP Document match (dari erpDocumentMatcher)
 *  3. Historical match (dari historicalMatchingEngine)
 *
 * Urutan wajib (sesuai spesifikasi):
 *  1. Normalize mutation description
 *  2. Evaluate Expense Rule Engine
 *  3. Match ERP documents
 *  4. Match historical classifications
 *  5. Produce combined recommendation
 *  6. JANGAN panggil AI
 *
 * Evidence hierarchy (tertinggi → terendah):
 *  - Exact ERP document match
 *  - Exact approved history (high confidence)
 *  - Recurring history
 *  - Rule keyword match
 *  - Amount-only (TIDAK boleh menghasilkan auto-match)
 *
 * COA Resolution:
 *  - Filter by company_id
 *  - Hanya akun aktif
 *  - Hanya akun postable (bukan parent)
 *  - Pastikan account_type sesuai
 *  - Jika tidak ditemukan atau ambigu → warning
 *  - JANGAN hard-code ID
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { RuleEngineResult } from "../expenseRuleEngine.js";
import type { ErpMatchResult, ErpSourceType } from "./erpDocumentMatcher.js";
import type { HistoricalMatchResult } from "./historicalMatchingEngine.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecommendationMethod =
  | "ERP_DOCUMENT_MATCH"
  | "HISTORICAL_EXACT"
  | "HISTORICAL_NORMALIZED"
  | "HISTORICAL_VENDOR"
  | "HISTORICAL_RECURRING"
  | "HISTORICAL_SIMILARITY"
  | "RULE_ENGINE"
  | "NO_MATCH";

export type ClassificationType =
  | "EXPENSE"
  | "REVENUE"
  | "TRANSFER"
  | "ADVANCE"
  | "PAYMENT"
  | "UNKNOWN";

export interface CoaResolutionResult {
  coaId: number | null;
  coaCode: string | null;
  coaName: string | null;
  warnings: string[];
}

export interface Phase4Input {
  mutationId: number;
  companyId: number | null;
  amount: number;
  direction: "IN" | "OUT";
  ruleResult: RuleEngineResult;
  erpMatch: ErpMatchResult;
  historicalMatch: HistoricalMatchResult;
}

export interface Phase4Output {
  mutationId: number;
  ruleResult: RuleEngineResult;
  erpMatch: {
    matched: boolean;
    sourceType: ErpSourceType | null;
    sourceId: number | null;
    candidateSource: string | null;
    confidence: number;
    reasonCodes: string[];
    isMultipleCandidates?: boolean;
    multipleCandidatesCount?: number;
  };
  historicalMatch: {
    matched: boolean;
    confidence: number;
    method?: string;
    candidateType?: string;
    candidateId?: number;
    candidateSource?: string | null;
    confidenceBand?: string;
  };
  finalRecommendation: {
    classification: ClassificationType;
    expenseCategoryId: number | null;
    suggestedCoaId: number | null;
    suggestedCoaCode: string | null;
    vendorId: number | null;
    matchedDocumentType: string | null;
    matchedDocumentId: number | null;
    confidence: number;
    method: RecommendationMethod;
    requiresReview: boolean;
  };
  warnings: string[];
}

// ─── COA Resolution ───────────────────────────────────────────────────────────

/**
 * Resolve COA berdasarkan semantic type hint (BUKAN ID hard-coded).
 *
 * Filter wajib:
 *  - company_id cocok
 *  - is_active = true
 *  - allow_posting = true (bukan parent account)
 *  - account_type sesuai suggestedAccountType
 *  - Jika ada subtype hint, filter lebih spesifik
 *
 * Jika tidak ditemukan atau lebih dari satu → warning, return null.
 */
export async function resolveCoa(
  companyId: number | null,
  suggestedAccountType: string | undefined,
  suggestedAccountSubtype: string | undefined,
): Promise<CoaResolutionResult> {
  const warnings: string[] = [];

  if (!companyId) {
    warnings.push("company_id tidak tersedia — COA tidak dapat di-resolve");
    return { coaId: null, coaCode: null, coaName: null, warnings };
  }

  if (!suggestedAccountType) {
    return { coaId: null, coaCode: null, coaName: null, warnings };
  }

  // Normalisasi account_type ke format DB
  const typeMap: Record<string, string[]> = {
    expense:   ["expense", "expenses", "beban", "biaya"],
    revenue:   ["revenue", "revenues", "pendapatan", "income"],
    asset:     ["asset", "assets", "aset", "aktiva"],
    liability: ["liability", "liabilities", "utang", "kewajiban"],
  };

  let dbAccountType: string | null = null;
  for (const [canonical, aliases] of Object.entries(typeMap)) {
    if (aliases.includes(suggestedAccountType.toLowerCase())) {
      dbAccountType = canonical;
      break;
    }
  }

  if (!dbAccountType) {
    warnings.push(`account_type tidak dikenali: "${suggestedAccountType}"`);
    return { coaId: null, coaCode: null, coaName: null, warnings };
  }

  try {
    // Build query — filter by company, active, postable, account_type
    const subtypeClause = suggestedAccountSubtype
      ? `AND (
           LOWER(coa.account_subtype) = '${suggestedAccountSubtype.toLowerCase().replace(/'/g, "''")}'
           OR LOWER(coa.code) LIKE '%${suggestedAccountSubtype.toLowerCase().replace(/'/g, "''")}%'
           OR LOWER(coa.name) LIKE '%${suggestedAccountSubtype.toLowerCase().replace(/'/g, "''")}%'
         )`
      : "";

    const { rows } = await db.execute(sql.raw(`
      SELECT coa.id, coa.code, coa.name, coa.account_type, coa.is_active,
             COALESCE(coa.allow_posting, TRUE) AS allow_posting,
             COALESCE(coa.is_header, FALSE) AS is_header
      FROM chart_of_accounts coa
      WHERE coa.company_id = ${Number(companyId)}
        AND coa.is_active = TRUE
        AND COALESCE(coa.allow_posting, TRUE) = TRUE
        AND COALESCE(coa.is_header, FALSE) = FALSE
        AND LOWER(coa.account_type) = '${dbAccountType}'
        ${subtypeClause}
      ORDER BY coa.code ASC
      LIMIT 5
    `));

    const candidates = rows as any[];

    if (candidates.length === 0) {
      warnings.push(
        `Tidak ada COA aktif ditemukan untuk type="${dbAccountType}"` +
        (suggestedAccountSubtype ? ` subtype="${suggestedAccountSubtype}"` : "") +
        ` di company_id=${companyId}`,
      );
      return { coaId: null, coaCode: null, coaName: null, warnings };
    }

    if (candidates.length > 1) {
      warnings.push(
        `COA ambigu: ${candidates.length} kandidat ditemukan untuk type="${dbAccountType}"` +
        (suggestedAccountSubtype ? ` subtype="${suggestedAccountSubtype}"` : "") +
        `. Pilih secara manual. Kandidat: ${candidates.map((c: any) => `${c.code} (${c.name})`).join(", ")}`,
      );
      // Return null jika ambigu
      return { coaId: null, coaCode: null, coaName: null, warnings };
    }

    const best = candidates[0];
    return {
      coaId: Number(best.id),
      coaCode: String(best.code),
      coaName: String(best.name),
      warnings,
    };
  } catch (e: any) {
    warnings.push(`COA resolution gagal: ${e.message}`);
    return { coaId: null, coaCode: null, coaName: null, warnings };
  }
}

// ─── Classification helper ────────────────────────────────────────────────────

function deriveClassification(
  direction: "IN" | "OUT",
  sourceType: string | null,
  accountType: string | undefined,
): ClassificationType {
  if (sourceType === "cash_advances") return "ADVANCE";
  if (sourceType === "accounting_payments") {
    return direction === "IN" ? "REVENUE" : "PAYMENT";
  }
  if (sourceType === "sales_documents") return "REVENUE";
  if (accountType === "revenue") return "REVENUE";
  if (accountType === "asset" || accountType === "liability") return "TRANSFER";
  if (direction === "OUT") return "EXPENSE";
  if (direction === "IN") return "REVENUE";
  return "UNKNOWN";
}

// ─── Historical method classifier ────────────────────────────────────────────

function classifyHistoricalMethod(
  suggestion: { signals: Array<{ type: string; matched: boolean }>; confidenceBand: string },
): RecommendationMethod {
  const signals = suggestion.signals;
  const exactNorm = signals.find(s => s.type === "exact_normalized" && s.matched);
  const vendor    = signals.find(s => s.type === "vendor_match"     && s.matched);
  const similar   = signals.find(s => s.type === "similarity"       && s.matched);
  const recurring = signals.find(s => s.type === "recurring_monthly"  && s.matched);

  if (exactNorm) return "HISTORICAL_EXACT";
  if (vendor)    return "HISTORICAL_VENDOR";
  if (recurring) return "HISTORICAL_RECURRING";
  if (similar)   return "HISTORICAL_SIMILARITY";
  return "HISTORICAL_NORMALIZED";
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * buildCombinedRecommendation — entry point Phase 4.
 *
 * Menggabungkan rule result + ERP match + historical match menjadi satu
 * rekomendasi terstruktur. ERP document yang cocok mengalahkan rule engine
 * yang bertentangan.
 */
export async function buildCombinedRecommendation(
  input: Phase4Input,
): Promise<Phase4Output> {
  const { mutationId, companyId, direction, ruleResult, erpMatch, historicalMatch } = input;
  const warnings: string[] = [];

  // ── Prepare output skeletons ────────────────────────────────────────────────

  const erpOut: Phase4Output["erpMatch"] = {
    matched: erpMatch.matched,
    sourceType: erpMatch.sourceType,
    sourceId: erpMatch.sourceId,
    candidateSource: erpMatch.candidateSource ?? null,
    confidence: erpMatch.confidence,
    reasonCodes: erpMatch.reasonCodes,
    isMultipleCandidates: erpMatch.isMultipleCandidates,
    multipleCandidatesCount: erpMatch.multipleCandidatesCount,
  };

  const bestHistorical = historicalMatch.suggestions[0] ?? null;
  const histOut: Phase4Output["historicalMatch"] = bestHistorical
    ? {
        matched: bestHistorical.confidence >= 55,
        confidence: bestHistorical.confidence,
        method: classifyHistoricalMethod(bestHistorical as any),
        candidateType: bestHistorical.candidateType,
        candidateId: bestHistorical.candidateId,
        candidateSource: bestHistorical.candidateSource,
        confidenceBand: bestHistorical.confidenceBand,
      }
    : { matched: false, confidence: 0 };

  // ── Evidence hierarchy decision ─────────────────────────────────────────────

  let method: RecommendationMethod = "NO_MATCH";
  let matchedDocType: string | null = null;
  let matchedDocId: number | null = null;
  let finalConfidence = 0;
  let finalAccountType: string | undefined;
  let finalAccountSubtype: string | undefined;
  let requiresReview = true;

  // 1. ERP Document Match (prioritas tertinggi)
  if (erpMatch.matched && erpMatch.sourceType && erpMatch.sourceId != null) {
    method          = "ERP_DOCUMENT_MATCH";
    matchedDocType  = erpMatch.sourceType;
    matchedDocId    = erpMatch.sourceId;
    finalConfidence = erpMatch.confidence;
    requiresReview  = erpMatch.confidence < 0.90;

    // Tentukan account type dari source
    if (erpMatch.sourceType === "expenses") {
      finalAccountType    = "expense";
      finalAccountSubtype = undefined;
    } else if (erpMatch.sourceType === "cash_advances") {
      finalAccountType    = "asset";
      finalAccountSubtype = "cash_bank";
    } else if (erpMatch.sourceType === "accounting_payments") {
      finalAccountType    = direction === "IN" ? "revenue" : "liability";
    } else if (erpMatch.sourceType === "sales_documents") {
      finalAccountType    = "revenue";
    } else if (erpMatch.sourceType === "logistic_orders") {
      finalAccountType    = "expense";
      finalAccountSubtype = "logistic";
    } else if (erpMatch.sourceType === "sport_payments" || erpMatch.sourceType === "tenant_invoices") {
      finalAccountType    = "revenue";
    }

    // Rule engine override: jika rule menyarankan account type yang berbeda,
    // catat warning bahwa ERP document mengalahkan rule
    if (ruleResult.matched && ruleResult.action?.suggestedAccountType) {
      const ruleType = ruleResult.action.suggestedAccountType;
      if (ruleType !== finalAccountType) {
        warnings.push(
          `Rule engine menyarankan account_type="${ruleType}" (rule: "${ruleResult.matchedRule?.name}"), ` +
          `tapi ERP document match (${erpMatch.sourceType} #${erpMatch.sourceId}) menghasilkan account_type="${finalAccountType}". ` +
          `ERP document diutamakan.`,
        );
      }
    }
  }
  // 2. Historical match (exact / vendor / recurring dengan confidence tinggi)
  else if (bestHistorical && bestHistorical.confidence >= 80) {
    method          = classifyHistoricalMethod(bestHistorical as any);
    matchedDocType  = bestHistorical.candidateType;
    matchedDocId    = bestHistorical.candidateId;
    finalConfidence = bestHistorical.confidence / 100;
    requiresReview  = bestHistorical.confidence < 90;
  }
  // 3. Historical match dengan confidence medium
  else if (bestHistorical && bestHistorical.confidence >= 55) {
    method          = classifyHistoricalMethod(bestHistorical as any);
    matchedDocType  = bestHistorical.candidateType;
    matchedDocId    = bestHistorical.candidateId;
    finalConfidence = bestHistorical.confidence / 100;
    requiresReview  = true;
  }
  // 4. Rule engine match
  else if (ruleResult.matched && ruleResult.action) {
    method              = "RULE_ENGINE";
    finalAccountType    = ruleResult.action.suggestedAccountType;
    finalAccountSubtype = ruleResult.action.suggestedAccountSubtype;
    finalConfidence     = (ruleResult.action.confidence ?? 70) / 100;
    requiresReview      = finalConfidence < 0.85;
  }
  // 5. Tidak ada match
  else {
    method          = "NO_MATCH";
    finalConfidence = 0;
    requiresReview  = true;
    warnings.push("Tidak ada ERP document, historical, atau rule match yang cukup kuat.");
  }

  // Jika ERP tidak match tapi rule match tersedia, gunakan rule untuk COA hint
  if (method !== "ERP_DOCUMENT_MATCH" && ruleResult.matched && ruleResult.action) {
    if (!finalAccountType) finalAccountType    = ruleResult.action.suggestedAccountType;
    if (!finalAccountSubtype) finalAccountSubtype = ruleResult.action.suggestedAccountSubtype;
  }

  // ── COA Resolution ──────────────────────────────────────────────────────────
  const coaResult = await resolveCoa(companyId, finalAccountType, finalAccountSubtype);
  if (coaResult.warnings.length) {
    warnings.push(...coaResult.warnings);
  }

  // ── Classification ──────────────────────────────────────────────────────────
  const classification = deriveClassification(direction, matchedDocType, finalAccountType);

  // ── Final recommendation ────────────────────────────────────────────────────
  const finalRecommendation: Phase4Output["finalRecommendation"] = {
    classification,
    expenseCategoryId: null,   // Diisi oleh lapisan AI di Phase 5 atau manual
    suggestedCoaId:    coaResult.coaId,
    suggestedCoaCode:  coaResult.coaCode,
    vendorId:          null,   // Akan di-resolve dari ERP doc jika tersedia
    matchedDocumentType: matchedDocType,
    matchedDocumentId:   matchedDocId,
    confidence:        Math.round(finalConfidence * 100) / 100,
    method,
    requiresReview,
  };

  logger.info(
    {
      mutationId,
      method,
      confidence: finalConfidence,
      erpMatched: erpMatch.matched,
      histConfidence: bestHistorical?.confidence ?? 0,
      ruleMatched: ruleResult.matched,
    },
    "[phase4RecommendationEngine] rekomendasi selesai",
  );

  return {
    mutationId,
    ruleResult,
    erpMatch: erpOut,
    historicalMatch: histOut,
    finalRecommendation,
    warnings,
  };
}
