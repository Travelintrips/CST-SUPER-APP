/**
 * Canonical Posting Engine — shared types (Tahap 3).
 *
 * See docs/canonical-posting-engine/02-design.md for the full design rationale.
 */

import type { PostingLine, PostingInput, DbClient } from "../accounting.js";

export type { PostingLine, DbClient };

/** Journal source — reuses the exact union already validated by `_postEntryCore`. */
export type PostingSource = NonNullable<PostingInput["source"]>;

/** Optional tax line — when present, inserted ATOMICALLY with the journal entry. */
export interface TaxLine {
  taxType: string;
  baseAmount: number;
  taxAmount: number;
  /** GL account for the tax line, if this tax must also produce a gl_tax_lines row. */
  glAccountId?: number | null;
  npwp?: string | null;
}

export interface PostingRequest {
  journalId: number;
  journalCode: string;
  date: Date;
  ref?: string | null;
  description?: string | null;
  paymentMethod?: string | null;
  source: PostingSource;
  sourceId: number;
  companyId: number;
  createdById?: string | null;
  lines: PostingLine[];
  /** If provided, tax rows are inserted in the SAME db.transaction() as the journal. */
  taxes?: TaxLine[];
  initialStatus?: "posted" | "draft";
}

export type PostingErrorCode =
  | "PERIOD_CLOSED"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_NOT_POSTABLE"
  | "ACCOUNT_INACTIVE"
  | "ACCOUNT_COMPANY_MISMATCH"
  | "ACCOUNT_NOT_EFFECTIVE"
  | "NOT_BALANCED"
  | "DUPLICATE_POSTING"
  | "TRANSACTION_FAILED";

export interface PostingResult {
  ok: boolean;
  entryId?: number;
  wasIdempotent?: boolean;
  error?: string;
  errorCode?: PostingErrorCode;
}

export class PostingValidationError extends Error {
  code: PostingErrorCode;
  constructor(code: PostingErrorCode, message: string) {
    super(message);
    this.name = "PostingValidationError";
    this.code = code;
  }
}

export interface ValidationContext {
  client: DbClient;
}

/** Strategy pattern — new checks can be added without touching existing ones (Open/Closed). */
export interface PostingValidator {
  readonly name: string;
  validate(request: PostingRequest, ctx: ValidationContext): Promise<void>;
}
