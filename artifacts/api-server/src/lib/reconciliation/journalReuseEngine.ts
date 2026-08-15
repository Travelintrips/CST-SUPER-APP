/**
 * Universal Journal Reuse Engine
 *
 * Single responsibility: given an economic event (bank mutation + matched candidate),
 * determine whether an existing accounting entry should be reused, a new one created,
 * or the mutation flagged for manual review.
 *
 * CONTRACT:
 *  - This engine NEVER creates, updates, or deletes any record.
 *  - It is DETERMINISTIC: same inputs → same decision.
 *  - It FAILS CLOSED: any lookup error → MANUAL_REVIEW_REQUIRED (never silent empty).
 *  - It is COMPANY-SCOPED: cross-company reuse is forbidden.
 *  - All DB queries are passed the caller's transaction client so they participate in the
 *    same snapshot/lock as the surrounding transaction.
 *
 * Decision contract (Phase 6):
 *   REUSE_EXISTING_JOURNAL   — valid posted journal (or unlinked draft) found for this economic event
 *   CREATE_NEW_JOURNAL       — no existing journal; safe to create draft
 *   MANUAL_REVIEW_REQUIRED   — ambiguous, error, or conditions not met; block action
 *   REJECT_DUPLICATE         — same economic event already fully reconciled to another mutation
 *
 * Note on draft journals: a draft journal that is NOT yet linked to any bank mutation
 * represents a provisional accounting entry (e.g. created by the sport center module
 * when a payment is recorded). Bank reconciliation CONFIRMS this provisional entry.
 * If amount matches and no other mutation has claimed it → REUSE_EXISTING_JOURNAL.
 * If the draft is already claimed by another mutation, or the amount mismatches → MANUAL_REVIEW_REQUIRED.
 */

import { sql } from "drizzle-orm";
import type { ReconciliationCandidateSource } from "@workspace/db";
import { logger } from "../logger.js";
import type { DbClient } from "../accounting.js";

// ─── Decision contract ────────────────────────────────────────────────────────

export type JournalResolutionDecision =
  | "REUSE_EXISTING_JOURNAL"
  | "CREATE_NEW_JOURNAL"
  | "MANUAL_REVIEW_REQUIRED"
  | "REJECT_DUPLICATE";

export interface JournalResolutionResult {
  decision: JournalResolutionDecision;
  companyId: number | null;
  economicEventType: string;
  existingJournalId: number | null;
  existingJournalNumber: string | null;
  sourceDocumentId: number | null;
  matchedCandidateType: string | null;
  confidence: number; // 0–100
  reasons: string[];
  evidence: Record<string, unknown>;
  duplicateRisk: "none" | "low" | "medium" | "high";
  requiresHumanReview: boolean;
  safeToCreateJournal: boolean;
}

// ─── Typed reuse error codes (Phase 20) ──────────────────────────────────────

export const JournalReuseErrorCode = {
  JOURNAL_REUSE_LOOKUP_FAILED:       "JOURNAL_REUSE_LOOKUP_FAILED",
  EXISTING_JOURNAL_FOUND:            "EXISTING_JOURNAL_FOUND",
  ECONOMIC_EVENT_DUPLICATE:          "ECONOMIC_EVENT_DUPLICATE",
  ECONOMIC_EVENT_AMBIGUOUS:          "ECONOMIC_EVENT_AMBIGUOUS",
  JOURNAL_REUSE_COMPANY_MISMATCH:    "JOURNAL_REUSE_COMPANY_MISMATCH",
  JOURNAL_REUSE_INVALID_STATUS:      "JOURNAL_REUSE_INVALID_STATUS",
  JOURNAL_REUSE_AMOUNT_MISMATCH:     "JOURNAL_REUSE_AMOUNT_MISMATCH",
  JOURNAL_REUSE_ALREADY_RECONCILED:  "JOURNAL_REUSE_ALREADY_RECONCILED",
  JOURNAL_REUSE_DUPLICATE_MUTATION:  "JOURNAL_REUSE_DUPLICATE_MUTATION",
  MANUAL_REVIEW_REQUIRED:            "MANUAL_REVIEW_REQUIRED",
  CANONICAL_SETTLEMENT_ADAPTER_NOT_IMPLEMENTED: "CANONICAL_SETTLEMENT_ADAPTER_NOT_IMPLEMENTED",
  AMBIGUOUS_QRIS_SETTLEMENT_SOURCE: "AMBIGUOUS_QRIS_SETTLEMENT_SOURCE",
} as const;

export type JournalReuseErrorCode =
  typeof JournalReuseErrorCode[keyof typeof JournalReuseErrorCode];

// Internal representation of a found journal entry
interface FoundEntry {
  id: number;
  entryNumber: string;
  status: string;
  companyId: number | null;
  totalDebit: number;
  isVoided: boolean;
  isReversed: boolean;
  reconciledMutationId: number | null;
}

// ─── Amount compatibility (within 1 IDR rounding tolerance) ──────────────────

function amountsCompatible(journalAmount: number, mutationAmount: number): boolean {
  const diff = Math.abs(journalAmount - Math.abs(mutationAmount));
  // Allow ±1 unit (rounding) and ±0.1% relative tolerance
  return diff <= 1 || diff / Math.max(Math.abs(mutationAmount), 1) <= 0.001;
}

