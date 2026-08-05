/**
 * Fail-Closed Journal Mapping Validator — Task #6
 *
 * Provides typed error contract for journal COA validation.
 * All journal posting paths MUST use this contract:
 *
 *   - validateJournalAccount()  — validate a single COA for posting
 *   - requireSpecificCoa()      — assert a specific COA exists (no generic fallback)
 *
 * If a specific COA is not found:
 *   FAIL CLOSED — return typed error, do not post, do not fall back to generic.
 *
 * Safe: never exposes SQL, table names, or stack traces in error messages.
 */

// ─── Error codes ──────────────────────────────────────────────────────────────

export type JournalMappingErrorCode =
  | "COA_NOT_FOUND"
  | "SPECIFIC_COA_REQUIRED"
  | "JOURNAL_MAPPING_REQUIRED"
  | "COA_NOT_POSTABLE"
  | "COA_INACTIVE"
  | "COMPANY_MISMATCH"
  | "ACCOUNT_EFFECTIVE_DATE_INVALID";

// ─── Error class ──────────────────────────────────────────────────────────────

export class JournalMappingError extends Error {
  readonly code: JournalMappingErrorCode;
  readonly safeContext: Record<string, unknown>;

  constructor(
    code: JournalMappingErrorCode,
    message: string,
    safeContext: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "JournalMappingError";
    this.code = code;
    this.safeContext = safeContext;
    if (Error.captureStackTrace) Error.captureStackTrace(this, JournalMappingError);
  }
}

// ─── Human-readable messages (no SQL, no internals) ──────────────────────────

const ERROR_MESSAGES: Record<JournalMappingErrorCode, string> = {
  COA_NOT_FOUND:
    "Akun COA tidak ditemukan. Lengkapi Chart of Accounts sebelum memposting.",
  SPECIFIC_COA_REQUIRED:
    "COA spesifik diperlukan. Tidak dapat menggunakan akun generik untuk transaksi ini.",
  JOURNAL_MAPPING_REQUIRED:
    "Mapping jurnal tidak tersedia. Konfigurasikan mapping COA untuk kategori transaksi ini.",
  COA_NOT_POSTABLE:
    "Akun COA adalah akun header dan tidak dapat digunakan untuk posting. Gunakan akun leaf/detail.",
  COA_INACTIVE:
    "Akun COA tidak aktif. Aktifkan COA melalui proses governance sebelum memposting.",
  COMPANY_MISMATCH:
    "COA tidak sesuai dengan perusahaan transaksi. Pastikan mapping COA menggunakan akun dari perusahaan yang benar.",
  ACCOUNT_EFFECTIVE_DATE_INVALID:
    "Tanggal efektif COA tidak valid untuk tanggal transaksi ini.",
};

export function safeMessageForCode(code: JournalMappingErrorCode): string {
  return ERROR_MESSAGES[code];
}

// ─── Result type ──────────────────────────────────────────────────────────────

export type JournalAccountOk = {
  ok: true;
  accountId: number;
  code: string;
  name: string;
};

export type JournalAccountFail = {
  ok: false;
  errorCode: JournalMappingErrorCode;
  message: string;
};

export type JournalAccountResult = JournalAccountOk | JournalAccountFail;

// ─── Input for validateJournalAccount ────────────────────────────────────────

export interface JournalAccountInput {
  /** The COA row from chart_of_accounts */
  account: {
    id: number;
    code: string;
    name: string;
    companyId: number | null;
    isActive: boolean | null;
    isPostable: boolean | null;
    isHeader: boolean | null;
    effectiveFrom?: Date | string | null;
    effectiveTo?: Date | string | null;
    status?: string | null;
    normalBalance?: string | null;
  } | null | undefined;
  /** Company that owns the journal entry */
  companyId: number;
  /** Date of the journal entry (for effective-date check) */
  effectiveDate?: Date | string | null;
}

// ─── Core validator ───────────────────────────────────────────────────────────

/**
 * Validate a COA account for use in a journal entry.
 *
 * Checks in order:
 *   1. Account exists (COA_NOT_FOUND)
 *   2. Account is active (COA_INACTIVE)
 *   3. Account is not a header (COA_NOT_POSTABLE)
 *   4. Account isPostable (COA_NOT_POSTABLE)
 *   5. Company match — null companyId = global/shared, always allowed (COMPANY_MISMATCH)
 *   6. Effective date valid (ACCOUNT_EFFECTIVE_DATE_INVALID)
 *
 * Returns JournalAccountOk on success, JournalAccountFail on any violation.
 * Never throws — use validateJournalAccountOrThrow if you prefer exceptions.
 */
