/**
 * COA Proposal Impact Analysis — Task #7 Phase 10
 *
 * Pure engine. Read-only simulation. No DB access. No writes. Deterministic.
 * Historical simulation is read-only — never modifies transactions or journals.
 */

import { type CoaAccountCategory } from "../../coa/coaValidation.js";
import { type CoaFinancialStatement } from "./coaProposalEngine.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HistoricalTransaction {
  id: number;
  amount: number;
  description: string;
  sourceType: string;
  date: string;
}

export interface ImpactAnalysisInput {
  companyId: number;
  proposedCategory: CoaAccountCategory;
  proposedNormalBalance: "DEBIT" | "CREDIT";
  proposedIsPostable: boolean;
  proposedIsHeader: boolean;
  financialStatement: CoaFinancialStatement;
  detectedIntent: string;
  historicalTransactions: HistoricalTransaction[];
  estimatedMonthlyUsage: number;
  missingMappingType?: string;
  mappingErrorCode?: string;
}

export interface ImpactAnalysisResult {
  financialStatementImpact: string;
  trialBalanceImpact: string;
  journalMappingImpact: string;
  taxReportingImpact: string;
  cashFlowImpact: string;
  historicalOccurrences: number;
  estimatedFutureUsage: number;
  affectedSourceTypes: string[];
  riskFlags: string[];
  backwardCompatibility: string;
}

// ── Main engine ───────────────────────────────────────────────────────────────

/**
 * Analyse the impact of creating a new COA account.
 *
 * Pure function — read-only historical simulation, no writes.
 */
export function analyzeCoaProposalImpact(input: ImpactAnalysisInput): ImpactAnalysisResult {
  const {
    proposedCategory,
    proposedNormalBalance,
    proposedIsPostable,
    proposedIsHeader,
    financialStatement,
    detectedIntent,
    historicalTransactions,
    estimatedMonthlyUsage,
    missingMappingType,
    mappingErrorCode,
  } = input;

  // ── Historical analysis (read-only) ──────────────────────────────────────
  const historicalOccurrences = historicalTransactions.length;
  const affectedSourceTypesSet = new Set<string>(
    historicalTransactions.map((t) => t.sourceType).filter(Boolean),
  );
  const affectedSourceTypes = [...affectedSourceTypesSet];

  const totalHistoricalAmount = historicalTransactions.reduce((sum, t) => sum + t.amount, 0);

  // ── Risk flags ────────────────────────────────────────────────────────────
  const riskFlags: string[] = [];

  if (proposedIsHeader && proposedIsPostable) {
    riskFlags.push("HEADER_AND_POSTABLE: Header accounts cannot be postable — validation will fail.");
  }

  if (historicalOccurrences === 0) {
    riskFlags.push(
      "NO_HISTORY: No historical transactions found for this intent — estimated usage is speculative.",
    );
  }

  if (proposedCategory === "CLEARING" && estimatedMonthlyUsage > 0) {
    riskFlags.push(
      "CLEARING_ACCOUNT: Ensure clearing account is zeroed at period end — unbalanced entries risk.",
    );
  }

  if (
    (proposedCategory === "REVENUE" || proposedCategory === "OTHER_INCOME") &&
    /payment|transfer|receipt/i.test(detectedIntent)
  ) {
    riskFlags.push(
      "REVENUE_FOR_PAYMENT: Revenue accounts should not map to customer payments directly — consider AR/Clearing.",
    );
  }

  if (
    (proposedCategory === "EXPENSE" || proposedCategory === "OTHER_EXPENSE") &&
    /vendor.?payment|ap.?payment/i.test(detectedIntent)
  ) {
    riskFlags.push(
      "EXPENSE_FOR_VENDOR_PAYMENT: Expense accounts should not map to vendor payments directly — consider AP/Clearing.",
    );
  }

  if (mappingErrorCode === "COA_MAPPING_AMBIGUOUS") {
    riskFlags.push(
      "AMBIGUOUS_MAPPING: Multiple candidate accounts exist. Review alternatives before creating new account.",
    );
  }

  // ── Financial statement impact ────────────────────────────────────────────
  const financialStatementImpact =
    `New ${proposedNormalBalance}-balance account (${proposedCategory}) will appear in the ${financialStatement}. ` +
    (historicalOccurrences > 0
      ? `Historical transactions (~${historicalOccurrences}) would have posted here.`
      : "No historical transactions identified for this mapping.");

  // ── Trial balance impact ──────────────────────────────────────────────────
  const trialBalanceImpact =
    `Account will appear as a ${proposedNormalBalance} item in the trial balance. ` +
    (proposedIsHeader
      ? "Header account — not postable directly."
      : `Postable account — can receive journal entries.`);

  // ── Journal mapping impact ────────────────────────────────────────────────
  const journalMappingImpact =
    `Intent "${detectedIntent}"` +
    (missingMappingType ? ` (missing mapping: ${missingMappingType})` : "") +
    " will map to this account after implementation and reviewer approval. " +
    (affectedSourceTypes.length > 0
      ? `Affected sources: ${affectedSourceTypes.join(", ")}.`
      : "No source modules currently affected.");

  // ── Tax reporting impact ──────────────────────────────────────────────────
  const taxReportingImpact =
    proposedCategory === "LIABILITY" && /ppn|pph|tax|pajak/i.test(detectedIntent)
      ? `Tax liability account — transactions may appear in PPh/PPN tax reports. Verify with tax team.`
      : proposedCategory === "ASSET" && /ppn.?masukan|input.?tax/i.test(detectedIntent)
        ? "Input tax asset account — may appear in VAT reconciliation reports."
        : "No direct tax reporting impact identified for this account category.";

  // ── Cash flow impact ──────────────────────────────────────────────────────
  const cashFlowImpact =
    proposedCategory === "CLEARING"
      ? "Clearing account — impacts operating cash flow presentation if not zeroed at period end."
      : financialStatement === "BALANCE_SHEET" && proposedCategory === "ASSET"
        ? "Asset account changes affect operating/investing activities in cash flow statement."
        : financialStatement === "PROFIT_AND_LOSS"
          ? "P&L account — impacts net income and operating cash flow (indirect method)."
          : "No direct cash flow statement impact identified.";

  // ── Backward compatibility ────────────────────────────────────────────────
  const backwardCompatibility =
    historicalOccurrences === 0
      ? "No historical transactions — no backward compatibility risk."
      : `${historicalOccurrences} historical transaction(s) (total ~${totalHistoricalAmount.toLocaleString()}) ` +
        `were NOT posted to this account (it didn't exist). They remain unchanged. ` +
        "New account applies only to future transactions after implementation.";

  return {
    financialStatementImpact,
    trialBalanceImpact,
    journalMappingImpact,
    taxReportingImpact,
    cashFlowImpact,
    historicalOccurrences,
    estimatedFutureUsage: estimatedMonthlyUsage,
    affectedSourceTypes,
    riskFlags,
    backwardCompatibility,
  };
}