// ─── Source adapter: sport_payment ───────────────────────────────────────────
// candidateId = sport_payments.id
// Relationship: accounting_payments.source_type='sport_center'
//               accounting_payments.source_doc_id = sport_payments.id
//               accounting_payments.entry_id → accounting_entries.id

async function resolveSportPaymentEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE) AS is_voided,
      COALESCE(ae.is_reversed, FALSE) AS is_reversed,
      bm_linked.id AS reconciled_mutation_id
    FROM accounting_payments ap
    JOIN accounting_entries ae ON ae.id = ap.entry_id
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.id IS DISTINCT FROM NULL
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ap.source_type = 'sport_center'
      AND ap.source_doc_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r["id"]),
    entryNumber: String(r["entry_number"] ?? ""),
    status: String(r["status"] ?? ""),
    companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
    totalDebit: Number(r["total_debit"] ?? 0),
    isVoided: Boolean(r["is_voided"]),
    isReversed: Boolean(r["is_reversed"]),
    reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: accounting_payment ──────────────────────────────────────
// candidateId = accounting_payments.id
// Relationship: accounting_payments.entry_id → accounting_entries.id

async function resolveAccountingPaymentEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE) AS is_voided,
      COALESCE(ae.is_reversed, FALSE) AS is_reversed,
      bm_linked.id AS reconciled_mutation_id
    FROM accounting_payments ap
    JOIN accounting_entries ae ON ae.id = ap.entry_id
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ap.id = ${candidateId}
      ${companyFilter}
    LIMIT 1
  `));
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r["id"]),
    entryNumber: String(r["entry_number"] ?? ""),
    status: String(r["status"] ?? ""),
    companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
    totalDebit: Number(r["total_debit"] ?? 0),
    isVoided: Boolean(r["is_voided"]),
    isReversed: Boolean(r["is_reversed"]),
    reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: invoice (sales_documents) ────────────────────────────────
// candidateId = sales_documents.id
// Relationship: accounting_entries.source IN ('sales_invoice', 'sales_payment')
//               accounting_entries.source_id = sales_documents.id

async function resolveInvoiceEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE) AS is_voided,
      COALESCE(ae.is_reversed, FALSE) AS is_reversed,
      bm_linked.id AS reconciled_mutation_id
    FROM accounting_entries ae
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ae.source IN ('sales_invoice', 'sales_payment')
      AND ae.source_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r["id"]),
    entryNumber: String(r["entry_number"] ?? ""),
    status: String(r["status"] ?? ""),
    companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
    totalDebit: Number(r["total_debit"] ?? 0),
    isVoided: Boolean(r["is_voided"]),
    isReversed: Boolean(r["is_reversed"]),
    reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: expense ──────────────────────────────────────────────────
// candidateId = expenses.id
// Relationship: accounting_entries.source = 'expense', source_id = expenses.id

async function resolveExpenseEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE) AS is_voided,
      COALESCE(ae.is_reversed, FALSE) AS is_reversed,
      bm_linked.id AS reconciled_mutation_id
    FROM accounting_entries ae
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ae.source = 'expense'
      AND ae.source_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r["id"]),
    entryNumber: String(r["entry_number"] ?? ""),
    status: String(r["status"] ?? ""),
    companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
    totalDebit: Number(r["total_debit"] ?? 0),
    isVoided: Boolean(r["is_voided"]),
    isReversed: Boolean(r["is_reversed"]),
    reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: logistic_order ──────────────────────────────────────────
// candidateId = logistic_orders.id
// Relationship: accounting_entries.source = 'logistic_vendor_cost', source_id = logistic_orders.id

async function resolveLogisticOrderEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE) AS is_voided,
      COALESCE(ae.is_reversed, FALSE) AS is_reversed,
      bm_linked.id AS reconciled_mutation_id
    FROM accounting_entries ae
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ae.source = 'logistic_vendor_cost'
      AND ae.source_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r["id"]),
    entryNumber: String(r["entry_number"] ?? ""),
    status: String(r["status"] ?? ""),
    companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
    totalDebit: Number(r["total_debit"] ?? 0),
    isVoided: Boolean(r["is_voided"]),
    isReversed: Boolean(r["is_reversed"]),
    reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: tenant_invoice ──────────────────────────────────────────
// candidateId = tenant_payments.id (or tenant_orders.id depending on context)
// Relationship: accounting_entries.source = 'tenant_rent_payment', source_id = tenant_payments.id

async function resolveTenantInvoiceEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE) AS is_voided,
      COALESCE(ae.is_reversed, FALSE) AS is_reversed,
      bm_linked.id AS reconciled_mutation_id
    FROM accounting_entries ae
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ae.source = 'tenant_rent_payment'
      AND ae.source_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r["id"]),
    entryNumber: String(r["entry_number"] ?? ""),
    status: String(r["status"] ?? ""),
    companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
    totalDebit: Number(r["total_debit"] ?? 0),
    isVoided: Boolean(r["is_voided"]),
    isReversed: Boolean(r["is_reversed"]),
    reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: cash_advance (Dana Talangan) ────────────────────────────
// candidateId = cash_advances.id
// Relationship: accounting_entries.source = 'kasbon', source_id = cash_advances.id
// Also fallback: cash_advances.entry_id directly (for disbursement journals)

async function resolveCashAdvanceEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  // Primary: accounting_entries.source='kasbon' + source_id
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE)    AS is_voided,
      COALESCE(ae.is_reversed, FALSE)  AS is_reversed,
      bm_linked.id                     AS reconciled_mutation_id
    FROM accounting_entries ae
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ae.source    = 'kasbon'
      AND ae.source_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (rows[0]) {
    const r = rows[0] as Record<string, unknown>;
    return {
      id: Number(r["id"]),
      entryNumber: String(r["entry_number"] ?? ""),
      status: String(r["status"] ?? ""),
      companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
      totalDebit: Number(r["total_debit"] ?? 0),
      isVoided: Boolean(r["is_voided"]),
      isReversed: Boolean(r["is_reversed"]),
      reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
    };
  }
  // Fallback: cash_advances.entry_id (stored at disbursement)
  const { rows: rows2 } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE)    AS is_voided,
      COALESCE(ae.is_reversed, FALSE)  AS is_reversed,
      bm_linked.id                     AS reconciled_mutation_id
    FROM cash_advances ca
    JOIN accounting_entries ae ON ae.id = ca.entry_id
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ca.id = ${candidateId}
      ${companyFilter}
    LIMIT 1
  `));
  if (!rows2[0]) return null;
  const r2 = rows2[0] as Record<string, unknown>;
  return {
    id: Number(r2["id"]),
    entryNumber: String(r2["entry_number"] ?? ""),
    status: String(r2["status"] ?? ""),
    companyId: r2["company_id"] != null ? Number(r2["company_id"]) : null,
    totalDebit: Number(r2["total_debit"] ?? 0),
    isVoided: Boolean(r2["is_voided"]),
    isReversed: Boolean(r2["is_reversed"]),
    reconciledMutationId: r2["reconciled_mutation_id"] != null ? Number(r2["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: treasury ─────────────────────────────────────────────────
// candidateId = accounting_payments.id (treasury transactions flow via AP)
// Relationship: accounting_payments.source_type = 'treasury', entry_id → accounting_entries.id
// Treasury is a read/analytics module; its transactions are recorded via accounting_payments.

async function resolveTreasuryEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  // Try via accounting_payments source_type='treasury'
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE)    AS is_voided,
      COALESCE(ae.is_reversed, FALSE)  AS is_reversed,
      bm_linked.id                     AS reconciled_mutation_id
    FROM accounting_payments ap
    JOIN accounting_entries ae ON ae.id = ap.entry_id
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ap.source_type = 'treasury'
      AND ap.source_doc_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (rows[0]) {
    const r = rows[0] as Record<string, unknown>;
    return {
      id: Number(r["id"]),
      entryNumber: String(r["entry_number"] ?? ""),
      status: String(r["status"] ?? ""),
      companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
      totalDebit: Number(r["total_debit"] ?? 0),
      isVoided: Boolean(r["is_voided"]),
      isReversed: Boolean(r["is_reversed"]),
      reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
    };
  }
  // Fallback: direct accounting_entries.source for treasury-specific source values
  const { rows: rows2 } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE)    AS is_voided,
      COALESCE(ae.is_reversed, FALSE)  AS is_reversed,
      bm_linked.id                     AS reconciled_mutation_id
    FROM accounting_entries ae
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ae.source IN ('treasury_transfer', 'treasury_deposit', 'treasury_withdrawal', 'treasury_receipt', 'treasury')
      AND ae.source_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (!rows2[0]) return null;
  const r2 = rows2[0] as Record<string, unknown>;
  return {
    id: Number(r2["id"]),
    entryNumber: String(r2["entry_number"] ?? ""),
    status: String(r2["status"] ?? ""),
    companyId: r2["company_id"] != null ? Number(r2["company_id"]) : null,
    totalDebit: Number(r2["total_debit"] ?? 0),
    isVoided: Boolean(r2["is_voided"]),
    isReversed: Boolean(r2["is_reversed"]),
    reconciledMutationId: r2["reconciled_mutation_id"] != null ? Number(r2["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: fixed_asset ─────────────────────────────────────────────
// candidateId = fixed_assets.id
// Relationship: fixed_assets.journal_entry_id → accounting_entries.id

async function resolveFixedAssetEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE)    AS is_voided,
      COALESCE(ae.is_reversed, FALSE)  AS is_reversed,
      bm_linked.id                     AS reconciled_mutation_id
    FROM fixed_assets fa
    JOIN accounting_entries ae ON ae.id = fa.journal_entry_id
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE fa.id = ${candidateId}
      ${companyFilter}
    LIMIT 1
  `));
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r["id"]),
    entryNumber: String(r["entry_number"] ?? ""),
    status: String(r["status"] ?? ""),
    companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
    totalDebit: Number(r["total_debit"] ?? 0),
    isVoided: Boolean(r["is_voided"]),
    isReversed: Boolean(r["is_reversed"]),
    reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: bank_loan ────────────────────────────────────────────────
// candidateId = bank_loans.id
// Relationship: bank_loans.journal_entry_id → accounting_entries.id

async function resolveBankLoanEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE)    AS is_voided,
      COALESCE(ae.is_reversed, FALSE)  AS is_reversed,
      bm_linked.id                     AS reconciled_mutation_id
    FROM bank_loans bl
    JOIN accounting_entries ae ON ae.id = bl.journal_entry_id
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE bl.id = ${candidateId}
      ${companyFilter}
    LIMIT 1
  `));
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r["id"]),
    entryNumber: String(r["entry_number"] ?? ""),
    status: String(r["status"] ?? ""),
    companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
    totalDebit: Number(r["total_debit"] ?? 0),
    isVoided: Boolean(r["is_voided"]),
    isReversed: Boolean(r["is_reversed"]),
    reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: bank_loan_payment ────────────────────────────────────────
