/**
 * canonicalMutationKey — single source of truth for mutation deduplication keys.
 *
 * This module MUST be used by ALL import sources:
 *   - Google Sheet (sheetSyncService.ts)
 *   - CSV / Excel (bankFormatParsers.ts, bankReconciliation.ts)
 *   - API bank feed (bankMutationImport.ts)
 *   - Manual input
 *
 * Algorithm: SHA-256 over a pipe-delimited payload of 7 fields.
 * Using integer cents (×100) so floating-point rounding never produces
 * different hashes for the same monetary value.
 *
 * Field order is FIXED — changing it invalidates all existing keys.
 * Fields:
 *   company_id (0 if null) | bank_account_id (0 if null) |
 *   transaction_date (YYYY-MM-DD) | debit_cents | credit_cents |
 *   normalized_description (uppercase alnum+space) | bank_reference (uppercase)
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CanonicalKeyParams {
  /** YYYY-MM-DD (time portion is stripped if present) */
  transaction_date: string;
  /** Debit amount in IDR — use 0 for credit-only mutations */
  debit: number;
  /** Credit amount in IDR — use 0 for debit-only mutations */
  credit: number;
  /** Raw description — normalized internally (uppercase, alnum+space) */
  description: string;
  /** Bank-assigned reference / cheque number — use null/empty if unavailable */
  bank_reference?: string | null;
  /** ERP company ID — use null (treated as 0) for un-scoped imports */
  company_id?: number | null;
  /** Bank account ID from company_bank_accounts — null/0 if not yet assigned */
  bank_account_id?: number | null;
}

// ─── Normalize helper (exported for reuse in sheetSyncService) ────────────────

/**
 * Canonical description normalization.
 * Must produce identical output to the normalization used by sheetSyncService.ts.
 * Rule: uppercase, keep only A-Z, 0-9, space, collapse multiple spaces.
 */
export function canonicalNormalizeDesc(raw: string): string {
  return (raw ?? "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[^A-Z0-9 ]/g, "")
    .trim();
}

// ─── Canonical key ────────────────────────────────────────────────────────────

/**
 * Generate the canonical mutation key for any bank transaction.
 *
 * Guarantees:
 *   - Same transaction imported from Google Sheet AND CSV → identical key
 *   - Key is deterministic (no random, no timestamps)
 *   - Safe for concurrent concurrent use (pure function)
 *
 * @example
 * canonicalMutationKey({
 *   transaction_date: "2026-07-01",
 *   debit: 50000,
 *   credit: 0,
 *   description: "TRANSFER FROM PT ABC",
 *   company_id: 5,
 * })
 * // → "a3f2b1..." (64-char hex SHA-256)
 */
export function canonicalMutationKey(params: CanonicalKeyParams): string {
  const cid         = params.company_id      ?? 0;
  const aid         = params.bank_account_id ?? 0;
  const date        = (params.transaction_date ?? "").split("T")[0];  // strip time part
  const debitCents  = Math.round(Math.abs(params.debit  ?? 0) * 100);
  const creditCents = Math.round(Math.abs(params.credit ?? 0) * 100);
  const desc        = canonicalNormalizeDesc(params.description ?? "");
  const ref         = (params.bank_reference ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();

  const payload = `${cid}|${aid}|${date}|${debitCents}|${creditCents}|${desc}|${ref}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
