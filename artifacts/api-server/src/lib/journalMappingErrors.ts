/**
 * Typed Error Codes — Task #6: Fail-Closed Journal Mapping
 *
 * These error codes are used when journal mapping requires a specific COA but
 * none is available. They map to safe HTTP responses that expose NO internal
 * SQL, stack traces, schema details, or file paths.
 *
 * Separation of concerns:
 *   Task #5 — account VALIDITY (active, postable, effective date, company scope)
 *   Task #6 — specific MAPPING availability (no generic fallback allowed)
 */

// ── Error codes ────────────────────────────────────────────────────────────────

export const JournalMappingErrorCode = {
  COA_NOT_FOUND:               "COA_NOT_FOUND",
  SPECIFIC_COA_REQUIRED:       "SPECIFIC_COA_REQUIRED",
  JOURNAL_MAPPING_REQUIRED:    "JOURNAL_MAPPING_REQUIRED",
  COA_NOT_POSTABLE:            "COA_NOT_POSTABLE",
  COA_INACTIVE:                "COA_INACTIVE",
  COA_COMPANY_MISMATCH:        "COA_COMPANY_MISMATCH",
  COA_EFFECTIVE_DATE_INVALID:  "COA_EFFECTIVE_DATE_INVALID",
  COA_HEADER_NOT_POSTABLE:     "COA_HEADER_NOT_POSTABLE",
  COA_MAPPING_AMBIGUOUS:       "COA_MAPPING_AMBIGUOUS",
} as const;

export type JournalMappingErrorCode =
  typeof JournalMappingErrorCode[keyof typeof JournalMappingErrorCode];

// ── Safe HTTP status map ───────────────────────────────────────────────────────

const HTTP_STATUS_MAP: Record<JournalMappingErrorCode, number> = {
  COA_NOT_FOUND:              422,
  SPECIFIC_COA_REQUIRED:      422,
  JOURNAL_MAPPING_REQUIRED:   422,
  COA_NOT_POSTABLE:           422,
  COA_INACTIVE:               422,
  COA_COMPANY_MISMATCH:       422,
  COA_EFFECTIVE_DATE_INVALID: 422,
  COA_HEADER_NOT_POSTABLE:    422,
  COA_MAPPING_AMBIGUOUS:      422,
};

// ── Error class ────────────────────────────────────────────────────────────────

export class JournalMappingError extends Error {
  readonly name = "JournalMappingError";

  constructor(
    public readonly code: JournalMappingErrorCode,
    message: string,
    /** Safe context — must NOT contain SQL, stack trace, schema detail, or file paths */
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  httpStatus(): number {
    return HTTP_STATUS_MAP[this.code] ?? 422;
  }

  /**
   * Returns a safe response body suitable for direct serialisation to the client.
   * Never exposes SQL, stack traces, schema details, or internal paths.
   *
   * Context (used for internal logging) is deliberately excluded — it may
   * contain file paths, account codes, or other implementation details
   * that must not reach the client.
   */
  toSafeResponse(): {
    error: string;
    code: JournalMappingErrorCode;
    manual_review_required: true;
  } {
    return {
      error: this.message,
      code:  this.code,
      manual_review_required: true,
    };
  }
}

// ── Guard: throw if accountId is missing ─────────────────────────────────────

/**
 * Assert that a resolved account ID is non-null.
 * Throws JOURNAL_MAPPING_REQUIRED when the specific mapping is absent.
 *
 * Usage:
 *   requireAccountId(accountId, "sport_center_refund", "EXPENSE");
 */
export function requireAccountId(
  accountId: number | null | undefined,
  mappingContext: string,
  detectedIntent: string,
): asserts accountId is number {
  if (accountId == null) {
    throw new JournalMappingError(
      "JOURNAL_MAPPING_REQUIRED",
      `COA spesifik belum tersedia untuk "${mappingContext}" (intent: ${detectedIntent}). Jurnal tidak dibuat — butuh review manual.`,
      { mappingContext, detectedIntent },
    );
  }
}
