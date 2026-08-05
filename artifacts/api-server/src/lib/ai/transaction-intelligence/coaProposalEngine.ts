/**
 * AI COA Proposal Recommendation Engine — Task #7 Phase 6 + 7
 *
 * Pure engine. No DB access. No side effects. Deterministic.
 * requiresHumanApproval is ALWAYS literal true — never modified.
 *
 * Incorporates Phase 7 accounting policy:
 *   - Tax withholding → LIABILITY / CREDIT / BALANCE_SHEET
 *   - PPN Masukan     → ASSET / DEBIT / BALANCE_SHEET
 *   - PPN Keluaran    → LIABILITY / CREDIT / BALANCE_SHEET
 *   - Stamp duty      → EXPENSE / DEBIT / PROFIT_AND_LOSS
 *   - Tax penalty     → OTHER_EXPENSE / DEBIT / PROFIT_AND_LOSS
 *   - Bank fee        → EXPENSE / DEBIT / PROFIT_AND_LOSS
 *   - Interest income → OTHER_INCOME / CREDIT / PROFIT_AND_LOSS
 *   - Customer payment → AR / Clearing (NOT revenue)
 *   - Vendor payment   → AP / Clearing (NOT expense)
 *   - Internal transfer → Clearing / Interbank (NOT expense/revenue)
 */

import { type GapDetectionResult } from "./coaGapDetector.js";
import { type CoaAccountCategory } from "../../coa/coaValidation.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CoaFinancialStatement =
  | "BALANCE_SHEET"
  | "PROFIT_AND_LOSS"
  | "CASH_FLOW_SUPPORT"
  | "OFF_STATEMENT";

export interface ExistingAccount {
  id: number;
  code: string;
  name: string;
  accountCategory: CoaAccountCategory;
  normalBalance: "DEBIT" | "CREDIT";
  isHeader: boolean;
  isPostable: boolean;
  isActive: boolean;
  status: string;
  parentId: number | null;
  companyId: number | null;
}

export interface HistoricalDecision {
  intent: string;
  resolvedCategory: CoaAccountCategory;
  resolvedNormalBalance: "DEBIT" | "CREDIT";
  resolvedFinancialStatement: CoaFinancialStatement;
  occurrences: number;
  reviewerNotes?: string;
}

export interface ProposalRecommendationInput {
  companyId: number;
  gapResult: GapDetectionResult;
  mappingErrorCode?: string;
  detectedIntent: string;
  normalizedDescription: string;
  missingMappingType?: string;
  aiConfidence: number;
  historicalOccurrences: number;
  estimatedMonthlyUsage?: number;

  /** Full company COA tree (same-company only) */
  existingAccounts: ExistingAccount[];
  /** Past reviewer decisions for this company */
  historicalDecisions?: HistoricalDecision[];
  /** Optional code convention hint */
  codeConvention?: string;

  // Phase 1–4 AI outputs (optional enrichment)
  phase3PrimaryRecommendation?: {
    category?: CoaAccountCategory;
    normalBalance?: "DEBIT" | "CREDIT";
    financialStatement?: CoaFinancialStatement;
    confidence?: number;
  };
}

export interface AlternativeAccount {
  id?: number;
  code: string;
  name: string;
  category: CoaAccountCategory;
  normalBalance: "DEBIT" | "CREDIT";
  reason: string;
}

export interface ProposalRecommendation {
  proposedName: string;
  proposedCode: string;
  proposedParentId: number | null;
  proposedParentCode: string | null;
  proposedCategory: CoaAccountCategory;
  proposedNormalBalance: "DEBIT" | "CREDIT";
  proposedIsHeader: boolean;
  proposedIsPostable: boolean;
  proposedEffectiveFrom: string;       // ISO date string
  financialStatement: CoaFinancialStatement;
  confidence: number;                  // 0–100
  reason: string[];
  evidence: Array<{ type: string; description: string; data?: unknown }>;
  alternatives: AlternativeAccount[];
  impactAnalysis: {
    financialStatementImpact: string;
    trialBalanceImpact: string;
    journalMappingImpact: string;
    taxReportingImpact: string;
    cashFlowImpact: string;
  };
  requiresHumanApproval: true;        // ALWAYS literal true
}

// ── Accounting policy rules (Phase 7) ────────────────────────────────────────