// candidateId = bank_loan_payments.id
// Relationship: bank_loan_payments.journal_entry_id → accounting_entries.id

async function resolveBankLoanPaymentEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE)    AS is_voided,
      COALESCE(ae.is_reversed, FALSE)  AS is_reversed,
      bm_linked.id                     AS reconciled_mutation_id
    FROM bank_loan_payments blp
    JOIN accounting_entries ae ON ae.id = blp.journal_entry_id
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE blp.id = ${candidateId}
      ${companyFilter}
    LIMIT 1
  `));
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r["id"]),
    entryNumber: String(r["entry_number"] ?? ""),
    status: String(r["status"] ?? ""),
    companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
    totalDebit: Number(r["total_debit"] ?? 0),
    isVoided: Boolean(r["is_voided"]),
    isReversed: Boolean(r["is_reversed"]),
    reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: payroll ──────────────────────────────────────────────────
// candidateId = payroll_id (the payroll run ID)
// Relationship: accounting_entries.source IN ('payroll', 'hrd_salary_payment')
//               accounting_entries.source_id = payroll_id

async function resolvePayrollEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE)    AS is_voided,
      COALESCE(ae.is_reversed, FALSE)  AS is_reversed,
      bm_linked.id                     AS reconciled_mutation_id
    FROM accounting_entries ae
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ae.source IN ('payroll', 'hrd_salary_payment')
      AND ae.source_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r["id"]),
    entryNumber: String(r["entry_number"] ?? ""),
    status: String(r["status"] ?? ""),
    companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
    totalDebit: Number(r["total_debit"] ?? 0),
    isVoided: Boolean(r["is_voided"]),
    isReversed: Boolean(r["is_reversed"]),
    reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: ppjk (Customs / PPJK) ───────────────────────────────────
// candidateId = freight_customs_docs.id (PPJK document PK)
// Relationship: accounting_payments.source_type='ppjk', source_doc_id → entry_id
// Fallback: accounting_entries.source LIKE 'ppjk%', source_id = candidateId

async function resolvePpjkEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  // Primary: via accounting_payments source_type='ppjk'
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE)    AS is_voided,
      COALESCE(ae.is_reversed, FALSE)  AS is_reversed,
      bm_linked.id                     AS reconciled_mutation_id
    FROM accounting_payments ap
    JOIN accounting_entries ae ON ae.id = ap.entry_id
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ap.source_type = 'ppjk'
      AND ap.source_doc_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (rows[0]) {
    const r = rows[0] as Record<string, unknown>;
    return {
      id: Number(r["id"]),
      entryNumber: String(r["entry_number"] ?? ""),
      status: String(r["status"] ?? ""),
      companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
      totalDebit: Number(r["total_debit"] ?? 0),
      isVoided: Boolean(r["is_voided"]),
      isReversed: Boolean(r["is_reversed"]),
      reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
    };
  }
  // Fallback: accounting_entries source like 'ppjk_duty', 'ppjk_tax', etc.
  const { rows: rows2 } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE)    AS is_voided,
      COALESCE(ae.is_reversed, FALSE)  AS is_reversed,
      bm_linked.id                     AS reconciled_mutation_id
    FROM accounting_entries ae
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ae.source LIKE 'ppjk%'
      AND ae.source_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (!rows2[0]) return null;
  const r2 = rows2[0] as Record<string, unknown>;
  return {
    id: Number(r2["id"]),
    entryNumber: String(r2["entry_number"] ?? ""),
    status: String(r2["status"] ?? ""),
    companyId: r2["company_id"] != null ? Number(r2["company_id"]) : null,
    totalDebit: Number(r2["total_debit"] ?? 0),
    isVoided: Boolean(r2["is_voided"]),
    isReversed: Boolean(r2["is_reversed"]),
    reconciledMutationId: r2["reconciled_mutation_id"] != null ? Number(r2["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter: payment_gateway ─────────────────────────────────────────
// candidateId = sales_document.id or paylabs order ID
// Relationship: accounting_entries.source IN ('paylabs:webhook', 'paylabs:simulate-paid')
//               accounting_entries.source_id = candidateId

async function resolvePaymentGatewayEntry(
  client: DbClient,
  companyId: number | null,
  candidateId: number,
): Promise<FoundEntry | null> {
  const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
  const { rows } = await client.execute(sql.raw(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.status,
      ae.company_id,
      ae.total_debit,
      COALESCE(ae.is_voided, FALSE)    AS is_voided,
      COALESCE(ae.is_reversed, FALSE)  AS is_reversed,
      bm_linked.id                     AS reconciled_mutation_id
    FROM accounting_entries ae
    LEFT JOIN bank_mutations bm_linked
      ON bm_linked.journal_entry_id = ae.id
     AND bm_linked.status IN ('approved', 'posted')
    WHERE ae.source IN ('paylabs:webhook', 'paylabs:simulate-paid')
      AND ae.source_id = ${candidateId}
      ${companyFilter}
    ORDER BY ae.id DESC
    LIMIT 1
  `));
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: Number(r["id"]),
    entryNumber: String(r["entry_number"] ?? ""),
    status: String(r["status"] ?? ""),
    companyId: r["company_id"] != null ? Number(r["company_id"]) : null,
    totalDebit: Number(r["total_debit"] ?? 0),
    isVoided: Boolean(r["is_voided"]),
    isReversed: Boolean(r["is_reversed"]),
    reconciledMutationId: r["reconciled_mutation_id"] != null ? Number(r["reconciled_mutation_id"]) : null,
  };
}

