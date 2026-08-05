/**
 * AI Transaction Intelligence — Phase 10
 * Typed Error Classes
 *
 * All errors use typed codes. No stack trace or SQL leakage to API responses.
 */

// ─── Error codes ──────────────────────────────────────────────────────────────

export type AIReviewErrorCode =
  | 'AI_REVIEW_CASE_NOT_FOUND'
  | 'AI_REVIEW_CASE_ALREADY_EXISTS'
  | 'AI_REVIEW_INVALID_STATE'
  | 'AI_REVIEW_INVALID_DECISION'
  | 'AI_REVIEW_PERMISSION_DENIED'
  | 'AI_REVIEW_COMPANY_MISMATCH'
  | 'AI_REVIEW_IDEMPOTENCY_CONFLICT'
  | 'AI_REVIEW_SNAPSHOT_NOT_FOUND'
  | 'AI_REVIEW_TERMINAL_STATE'
  | 'AI_REVIEW_REEVALUATION_NOT_ALLOWED'
  | 'AI_REVIEW_VALIDATION_ERROR'
  | 'AI_REVIEW_DATABASE_ERROR'
  | 'AI_REVIEW_SOURCE_NOT_FOUND'
  | 'AI_REVIEW_SOURCE_UNSUPPORTED';

// ─── Error class ──────────────────────────────────────────────────────────────

export class AIReviewError extends Error {
  readonly code: AIReviewErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: AIReviewErrorCode,
    message: string,
    statusCode = 400,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AIReviewError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toResponse() {
    return {
      ok: false as const,
      error: {
        code: this.code,
        message: this.message,
        // Never include details in API response to prevent leakage
      },
    };
  }
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

export function notFound(resourceType = 'review case'): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_CASE_NOT_FOUND',
    `The requested ${resourceType} was not found`,
    404,
  );
}

export function alreadyExists(): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_CASE_ALREADY_EXISTS',
    'A review case with this idempotency key already exists',
    200,
  );
}

export function idempotencyConflict(): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_IDEMPOTENCY_CONFLICT',
    'An idempotency key conflict was detected — same key with different payload',
    409,
  );
}

export function invalidState(from: string, to: string): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_INVALID_STATE',
    `Invalid state transition from ${from} to ${to}`,
    422,
  );
}

export function terminalState(status: string): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_TERMINAL_STATE',
    `Review case is in terminal state (${status}) and cannot be modified`,
    422,
  );
}

export function permissionDenied(action = 'perform this action'): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_PERMISSION_DENIED',
    `You do not have permission to ${action}`,
    403,
  );
}

export function companyMismatch(): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_COMPANY_MISMATCH',
    'The resource does not belong to your company context',
    403,
  );
}

export function validationError(message: string, details?: unknown): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_VALIDATION_ERROR',
    message,
    400,
    details,
  );
}

export function databaseError(cause?: unknown): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_DATABASE_ERROR',
    'A database error occurred. Please try again.',
    500,
    undefined, // never expose cause to API
  );
}

export function reevaluationNotAllowed(reason: string): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_REEVALUATION_NOT_ALLOWED',
    `Re-evaluation not allowed: ${reason}`,
    422,
  );
}

export function sourceNotFound(source: string, sourceRecordId: string): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_SOURCE_NOT_FOUND',
    `No review case found for source '${source}' record '${sourceRecordId}'`,
    404,
  );
}

export function sourceUnsupported(source: string): AIReviewError {
  return new AIReviewError(
    'AI_REVIEW_SOURCE_UNSUPPORTED',
    `Source type '${source}' is not supported for AI review cross-linking`,
    422,
  );
}

// ─── Terminal status list ─────────────────────────────────────────────────────

export const TERMINAL_STATUSES = new Set([
  'APPROVED_RECOMMENDATION',
  'CHANGED_COA',
  'REJECTED_RECOMMENDATION',
  'CANCELLED',
  'CLOSED',
]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

// ─── Safe error handler ───────────────────────────────────────────────────────

/**
 * Convert any thrown value to a sanitized API error response.
 * Never leaks SQL, stack trace, or credentials.
 */
export function toSafeErrorResponse(err: unknown): {
  statusCode: number;
  body: { ok: false; error: { code: string; message: string } };
} {
  if (err instanceof AIReviewError) {
    return {
      statusCode: err.statusCode,
      body: err.toResponse(),
    };
  }

  // Unknown error — log internally but return generic response
  return {
    statusCode: 500,
    body: {
      ok: false,
      error: {
        code: 'AI_REVIEW_DATABASE_ERROR',
        message: 'An unexpected error occurred. Please try again.',
      },
    },
  };
}
