/**
 * Typed Error Codes — Task #7: AI COA Proposal Engine
 *
 * Safe HTTP responses — NO SQL, stack traces, schema details, or file paths
 * are ever exposed to clients.
 *
 * HTTP mapping:
 *   400 — validation failure
 *   401 — unauthenticated (handled by auth middleware)
 *   403 — permission denied / company mismatch / self-approval
 *   404 — not found
 *   409 — duplicate / invalid state / idempotency conflict / code conflict
 *   422 — accounting / hierarchy validation failure
 *   500 — sanitized internal error
 */

// ── Error codes ────────────────────────────────────────────────────────────────

export const CoaProposalErrorCode = {
  COA_PROPOSAL_NOT_FOUND:               "COA_PROPOSAL_NOT_FOUND",
  COA_PROPOSAL_ALREADY_EXISTS:          "COA_PROPOSAL_ALREADY_EXISTS",
  COA_PROPOSAL_DUPLICATE:               "COA_PROPOSAL_DUPLICATE",
  COA_PROPOSAL_INVALID_STATE:           "COA_PROPOSAL_INVALID_STATE",
  COA_PROPOSAL_PERMISSION_DENIED:       "COA_PROPOSAL_PERMISSION_DENIED",
  COA_PROPOSAL_COMPANY_MISMATCH:        "COA_PROPOSAL_COMPANY_MISMATCH",
  COA_PROPOSAL_SELF_APPROVAL_FORBIDDEN: "COA_PROPOSAL_SELF_APPROVAL_FORBIDDEN",
  COA_PROPOSAL_VALIDATION_FAILED:       "COA_PROPOSAL_VALIDATION_FAILED",
  COA_PROPOSAL_CODE_CONFLICT:           "COA_PROPOSAL_CODE_CONFLICT",
  COA_PROPOSAL_PARENT_REQUIRED:         "COA_PROPOSAL_PARENT_REQUIRED",
  COA_PROPOSAL_HIERARCHY_INVALID:       "COA_PROPOSAL_HIERARCHY_INVALID",
  COA_PROPOSAL_IMPLEMENTATION_FAILED:   "COA_PROPOSAL_IMPLEMENTATION_FAILED",
  COA_PROPOSAL_IDEMPOTENCY_CONFLICT:    "COA_PROPOSAL_IDEMPOTENCY_CONFLICT",
} as const;

export type CoaProposalErrorCode =
  typeof CoaProposalErrorCode[keyof typeof CoaProposalErrorCode];

// ── HTTP status map ────────────────────────────────────────────────────────────

const HTTP_STATUS_MAP: Record<CoaProposalErrorCode, number> = {
  COA_PROPOSAL_NOT_FOUND:               404,
  COA_PROPOSAL_ALREADY_EXISTS:          409,
  COA_PROPOSAL_DUPLICATE:               409,
  COA_PROPOSAL_INVALID_STATE:           409,
  COA_PROPOSAL_PERMISSION_DENIED:       403,
  COA_PROPOSAL_COMPANY_MISMATCH:        403,
  COA_PROPOSAL_SELF_APPROVAL_FORBIDDEN: 403,
  COA_PROPOSAL_VALIDATION_FAILED:       400,
  COA_PROPOSAL_CODE_CONFLICT:           409,
  COA_PROPOSAL_PARENT_REQUIRED:         422,
  COA_PROPOSAL_HIERARCHY_INVALID:       422,
  COA_PROPOSAL_IMPLEMENTATION_FAILED:   422,
  COA_PROPOSAL_IDEMPOTENCY_CONFLICT:    409,
};

// ── Error class ────────────────────────────────────────────────────────────────

export class CoaProposalError extends Error {
  readonly name = "CoaProposalError";

  constructor(
    public readonly code: CoaProposalErrorCode,
    message: string,
    /** Safe context — must NOT contain SQL, stack trace, schema detail, or file paths */
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  httpStatus(): number {
    return HTTP_STATUS_MAP[this.code] ?? 500;
  }

  /**
   * Safe response body for clients. Never includes context (may contain internals).
   */
  toSafeResponse(): { error: string; code: CoaProposalErrorCode } {
    return { error: this.message, code: this.code };
  }
}

// ── Helper: map service result error code to HTTP status ─────────────────────

export function httpStatusForProposalCode(code: string | undefined): number {
  if (!code) return 500;
  return HTTP_STATUS_MAP[code as CoaProposalErrorCode] ?? 400;
}