interface PolicyRule {
  pattern: RegExp;
  name: string;
  category: CoaAccountCategory;
  normalBalance: "DEBIT" | "CREDIT";
  financialStatement: CoaFinancialStatement;
  isPostable: boolean;
  isHeader: boolean;
  confidence: number;
}

const ACCOUNTING_POLICY_RULES: PolicyRule[] = [
  // Tax withholding liabilities
  {
    pattern: /pph.?21|pph.?23|pph.?26|pph.?4.*2|hutang.*pajak|withholding.?tax/i,
    name: "Hutang PPh Potong",
    category: "LIABILITY",
    normalBalance: "CREDIT",
    financialStatement: "BALANCE_SHEET",
    isPostable: true,
    isHeader: false,
    confidence: 90,
  },
  // PPN Masukan (input tax / receivable)
  {
    pattern: /ppn.?masukan|input.?tax|vat.?in/i,
    name: "PPN Masukan",
    category: "ASSET",
    normalBalance: "DEBIT",
    financialStatement: "BALANCE_SHEET",
    isPostable: true,
    isHeader: false,
    confidence: 90,
  },
  // PPN Keluaran (output tax / payable)
  {
    pattern: /ppn.?keluaran|output.?vat|vat.?out/i,
    name: "PPN Keluaran",
    category: "LIABILITY",
    normalBalance: "CREDIT",
    financialStatement: "BALANCE_SHEET",
    isPostable: true,
    isHeader: false,
    confidence: 90,
  },
  // Stamp duty / bea materai
  {
    pattern: /bea.?materai|stamp.?duty/i,
    name: "Biaya Bea Materai",
    category: "EXPENSE",
    normalBalance: "DEBIT",
    financialStatement: "PROFIT_AND_LOSS",
    isPostable: true,
    isHeader: false,
    confidence: 88,
  },
  // Tax penalty
  {
    pattern: /denda.?pajak|sanksi.?pajak|tax.?penalty|bunga.?pajak/i,
    name: "Denda / Sanksi Pajak",
    category: "OTHER_EXPENSE",
    normalBalance: "DEBIT",
    financialStatement: "PROFIT_AND_LOSS",
    isPostable: true,
    isHeader: false,
    confidence: 85,
  },
  // Bank fee / admin charges
  {
    pattern: /biaya.?admin|bank.?fee|admin.?bank|biaya.?transfer|service.?charge/i,
    name: "Biaya Administrasi Bank",
    category: "EXPENSE",
    normalBalance: "DEBIT",
    financialStatement: "PROFIT_AND_LOSS",
    isPostable: true,
    isHeader: false,
    confidence: 88,
  },
  // PPh Final atas bunga bank (pajak dipotong bank atas jasa giro/bunga deposito)
  {
    pattern: /pph.?final.*bunga|pajak.*bunga.?bank|pph.*jasa.?giro|beban.?pph.?final.*bunga|pot.?pajak.?bunga|debet.?pajak.?bunga|interest.?tax.?withholding|pph.?4.*2.*bunga/i,
    name: "Beban PPh Final atas Bunga Bank",
    category: "EXPENSE",
    normalBalance: "DEBIT",
    financialStatement: "PROFIT_AND_LOSS",
    isPostable: true,
    isHeader: false,
    confidence: 92,
  },
  // Interest income
  {
    pattern: /jasa.?giro|bunga.?deposito|interest.?income|pendapatan.?bunga/i,
    name: "Pendapatan Bunga",
    category: "OTHER_INCOME",
    normalBalance: "CREDIT",
    financialStatement: "PROFIT_AND_LOSS",
    isPostable: true,
    isHeader: false,
    confidence: 88,
  },
  // Customer payment → AR / clearing (NOT revenue)
  {
    pattern: /customer.?payment|pembayaran.?pelanggan|penerimaan.?kas|customer.?receipt/i,
    name: "Piutang Dagang / Clearing",
    category: "ASSET",
    normalBalance: "DEBIT",
    financialStatement: "BALANCE_SHEET",
    isPostable: true,
    isHeader: false,
    confidence: 70,
  },
  // Vendor / AP payment → AP / clearing (NOT expense)
  {
    pattern: /vendor.?payment|pembayaran.?vendor|ap.?payment|hutang.?dagang/i,
    name: "Hutang Dagang / Clearing",
    category: "LIABILITY",
    normalBalance: "CREDIT",
    financialStatement: "BALANCE_SHEET",
    isPostable: true,
    isHeader: false,
    confidence: 70,
  },
  // Internal transfer → clearing (NOT expense/revenue)
  {
    pattern: /internal.?transfer|interbank|transfer.?antar.?bank|clearing.?account/i,
    name: "Rekening Antara / Clearing",
    category: "CLEARING",
    normalBalance: "DEBIT",
    financialStatement: "BALANCE_SHEET",
    isPostable: true,
    isHeader: false,
    confidence: 80,
  },
];