// ─── Source adapter dispatch ──────────────────────────────────────────────────

async function lookupExistingEntry(
  client: DbClient,
  companyId: number | null,
  candidateType: string,
  candidateId: number,
  candidateSource: ReconciliationCandidateSource | null,
): Promise<FoundEntry | null> {
  switch (candidateType) {
    case "sport_payment":
      return resolveSportPaymentEntry(client, companyId, candidateId);
    case "qris_settlement": {
      // Phase 4C-2 deliberately does not adapt the canonical Sport Center
      // settlement batch. Never allow it (or a historical NULL source) to
      // fall through to the legacy public.qris_settlements journal lookup.
      if (candidateSource !== "public.qris_settlements") {
        return null;
      }
      // A settlement aggregate is not itself a revenue event. Reuse is only
      // safe when a dedicated settlement journal was explicitly created.
      const companyFilter = companyId != null ? `AND ae.company_id = ${companyId}` : "";
      const { rows } = await client.execute(sql.raw(`
        SELECT ae.id, ae.entry_number, ae.status, ae.company_id, ae.total_debit,
               COALESCE(ae.is_voided, FALSE) AS is_voided,
               COALESCE(ae.is_reversed, FALSE) AS is_reversed,
               bm_linked.id AS reconciled_mutation_id
        FROM accounting_entries ae
        LEFT JOIN bank_mutations bm_linked
          ON bm_linked.journal_entry_id = ae.id
         AND bm_linked.status IN ('approved', 'posted')
        WHERE ae.source = 'qris_settlement'
          AND ae.source_id = ${candidateId}
          ${companyFilter}
        ORDER BY ae.id DESC
        LIMIT 1
      `));
      if (!rows[0]) return null;
      const r = rows[0] as Record<string, unknown>;
      return {
        id: Number(r.id),
        entryNumber: String(r.entry_number ?? ""),
        status: String(r.status ?? ""),
        companyId: r.company_id != null ? Number(r.company_id) : null,
        totalDebit: Number(r.total_debit ?? 0),
        isVoided: Boolean(r.is_voided),
        isReversed: Boolean(r.is_reversed),
        reconciledMutationId: r.reconciled_mutation_id != null ? Number(r.reconciled_mutation_id) : null,
      };
    }
    case "accounting_payment":
      return resolveAccountingPaymentEntry(client, companyId, candidateId);
    case "invoice":
      return resolveInvoiceEntry(client, companyId, candidateId);
    case "expense":
      return resolveExpenseEntry(client, companyId, candidateId);
    case "logistic_order":
      return resolveLogisticOrderEntry(client, companyId, candidateId);
    case "tenant_invoice":
      return resolveTenantInvoiceEntry(client, companyId, candidateId);
    // ── Enterprise Coverage Phase ─────────────────────────────────────────────
    case "cash_advances":
    case "cash_advance":
      return resolveCashAdvanceEntry(client, companyId, candidateId);
    case "treasury":
      return resolveTreasuryEntry(client, companyId, candidateId);
    case "fixed_asset":
      return resolveFixedAssetEntry(client, companyId, candidateId);
    case "bank_loan":
      return resolveBankLoanEntry(client, companyId, candidateId);
    case "bank_loan_payment":
      return resolveBankLoanPaymentEntry(client, companyId, candidateId);
    case "payroll":
      return resolvePayrollEntry(client, companyId, candidateId);
    case "ppjk":
      return resolvePpjkEntry(client, companyId, candidateId);
    case "payment_gateway":
      return resolvePaymentGatewayEntry(client, companyId, candidateId);
    default:
      // Unknown candidate type — cannot verify, must review
      return null;
  }
}