export function validateJournalAccount(input: JournalAccountInput): JournalAccountResult {
  const { account, companyId, effectiveDate } = input;

  // 1. Existence
  if (!account) {
    return { ok: false, errorCode: "COA_NOT_FOUND", message: ERROR_MESSAGES.COA_NOT_FOUND };
  }

  // 2. Active status (prefer governance `status` field; fall back to `isActive`)
  const isActive =
    account.status != null
      ? account.status === "ACTIVE"
      : (account.isActive ?? false);

  if (!isActive) {
    return { ok: false, errorCode: "COA_INACTIVE", message: ERROR_MESSAGES.COA_INACTIVE };
  }

  // 3. Not a header
  if (account.isHeader === true) {
    return { ok: false, errorCode: "COA_NOT_POSTABLE", message: ERROR_MESSAGES.COA_NOT_POSTABLE };
  }

  // 4. isPostable (only fails if explicitly false; null/undefined = unknown → not blocked here)
  if (account.isPostable === false) {
    return { ok: false, errorCode: "COA_NOT_POSTABLE", message: ERROR_MESSAGES.COA_NOT_POSTABLE };
  }

  // 5. Company match (companyId=null means global/shared — allowed for any company)
  if (account.companyId !== null && account.companyId !== companyId) {
    return { ok: false, errorCode: "COMPANY_MISMATCH", message: ERROR_MESSAGES.COMPANY_MISMATCH };
  }

  // 6. Effective date
  if (effectiveDate) {
    const txDate = effectiveDate instanceof Date ? effectiveDate : new Date(effectiveDate);
    if (!isNaN(txDate.getTime())) {
      if (account.effectiveFrom) {
        const from = account.effectiveFrom instanceof Date
          ? account.effectiveFrom
          : new Date(account.effectiveFrom);
        if (!isNaN(from.getTime()) && txDate < from) {
          return {
            ok: false,
            errorCode: "ACCOUNT_EFFECTIVE_DATE_INVALID",
            message: ERROR_MESSAGES.ACCOUNT_EFFECTIVE_DATE_INVALID,
          };
        }
      }
      if (account.effectiveTo) {
        const to = account.effectiveTo instanceof Date
          ? account.effectiveTo
          : new Date(account.effectiveTo);
        if (!isNaN(to.getTime()) && txDate > to) {
          return {
            ok: false,
            errorCode: "ACCOUNT_EFFECTIVE_DATE_INVALID",
            message: ERROR_MESSAGES.ACCOUNT_EFFECTIVE_DATE_INVALID,
          };
        }
      }
    }
  }

  return {
    ok: true,
    accountId: account.id,
    code: account.code,
    name: account.name,
  };
}

/**
 * Throws JournalMappingError if the account fails validation.
 * Convenience wrapper around validateJournalAccount.
 */
export function validateJournalAccountOrThrow(input: JournalAccountInput): JournalAccountOk {
  const result = validateJournalAccount(input);
  if (!result.ok) {
    throw new JournalMappingError(result.errorCode, result.message, {
      companyId: input.companyId,
      accountCode: input.account?.code,
    });
  }
  return result;
}

// ─── Require-specific-coa helper ─────────────────────────────────────────────

/**
 * Require a specific COA code for a journal entry.
 * Returns a typed fail result when the code maps to a generic account
 * (e.g. 5-2040, 1-1020, 2-1020) and no specific mapping exists.
 *
 * This is the core of fail-closed journal mapping:
 *   if specific COA not configured → SPECIFIC_COA_REQUIRED (never fall back to generic)
 */
export type RequireSpecificCoaInput = {
  /** Resolved COA code (from mapping or configuration) */
  resolvedCode: string | null | undefined;
  /** Category or context for the mapping (used in error context only) */
  category?: string | null;
  /** Company ID of the journal entry */
  companyId: number;
};

/** COA codes that must never be used as silent fallbacks */
const FORBIDDEN_GENERIC_CODES = new Set([
  "5-2040", // Beban Operasional Lain — too generic
  "1-1020", // Bank Mandiri / Bank fallback — use specific bank account
  "2-1020", // PPN Keluaran — use specific tax mapping
]);

export function isForbiddenGenericCode(code: string): boolean {
  // Treat any code that STARTS WITH a forbidden prefix as generic
  return FORBIDDEN_GENERIC_CODES.has(code) ||
    [...FORBIDDEN_GENERIC_CODES].some(prefix => code.startsWith(prefix + "-"));
}

export function requireSpecificCoaOrFail(input: RequireSpecificCoaInput): JournalAccountFail | null {
  if (!input.resolvedCode) {
    return {
      ok: false,
      errorCode: "JOURNAL_MAPPING_REQUIRED",
      message: ERROR_MESSAGES.JOURNAL_MAPPING_REQUIRED,
    };
  }
  if (isForbiddenGenericCode(input.resolvedCode)) {
    return {
      ok: false,
      errorCode: "SPECIFIC_COA_REQUIRED",
      message: ERROR_MESSAGES.SPECIFIC_COA_REQUIRED,
    };
  }
  return null; // code is acceptable
}

// ─── MANUAL_REVIEW_REQUIRED result helper ─────────────────────────────────────

/**
 * Standard result for bank reconciliation when COA is not available.
 * Caller must NOT create journal, NOT auto-approve.
 */
export interface ManualReviewResult {
  status: "MANUAL_REVIEW_REQUIRED";
  errorCode: JournalMappingErrorCode;
  message: string;
  detectedIntent?: string | null;
  reason: string;
}

export function buildManualReviewResult(
  errorCode: JournalMappingErrorCode,
  detectedIntent?: string | null,
): ManualReviewResult {
  return {
    status: "MANUAL_REVIEW_REQUIRED",
    errorCode,
    message: ERROR_MESSAGES[errorCode],
    detectedIntent: detectedIntent ?? null,
    reason: `Akun COA spesifik belum tersedia untuk intent "${detectedIntent ?? "UNKNOWN"}". ${ERROR_MESSAGES[errorCode]}`,
  };
}