// ── Normal balance for category ───────────────────────────────────────────────

function defaultNormalBalance(category: CoaAccountCategory): "DEBIT" | "CREDIT" {
  const DEBIT_CATS: CoaAccountCategory[] = [
    "ASSET", "EXPENSE", "OTHER_EXPENSE", "CONTRA_LIABILITY", "CONTRA_REVENUE",
  ];
  return DEBIT_CATS.includes(category) ? "DEBIT" : "CREDIT";
}

function financialStatementForCategory(category: CoaAccountCategory): CoaFinancialStatement {
  if (["ASSET", "LIABILITY", "EQUITY", "CONTRA_ASSET", "CONTRA_LIABILITY"].includes(category)) {
    return "BALANCE_SHEET";
  }
  if (["REVENUE", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE", "CONTRA_REVENUE", "CONTRA_EXPENSE"].includes(category)) {
    return "PROFIT_AND_LOSS";
  }
  if (category === "CLEARING") return "BALANCE_SHEET";
  return "BALANCE_SHEET";
}

// ── Find best parent from existing accounts ───────────────────────────────────

function findBestParent(
  category: CoaAccountCategory,
  accounts: ExistingAccount[],
): ExistingAccount | null {
  // Find active header accounts in the same category
  const candidates = accounts.filter(
    (a) =>
      a.isActive &&
      a.isHeader &&
      !a.isPostable &&
      a.accountCategory === category &&
      a.companyId !== null,
  );
  if (candidates.length === 0) return null;
  // Return the one with the shortest code (most root-like parent)
  return candidates.sort((a, b) => a.code.length - b.code.length)[0] ?? null;
}

// ── Bank reference code detector ─────────────────────────────────────────────
//
// Bank mutations (BRI, Mandiri, BCA, etc.) often store a raw reference code
// as the transaction description, e.g. "20260728BMRIIDJA", "IBFT20260728001",
// "FT260728123456". These are useless as COA account names.
//
// A string is considered a bank reference when ALL of the following hold:
//   1. No whitespace (a real description usually has spaces)
//   2. All characters are uppercase letters, digits, or "/" and "-"
//   3. Length between 8 and 40 characters
//   4. Contains at least one digit (pure-letter words like "TRANSFER" are not refs)
//   5. Contains at least one uppercase letter run ≥ 3 (not just a number)
//
function looksLikeBankReference(s: string): boolean {
  if (!s) return false;
  const t = s.trim();
  if (t.length < 8 || t.length > 40) return false;
  if (/\s/.test(t)) return false;                     // spaces → real description
  if (!/^[A-Z0-9\-\/\.]+$/.test(t)) return false;    // lowercase or special chars → real desc
  if (!/\d/.test(t)) return false;                    // must have a digit
  if (!/[A-Z]{3,}/.test(t)) return false;             // must have a letter run ≥ 3
  return true;
}

// Category-based human-readable fallback names (Indonesian)
const CATEGORY_DEFAULT_NAMES: Partial<Record<CoaAccountCategory, string>> = {
  EXPENSE:          "Beban Lain-lain",
  OTHER_EXPENSE:    "Beban Non-Operasional",
  REVENUE:          "Pendapatan Lain-lain",
  OTHER_INCOME:     "Pendapatan Non-Operasional",
  ASSET:            "Aset Lainnya",
  LIABILITY:        "Kewajiban Lainnya",
  EQUITY:           "Modal Lainnya",
  CLEARING:         "Rekening Antara",
  CONTRA_ASSET:     "Kontra Aset",
  CONTRA_LIABILITY: "Kontra Kewajiban",
  CONTRA_REVENUE:   "Kontra Pendapatan",
  CONTRA_EXPENSE:   "Kontra Beban",
};

// ── Suggest name based on intent ──────────────────────────────────────────────

function suggestName(
  detectedIntent: string,
  normalizedDescription: string,
  policyMatch: PolicyRule | null,
  resolvedCategory?: CoaAccountCategory,
): string {
  // Policy rule wins — always a meaningful human name
  if (policyMatch) return policyMatch.name;

  const desc = normalizedDescription.trim();

  // Use the description only when it looks like real human text.
  // Bank reference codes (e.g. "20260728BMRIIDJA") would produce nonsense names,
  // so we skip them and fall back to a category-based name or intent.
  if (desc.length > 0 && !looksLikeBankReference(desc)) {
    return desc
      .replace(/_/g, " ")
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
      .substring(0, 80);
  }

  // Description is a raw bank reference or empty — use category default
  if (resolvedCategory) {
    const categoryName = CATEGORY_DEFAULT_NAMES[resolvedCategory];
    if (categoryName) return categoryName;
  }

  // Last resort: humanize the intent string
  return detectedIntent
    .replace(/_/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .substring(0, 80);
}

// ── Main engine ───────────────────────────────────────────────────────────────

/**
 * Generate a COA proposal recommendation.
 *
 * Pure function — deterministic, no I/O, no DB access.
 * requiresHumanApproval is ALWAYS true — never auto-approve.
 */
export function generateCoaProposalRecommendation(
  input: ProposalRecommendationInput,
): ProposalRecommendation {
  const {
    detectedIntent,
    normalizedDescription,
    existingAccounts,
    historicalDecisions,
    aiConfidence,
    historicalOccurrences,
    estimatedMonthlyUsage,
    gapResult,
    phase3PrimaryRecommendation,
  } = input;

  const reason: string[] = [...gapResult.reason];
  const evidence: ProposalRecommendation["evidence"] = [...gapResult.evidence];

  // ── Step 1: Apply accounting policy rules ─────────────────────────────────

  let policyMatch: PolicyRule | null = null;
  const searchText = `${detectedIntent} ${normalizedDescription}`;

  for (const rule of ACCOUNTING_POLICY_RULES) {
    if (rule.pattern.test(searchText)) {
      policyMatch = rule;
      reason.push(
        `Accounting policy match: "${rule.name}" → ${rule.category} / ${rule.normalBalance} / ${rule.financialStatement}`,
      );
      evidence.push({
        type: "ACCOUNTING_POLICY",
        description: `Policy rule matched: ${rule.pattern.source}`,
        data: { ruleName: rule.name, category: rule.category },
      });
      break;
    }
  }

  // ── Step 2: Historical reviewer decisions ─────────────────────────────────

  let historyMatch: HistoricalDecision | null = null;
  if (historicalDecisions) {
    historyMatch =
      historicalDecisions
        .filter((h) => h.intent === detectedIntent && h.occurrences >= 3)
        .sort((a, b) => b.occurrences - a.occurrences)[0] ?? null;

    if (historyMatch) {
      reason.push(
        `Historical pattern: "${detectedIntent}" resolved to ${historyMatch.resolvedCategory} (${historyMatch.occurrences}x).`,
      );
      evidence.push({
        type: "HISTORICAL_DECISION",
        description: `Reviewer previously resolved this intent ${historyMatch.occurrences} time(s).`,
        data: { intent: historyMatch.intent, category: historyMatch.resolvedCategory },
      });
    }
  }

  // ── Step 3: Phase 3 primary recommendation override ───────────────────────

  let phase3Category: CoaAccountCategory | null = null;
  if (
    phase3PrimaryRecommendation?.category &&
    (phase3PrimaryRecommendation.confidence ?? 0) >= 80 &&
    !policyMatch
  ) {
    phase3Category = phase3PrimaryRecommendation.category;
    reason.push(
      `Phase 3 AI recommendation: category=${phase3Category} (confidence=${phase3PrimaryRecommendation.confidence}).`,
    );
  }

  // ── Step 4: Resolve final category, normal balance, financial statement ───

  let resolvedCategory: CoaAccountCategory;
  let resolvedNormalBalance: "DEBIT" | "CREDIT";
  let resolvedFinancialStatement: CoaFinancialStatement;
  let resolvedIsPostable: boolean;
  let resolvedIsHeader: boolean;
  let resolvedConfidence: number;

  if (policyMatch) {
    resolvedCategory = policyMatch.category;
    resolvedNormalBalance = policyMatch.normalBalance;
    resolvedFinancialStatement = policyMatch.financialStatement;
    resolvedIsPostable = policyMatch.isPostable;
    resolvedIsHeader = policyMatch.isHeader;
    resolvedConfidence = Math.min(aiConfidence, policyMatch.confidence);
  } else if (historyMatch) {
    resolvedCategory = historyMatch.resolvedCategory;
    resolvedNormalBalance = historyMatch.resolvedNormalBalance;
    resolvedFinancialStatement = historyMatch.resolvedFinancialStatement;
    resolvedIsPostable = true;
    resolvedIsHeader = false;
    resolvedConfidence = Math.min(aiConfidence, 78);
  } else if (phase3Category) {
    resolvedCategory = phase3Category;
    resolvedNormalBalance =
      phase3PrimaryRecommendation?.normalBalance ?? defaultNormalBalance(phase3Category);
    resolvedFinancialStatement =
      phase3PrimaryRecommendation?.financialStatement ??
      financialStatementForCategory(phase3Category);
    resolvedIsPostable = true;
    resolvedIsHeader = false;
    resolvedConfidence = Math.min(aiConfidence, phase3PrimaryRecommendation?.confidence ?? 65);
  } else {
    // Default to EXPENSE for unknown — low confidence; human must verify
    resolvedCategory = "EXPENSE";
    resolvedNormalBalance = "DEBIT";
    resolvedFinancialStatement = "PROFIT_AND_LOSS";
    resolvedIsPostable = true;
    resolvedIsHeader = false;
    resolvedConfidence = Math.min(aiConfidence, 40);
    reason.push(
      "No accounting policy or historical match. Defaulting to EXPENSE — requires human review.",
    );
  }

  // ── Step 5: Find parent account ───────────────────────────────────────────

  const parentAccount = findBestParent(resolvedCategory, existingAccounts);

  // ── Step 6: Suggest proposed name ─────────────────────────────────────────

  const proposedName = suggestName(detectedIntent, normalizedDescription, policyMatch, resolvedCategory);

  // ── Step 7: Build alternative accounts ───────────────────────────────────

  const alternatives: AlternativeAccount[] = existingAccounts
    .filter(
      (a) =>
        a.isActive &&
        a.isPostable &&
        !a.isHeader &&
        a.accountCategory === resolvedCategory,
    )
    .slice(0, 5)
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      category: a.accountCategory,
      normalBalance: a.normalBalance,
      reason: `Existing ${resolvedCategory} account — consider using this before creating a new one.`,
    }));

  // ── Step 8: Impact analysis ───────────────────────────────────────────────

  const impactAnalysis = {
    financialStatementImpact:
      `New account will appear in ${resolvedFinancialStatement} as ${resolvedCategory}.`,
    trialBalanceImpact:
      `Will appear in trial balance as ${resolvedNormalBalance}-balance account.`,
    journalMappingImpact:
      `Journal mapping for intent "${detectedIntent}" will be updated after approval.`,
    taxReportingImpact:
      resolvedCategory === "LIABILITY" &&
      /pph|ppn|tax|pajak/i.test(searchText)
        ? "Tax liability account — may appear in tax reporting."
        : "No direct tax reporting impact detected.",
    cashFlowImpact:
      resolvedCategory === "CLEARING"
        ? "Clearing account — should be zero balance at period end."
        : "No direct cash flow statement impact.",
  };

  // ── Step 9: Placeholder code (final code via suggestCoaCode in service layer) ─
  // Left empty — the service calls suggestCoaCode() for a deterministic code.
  // No Math.random(), no Date.now() in this pure engine.
  const proposedCode = "";

  return {
    proposedName,
    proposedCode,
    proposedParentId: parentAccount?.id ?? null,
    proposedParentCode: parentAccount?.code ?? null,
    proposedCategory: resolvedCategory,
    proposedNormalBalance: resolvedNormalBalance,
    proposedIsHeader: resolvedIsHeader,
    proposedIsPostable: resolvedIsPostable,
    proposedEffectiveFrom: new Date().toISOString().split("T")[0]!,
    financialStatement: resolvedFinancialStatement,
    confidence: resolvedConfidence,
    reason,
    evidence,
    alternatives,
    impactAnalysis,
    requiresHumanApproval: true,   // ALWAYS literal true — never remove
  };
}