// ─── Reusable status set ──────────────────────────────────────────────────────

const REUSABLE_STATUSES = new Set(["posted"]);
const DRAFT_STATUSES = new Set(["draft", "pending_approval", "approved_pending_posting"]);

// ─── Main engine ──────────────────────────────────────────────────────────────

export interface ResolveJournalArgs {
  /** Company from authenticated session — never from request body */
  companyId: number | null;
  /** Canonical candidate type from bank_reconciliation_matches */
  candidateType: string | null;
  /** Candidate entity PK */
  candidateId: number | null;
  /** Source-qualified QRIS identity; NULL is an ambiguous historical value. */
  candidateSource?: ReconciliationCandidateSource | null;
  /** bank_mutations.id being reconciled */
  mutationId: number;
  /** bank_mutations.amount (absolute value) */
  mutationAmount: number;
  /** bank_mutations.transaction_date YYYY-MM-DD */
  mutationDate: string;
}

/**
 * resolveJournalForEconomicEvent — Universal Journal Reuse Engine (Phase 7)
 *
 * Pure decision function. Call inside the same DB transaction as the approval
 * so the resolved state is consistent with the row locks acquired by FOR UPDATE.
 *
 * Never throws — all errors result in MANUAL_REVIEW_REQUIRED.
 */
