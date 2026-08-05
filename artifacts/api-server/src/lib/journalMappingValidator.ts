/**
 * Journal Mapping Validator — Task #6: Fail-Closed Journal Mapping
 *
 * Reusable validator that enforces fail-closed behavior for journal account mappings.
 *
 * Separation of concerns:
 *   Task #5 — account VALIDITY  (active, postable, effective date, company scope)
 *   Task #6 — specific MAPPING availability (no generic fallback allowed)
 *
 * Both layers must pass before a journal entry may be created.
 */

import { db } from "@workspace/db";
import { chartOfAccountsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { JournalMappingError } from "./journalMappingErrors.js";
import type { JournalMappingErrorCode } from "./journalMappingErrors.js";

// ── Input / output types ───────────────────────────────────────────────────────

export interface JournalMappingValidatorInput {
  companyId: number;
  /** Resolved account ID (preferred — use when you already have the DB id). */
  accountId?: number | null;
  /** Alternative: lookup by code when id is not available. */
  accountCode?: string | null;
  /** ISO date string or Date object for effective-date range checks. */
  transactionDate: Date | string;
  /** Human-readable context for error messages (e.g. "sport_center_refund"). */
  mappingContext: string;
  /** Semantic intent for error messages (e.g. "EXPENSE", "BANK_PAYMENT"). */
  detectedIntent: string;
  /**
   * When true, the validator rejects any account whose code matches a
   * known generic fallback pattern (5-2040, 1-1020, 2-1020) unless the
   * account was explicitly supplied via a specific mapping lookup.
   *
   * Set to true in all automated journal creation paths.
   * Set to false only for manual journal entries where the user explicitly
   * picks an account from the COA tree.
   */
  requireSpecificMapping?: boolean;
}

export interface ValidatedAccount {
  id: number;
  code: string;
  name: string;
  type: string;
  companyId: number | null;
}

// ── Known generic fallback codes that must not be auto-selected ────────────────

const GENERIC_FALLBACK_CODES = new Set(["5-2040", "1-1020", "2-1020"]);

function isGenericFallback(code: string): boolean {
  // Exact match OR prefix match (5-2040-CST, 1-1020-WS, etc.)
  for (const g of GENERIC_FALLBACK_CODES) {
    if (code === g || code.startsWith(g + "-")) return true;
  }
  return false;
}

// ── Main validator ─────────────────────────────────────────────────────────────

/**
 * validateJournalAccountMapping
 *
 * Validates that an account is suitable for journal posting under the
 * fail-closed policy introduced in Task #6.
 *
 * Throws JournalMappingError on any validation failure.
 * Returns { ok: true, account } on success.
 *
 * @example
 *   const { account } = await validateJournalAccountMapping({
 *     companyId: 1,
 *     accountId: expenseAccountId,
 *     transactionDate: new Date(),
 *     mappingContext: "sport_center_refund",
 *     detectedIntent: "EXPENSE",
 *     requireSpecificMapping: true,
 *   });
 *   // account is safe to use for posting
 */
export async function validateJournalAccountMapping(
  input: JournalMappingValidatorInput,
): Promise<{ ok: true; account: ValidatedAccount }> {
  const { companyId, accountId, accountCode, mappingContext, detectedIntent } = input;

  // ── 1. Must have at least one identifier ────────────────────────────────────
  if (accountId == null && !accountCode) {
    throw new JournalMappingError(
      "COA_NOT_FOUND",
      `COA tidak tersedia untuk "${mappingContext}" (intent: ${detectedIntent}). Jurnal tidak dapat dibuat — butuh review manual.`,
      { mappingContext, detectedIntent },
    );
  }

  // ── 2. Lookup account ────────────────────────────────────────────────────────
  const rows = accountId != null
    ? await db
        .select()
        .from(chartOfAccountsTable)
        .where(eq(chartOfAccountsTable.id, accountId))
        .limit(1)
    : await db
        .select()
        .from(chartOfAccountsTable)
        .where(sql`${chartOfAccountsTable.code} = ${accountCode!}`)
        .limit(1);

  const account = rows[0];

  if (!account) {
    throw new JournalMappingError(
      "COA_NOT_FOUND",
      `Akun COA ${accountId ?? accountCode} tidak ditemukan. Konteks: ${mappingContext}.`,
      { accountId, accountCode, mappingContext },
    );
  }

  // ── 3. Company match ─────────────────────────────────────────────────────────
  if (account.companyId !== null && account.companyId !== companyId) {
    throw new JournalMappingError(
      "COA_COMPANY_MISMATCH",
      `Akun "${account.code} — ${account.name}" milik perusahaan ${account.companyId}, bukan ${companyId}. Gunakan COA yang sesuai perusahaan.`,
      { accountCode: account.code, accountCompanyId: account.companyId, requestedCompanyId: companyId },
    );
  }

  // ── 4. Status ACTIVE ─────────────────────────────────────────────────────────
  if (account.status !== "ACTIVE") {
    throw new JournalMappingError(
      "COA_INACTIVE",
      `Akun "${account.code} — ${account.name}" status=${account.status}. Hanya akun berstatus ACTIVE yang dapat diposting.`,
      { accountCode: account.code, status: account.status },
    );
  }

  // ── 5. isPostable = true ─────────────────────────────────────────────────────
  if (!account.isPostable) {
    throw new JournalMappingError(
      "COA_NOT_POSTABLE",
      `Akun "${account.code} — ${account.name}" adalah akun non-postable (is_postable=false). Jurnal tidak dapat dibuat.`,
      { accountCode: account.code },
    );
  }

  // ── 6. isHeader = false ──────────────────────────────────────────────────────
  if ((account as any).isHeader === true) {
    throw new JournalMappingError(
      "COA_HEADER_NOT_POSTABLE",
      `Akun "${account.code} — ${account.name}" adalah akun header dan tidak dapat digunakan untuk posting baris jurnal.`,
      { accountCode: account.code },
    );
  }

  // ── 7. Effective date range ──────────────────────────────────────────────────
  const now = input.transactionDate instanceof Date
    ? input.transactionDate
    : new Date(input.transactionDate);

  if (account.effectiveFrom && now < account.effectiveFrom) {
    throw new JournalMappingError(
      "COA_EFFECTIVE_DATE_INVALID",
      `Akun "${account.code}" belum efektif (berlaku mulai ${account.effectiveFrom.toISOString().slice(0, 10)}). Tanggal transaksi: ${now.toISOString().slice(0, 10)}.`,
      { accountCode: account.code, effectiveFrom: account.effectiveFrom.toISOString() },
    );
  }
  if (account.effectiveTo && now > account.effectiveTo) {
    throw new JournalMappingError(
      "COA_EFFECTIVE_DATE_INVALID",
      `Akun "${account.code}" sudah kadaluwarsa (berlaku sampai ${account.effectiveTo.toISOString().slice(0, 10)}).`,
      { accountCode: account.code, effectiveTo: account.effectiveTo.toISOString() },
    );
  }

  // ── 8. Specific mapping required ─────────────────────────────────────────────
  if (input.requireSpecificMapping && isGenericFallback(account.code)) {
    throw new JournalMappingError(
      "SPECIFIC_COA_REQUIRED",
      `COA spesifik belum tersedia untuk "${mappingContext}" (intent: ${detectedIntent}). ` +
      `Akun generik "${account.code} — ${account.name}" tidak dapat digunakan secara otomatis — ` +
      `konfigurasi COA spesifik terlebih dahulu atau lakukan review manual.`,
      { accountCode: account.code, mappingContext, detectedIntent },
    );
  }

  return {
    ok: true,
    account: {
      id:        account.id,
      code:      account.code,
      name:      account.name,
      type:      account.type,
      companyId: account.companyId,
    },
  };
}

/**
 * validateAccountId — lightweight variant when the account is already
 * resolved by a strict company-specific lookup (not a generic code).
 *
 * Use when you already know the accountId is company-specific and you only
 * need to verify it's active and postable, without the generic-code check.
 */
export async function validateAccountId(
  accountId: number | null | undefined,
  companyId: number,
  transactionDate: Date | string,
  mappingContext: string,
  detectedIntent: string,
): Promise<{ ok: true; account: ValidatedAccount }> {
  return validateJournalAccountMapping({
    companyId,
    accountId,
    transactionDate,
    mappingContext,
    detectedIntent,
    requireSpecificMapping: false,
  });
}

/**
 * Validate multiple account IDs in one call.
 * Throws on the first invalid account found.
 */
export async function validateAccountIds(
  accounts: Array<{ id: number | null | undefined; label: string }>,
  companyId: number,
  transactionDate: Date | string,
  mappingContext: string,
  detectedIntent: string,
): Promise<void> {
  for (const { id, label } of accounts) {
    await validateJournalAccountMapping({
      companyId,
      accountId: id,
      transactionDate,
      mappingContext: `${mappingContext}:${label}`,
      detectedIntent,
      requireSpecificMapping: false,
    });
  }
}