export async function resolveJournalForEconomicEvent(
  client: DbClient,
  args: ResolveJournalArgs,
): Promise<JournalResolutionResult> {
  const {
    companyId, candidateType, candidateId, candidateSource = null,
    mutationId, mutationAmount, mutationDate,
  } = args;
  const reasons: string[] = [];
  const evidence: Record<string, unknown> = {
    mutationId,
    mutationAmount,
    mutationDate,
    candidateType,
    candidateId,
    candidateSource,
    companyId,
  };

  // ── Guard: missing candidate ──────────────────────────────────────────────
  if (!candidateType || candidateId == null) {
    return {
      decision: "CREATE_NEW_JOURNAL",
      companyId,
      economicEventType: "unknown",
      existingJournalId: null,
      existingJournalNumber: null,
      sourceDocumentId: null,
      matchedCandidateType: null,
      confidence: 50,
      reasons: ["No candidate selected — creating new journal for unmatched mutation"],
      evidence,
      duplicateRisk: "none",
      requiresHumanReview: false,
      safeToCreateJournal: true,
    };
  }

  // ── Source adapter dispatch — FAIL CLOSED on error ────────────────────────
  if (candidateType === "qris_settlement" && candidateSource !== "public.qris_settlements") {
    const code = candidateSource === "sport_center.payment_settlement_batches"
      ? JournalReuseErrorCode.CANONICAL_SETTLEMENT_ADAPTER_NOT_IMPLEMENTED
      : JournalReuseErrorCode.AMBIGUOUS_QRIS_SETTLEMENT_SOURCE;
    return {
      decision: "MANUAL_REVIEW_REQUIRED",
      companyId,
      economicEventType: candidateType,
      existingJournalId: null,
      existingJournalNumber: null,
      sourceDocumentId: candidateId,
      matchedCandidateType: candidateType,
      confidence: 0,
      reasons: [code === JournalReuseErrorCode.CANONICAL_SETTLEMENT_ADAPTER_NOT_IMPLEMENTED
        ? "Canonical Sport Center settlement requires dedicated link-only approval; generic journal reuse is forbidden"
        : "QRIS settlement source is ambiguous because candidate_source is NULL"],
      evidence: { ...evidence, code },
      duplicateRisk: "high",
      requiresHumanReview: true,
      safeToCreateJournal: false,
    };
  }

  let existingEntry: FoundEntry | null = null;
  let lookupError: string | null = null;

  try {
    existingEntry = await lookupExistingEntry(client, companyId, candidateType, candidateId, candidateSource);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lookupError = msg;
    logger.error(
      { err: msg, mutationId, candidateType, candidateId, companyId },
      "[journalReuseEngine] FAIL CLOSED — lookup error; routing to MANUAL_REVIEW_REQUIRED",
    );
    // FAIL CLOSED: any lookup error → manual review, never create journal
    return {
      decision: "MANUAL_REVIEW_REQUIRED",
      companyId,
      economicEventType: candidateType,
      existingJournalId: null,
      existingJournalNumber: null,
      sourceDocumentId: candidateId,
      matchedCandidateType: candidateType,
      confidence: 0,
      reasons: ["Journal lookup failed — cannot verify existing journal; manual review required"],
      evidence: { ...evidence, lookupError: "DB_ERROR" }, // no raw SQL/stack to client
      duplicateRisk: "high",
      requiresHumanReview: true,
      safeToCreateJournal: false,
    };
  }

  // ── No existing journal → safe to create (unless unknown type needs review) ─
  if (!existingEntry) {
    const knownTypes = new Set([
      "sport_payment", "accounting_payment", "invoice",
      "expense", "logistic_order", "tenant_invoice",
      // Enterprise coverage phase
      "cash_advances", "cash_advance",
      "treasury",
      "fixed_asset",
      "bank_loan", "bank_loan_payment",
      "payroll",
      "ppjk",
      "payment_gateway",
    ]);
    if (!knownTypes.has(candidateType)) {
      reasons.push(`Candidate type '${candidateType}' not mapped — cannot verify existing journal`);
      return {
        decision: "MANUAL_REVIEW_REQUIRED",
        companyId,
        economicEventType: candidateType,
        existingJournalId: null,
        existingJournalNumber: null,
        sourceDocumentId: candidateId,
        matchedCandidateType: candidateType,
        confidence: 30,
        reasons,
        evidence,
        duplicateRisk: "medium",
        requiresHumanReview: true,
        safeToCreateJournal: false,
      };
    }
    reasons.push("No existing journal found for this economic event");
    return {
      decision: "CREATE_NEW_JOURNAL",
      companyId,
      economicEventType: candidateType,
      existingJournalId: null,
      existingJournalNumber: null,
      sourceDocumentId: candidateId,
      matchedCandidateType: candidateType,
      confidence: 90,
      reasons,
      evidence,
      duplicateRisk: "none",
      requiresHumanReview: false,
      safeToCreateJournal: true,
    };
  }

  // ── Company mismatch → hard block ─────────────────────────────────────────
  if (companyId != null && existingEntry.companyId != null
      && existingEntry.companyId !== companyId) {
    return {
      decision: "MANUAL_REVIEW_REQUIRED",
      companyId,
      economicEventType: candidateType,
      existingJournalId: null,
      existingJournalNumber: null,
      sourceDocumentId: candidateId,
      matchedCandidateType: candidateType,
      confidence: 0,
      reasons: ["Existing journal belongs to a different company — cross-company reuse forbidden"],
      evidence: {
        ...evidence,
        code: JournalReuseErrorCode.JOURNAL_REUSE_COMPANY_MISMATCH,
        journalCompanyId: existingEntry.companyId,
      },
      duplicateRisk: "high",
      requiresHumanReview: true,
      safeToCreateJournal: false,
    };
  }

  // ── Voided journal → never reuse ─────────────────────────────────────────
  if (existingEntry.isVoided) {
    reasons.push("Existing journal is voided — cannot reuse");
    return {
      decision: "MANUAL_REVIEW_REQUIRED",
      companyId,
      economicEventType: candidateType,
      existingJournalId: existingEntry.id,
      existingJournalNumber: existingEntry.entryNumber,
      sourceDocumentId: candidateId,
      matchedCandidateType: candidateType,
      confidence: 10,
      reasons,
      evidence: { ...evidence, code: JournalReuseErrorCode.JOURNAL_REUSE_INVALID_STATUS, journalStatus: "voided" },
      duplicateRisk: "medium",
      requiresHumanReview: true,
      safeToCreateJournal: false,
    };
  }

  // ── Reversed journal → never reuse ───────────────────────────────────────
  if (existingEntry.isReversed) {
    reasons.push("Existing journal has been reversed — cannot reuse; check if re-posting is required");
    return {
      decision: "MANUAL_REVIEW_REQUIRED",
      companyId,
      economicEventType: candidateType,
      existingJournalId: existingEntry.id,
      existingJournalNumber: existingEntry.entryNumber,
      sourceDocumentId: candidateId,
      matchedCandidateType: candidateType,
      confidence: 10,
      reasons,
      evidence: { ...evidence, code: JournalReuseErrorCode.JOURNAL_REUSE_INVALID_STATUS, journalStatus: "reversed" },
      duplicateRisk: "medium",
      requiresHumanReview: true,
      safeToCreateJournal: false,
    };
  }

  // ── Draft journal — allow reuse only when not yet claimed by another mutation ───
  //
  // A draft journal created by an upstream module (e.g. sport center, payroll)
  // is a PROVISIONAL entry awaiting bank confirmation.  Bank reconciliation IS
  // that confirmation.
  //
  // Policy:
  //   draft + reconciledMutationId == null + amount matches  → REUSE_EXISTING_JOURNAL
  //   draft + reconciledMutationId != null (different mut)   → MANUAL_REVIEW_REQUIRED
  //   draft + amount mismatch                                → MANUAL_REVIEW_REQUIRED
  //   pending_approval / approved_pending_posting            → MANUAL_REVIEW_REQUIRED (under governance)
  if (existingEntry.status === "draft") {
    // Already claimed by a different bank mutation — block
    if (existingEntry.reconciledMutationId != null && existingEntry.reconciledMutationId !== mutationId) {
      reasons.push(
        `Draft journal already linked to bank mutation ${existingEntry.reconciledMutationId} — duplicate economic event`,
      );
      return {
        decision: "MANUAL_REVIEW_REQUIRED",
        companyId,
        economicEventType: candidateType,
        existingJournalId: existingEntry.id,
        existingJournalNumber: existingEntry.entryNumber,
        sourceDocumentId: candidateId,
        matchedCandidateType: candidateType,
        confidence: 10,
        reasons,
        evidence: { ...evidence, code: JournalReuseErrorCode.JOURNAL_REUSE_DUPLICATE_MUTATION },
        duplicateRisk: "high",
        requiresHumanReview: true,
        safeToCreateJournal: false,
      };
    }

    // Amount mismatch — different economic event, do not reuse
    const draftAmountDiff = Math.abs(existingEntry.totalDebit - mutationAmount);
    const draftAmountTolerance = Math.max(1, mutationAmount * 0.0001); // 0.01% or Rp 1
    if (draftAmountDiff > draftAmountTolerance) {
      reasons.push(
        `Draft journal amount ${existingEntry.totalDebit} ≠ mutation amount ${mutationAmount} (diff ${draftAmountDiff}) — different economic event`,
      );
      return {
        decision: "MANUAL_REVIEW_REQUIRED",
        companyId,
        economicEventType: candidateType,
        existingJournalId: existingEntry.id,
        existingJournalNumber: existingEntry.entryNumber,
        sourceDocumentId: candidateId,
        matchedCandidateType: candidateType,
        confidence: 20,
        reasons,
        evidence: {
          ...evidence,
          code: JournalReuseErrorCode.JOURNAL_REUSE_AMOUNT_MISMATCH,
          journalDebit: existingEntry.totalDebit,
          mutationAmount,
        },
        duplicateRisk: "medium",
        requiresHumanReview: true,
        safeToCreateJournal: false,
      };
    }

    // Unlinked draft with matching amount — bank reconciliation confirms provisional entry
    reasons.push(
      `Draft journal ${existingEntry.entryNumber} — unlinked, amount matches; bank reconciliation confirms provisional entry`,
    );
    return {
      decision: "REUSE_EXISTING_JOURNAL",
      companyId,
      economicEventType: candidateType,
      existingJournalId: existingEntry.id,
      existingJournalNumber: existingEntry.entryNumber,
      sourceDocumentId: candidateId,
      matchedCandidateType: candidateType,
      confidence: 75,
      reasons,
      evidence: { ...evidence, journalStatus: "draft", amountDiff: draftAmountDiff },
      duplicateRisk: "none",
      requiresHumanReview: false,
      safeToCreateJournal: false,
    };
  }

  // ── Other draft-like statuses (pending_approval, approved_pending_posting) ─────
  //    Under governance review — do not auto-reuse
  if (DRAFT_STATUSES.has(existingEntry.status)) {
    reasons.push(`Existing journal is in '${existingEntry.status}' state — under governance review; requires human action before reuse`);
    return {
      decision: "MANUAL_REVIEW_REQUIRED",
      companyId,
      economicEventType: candidateType,
      existingJournalId: existingEntry.id,
      existingJournalNumber: existingEntry.entryNumber,
      sourceDocumentId: candidateId,
      matchedCandidateType: candidateType,
      confidence: 40,
      reasons,
      evidence: { ...evidence, code: JournalReuseErrorCode.JOURNAL_REUSE_INVALID_STATUS, journalStatus: existingEntry.status },
      duplicateRisk: "medium",
      requiresHumanReview: true,
      safeToCreateJournal: false,
    };
  }

  // ── Non-posted, non-draft status → manual review ─────────────────────────
  if (!REUSABLE_STATUSES.has(existingEntry.status)) {
    reasons.push(`Existing journal has status '${existingEntry.status}' — only 'posted' journals can be reused`);
    return {
      decision: "MANUAL_REVIEW_REQUIRED",
      companyId,
      economicEventType: candidateType,
      existingJournalId: existingEntry.id,
      existingJournalNumber: existingEntry.entryNumber,
      sourceDocumentId: candidateId,
      matchedCandidateType: candidateType,
      confidence: 30,
      reasons,
      evidence: { ...evidence, code: JournalReuseErrorCode.JOURNAL_REUSE_INVALID_STATUS, journalStatus: existingEntry.status },
      duplicateRisk: "medium",
      requiresHumanReview: true,
      safeToCreateJournal: false,
    };
  }

  // ── Already linked to a DIFFERENT mutation → REJECT_DUPLICATE ────────────
  if (
    existingEntry.reconciledMutationId != null &&
    existingEntry.reconciledMutationId !== mutationId
  ) {
    reasons.push("Existing journal is already linked to a different bank mutation — duplicate economic event");
    return {
      decision: "REJECT_DUPLICATE",
      companyId,
      economicEventType: candidateType,
      existingJournalId: existingEntry.id,
      existingJournalNumber: existingEntry.entryNumber,
      sourceDocumentId: candidateId,
      matchedCandidateType: candidateType,
      confidence: 95,
      reasons,
      evidence: {
        ...evidence,
        code: JournalReuseErrorCode.JOURNAL_REUSE_ALREADY_RECONCILED,
        existingMutationId: existingEntry.reconciledMutationId,
      },
      duplicateRisk: "high",
      requiresHumanReview: true,
      safeToCreateJournal: false,
    };
  }

  // ── Amount compatibility check ────────────────────────────────────────────
  if (!amountsCompatible(existingEntry.totalDebit, mutationAmount)) {
    reasons.push(
      `Amount mismatch: journal=${existingEntry.totalDebit} vs mutation=${mutationAmount} — manual review required`,
    );
    return {
      decision: "MANUAL_REVIEW_REQUIRED",
      companyId,
      economicEventType: candidateType,
      existingJournalId: existingEntry.id,
      existingJournalNumber: existingEntry.entryNumber,
      sourceDocumentId: candidateId,
      matchedCandidateType: candidateType,
      confidence: 30,
      reasons,
      evidence: {
        ...evidence,
        code: JournalReuseErrorCode.JOURNAL_REUSE_AMOUNT_MISMATCH,
        journalAmount: existingEntry.totalDebit,
        mutationAmount,
      },
      duplicateRisk: "medium",
      requiresHumanReview: true,
      safeToCreateJournal: false,
    };
  }

  // ── All checks passed → REUSE_EXISTING_JOURNAL ───────────────────────────
  reasons.push(`Posted journal ${existingEntry.entryNumber} found for ${candidateType} #${candidateId}`);
  reasons.push("Company match ✓, status posted ✓, not voided ✓, not reversed ✓, amount compatible ✓");

  return {
    decision: "REUSE_EXISTING_JOURNAL",
    companyId,
    economicEventType: candidateType,
    existingJournalId: existingEntry.id,
    existingJournalNumber: existingEntry.entryNumber,
    sourceDocumentId: candidateId,
    matchedCandidateType: candidateType,
    confidence: 98,
    reasons,
    evidence: {
      ...evidence,
      journalId: existingEntry.id,
      journalNumber: existingEntry.entryNumber,
      journalStatus: existingEntry.status,
      journalAmount: existingEntry.totalDebit,
    },
    duplicateRisk: "none",
    requiresHumanReview: false,
    safeToCreateJournal: false, // reuse path: no new journal needed
  };
}
