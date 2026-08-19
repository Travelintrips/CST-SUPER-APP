import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { postEntry, type PostingLine } from "../accounting.js";
import { logger } from "../logger.js";

export interface HistoricalDuplicateEvidence {
  legacy: {
    id: number;
    companyId: number;
    status: string;
    source: string;
    sourceId: number | null;
    ref: string | null;
    totalDebit: number;
    totalCredit: number;
    voidEntryId: number | null;
    isVoided: boolean;
    isReversed: boolean;
  };
  canonical: {
    id: number;
    companyId: number;
    status: string;
    source: string;
    sourcePaymentId: number | null;
    totalDebit: number;
    totalCredit: number;
    paymentSourceType: string | null;
    paymentSourceDocId: number | null;
    paymentStatus: string | null;
    paymentAmount: number | null;
    sportPaymentId: number | null;
    sportPaymentStatus: string | null;
    sportBookingId: number | null;
    sportBookingRowId: number | null;
    sportBookingOrderNumber: string | null;
  };
  legacyLines: Array<{ accountId: number; debit: number; credit: number }>;
  canonicalLines: Array<{ accountId: number; debit: number; credit: number }>;
  existingReversalCount: number;
}

export interface HistoricalDuplicateValidation {
  safe: boolean;
  reasons: string[];
}

const EPSILON = 0.01;
const closeEnough = (a: number, b: number) => Math.abs(a - b) <= EPSILON;
const balanced = (debit: number, credit: number) => closeEnough(debit, credit);

export function validateHistoricalDuplicateEvidence(
  evidence: HistoricalDuplicateEvidence,
): HistoricalDuplicateValidation {
  const reasons: string[] = [];
  const { legacy, canonical } = evidence;

  if (legacy.id === canonical.id) reasons.push("legacy and canonical entries must differ");
  if (legacy.companyId !== canonical.companyId) reasons.push("company_id mismatch");
  if (legacy.status !== "posted") reasons.push("legacy entry is not posted");
  if (canonical.status !== "posted") reasons.push("canonical entry is not posted");
  if (legacy.source !== "sport_center_booking") reasons.push("legacy source mismatch");
  if (canonical.source !== "sport_center_payment") reasons.push("canonical source mismatch");
  if (legacy.voidEntryId != null) reasons.push("legacy already has void_entry_id");
  if (legacy.isVoided) reasons.push("legacy is_voided is true");
  if (legacy.isReversed) reasons.push("legacy is_reversed is true");
  if (evidence.existingReversalCount !== 0) reasons.push("historical duplicate reversal already exists");

  if (!balanced(legacy.totalDebit, legacy.totalCredit)) reasons.push("legacy entry is unbalanced");
  if (!balanced(canonical.totalDebit, canonical.totalCredit)) reasons.push("canonical entry is unbalanced");
  if (!closeEnough(legacy.totalDebit, canonical.totalDebit)) reasons.push("total debit mismatch");
  if (!closeEnough(legacy.totalCredit, canonical.totalCredit)) reasons.push("total credit mismatch");

  if (!legacy.ref || !canonical.sportBookingOrderNumber ||
      legacy.ref !== canonical.sportBookingOrderNumber) {
    reasons.push("legacy ref does not match canonical sport booking order_number");
  }
  if (canonical.sourcePaymentId == null ||
      canonical.sportPaymentId !== canonical.sourcePaymentId ||
      canonical.sportBookingId == null ||
      canonical.sportBookingRowId !== canonical.sportBookingId) {
    reasons.push("canonical payment identity chain mismatch");
  }
  if (canonical.paymentSourceDocId != null &&
      canonical.paymentSourceDocId !== canonical.sourcePaymentId) {
    reasons.push("canonical accounting payment identity mismatch");
  }
  // Older canonical entries may legitimately predate an accounting_payments
  // linkage. When a linkage exists, it must be valid; the sport payment and
  // canonical entry identity remain mandatory either way.
  if (canonical.paymentSourceType != null && canonical.paymentSourceType !== "sport_center") {
    reasons.push("canonical accounting payment source mismatch");
  }
  if (canonical.paymentSourceType != null && canonical.paymentStatus !== "posted") {
    reasons.push("canonical accounting payment is not posted");
  }
  if (canonical.sportPaymentStatus !== "confirmed") reasons.push("canonical sport payment is not confirmed");
  if (canonical.paymentAmount != null && !closeEnough(canonical.paymentAmount, canonical.totalDebit)) {
    reasons.push("canonical accounting payment amount mismatch");
  }

  const legacyDebit = evidence.legacyLines.find((line) => line.debit > EPSILON);
  const canonicalDebit = evidence.canonicalLines.find((line) => line.debit > EPSILON);
  if (!legacyDebit || !canonicalDebit) {
    reasons.push("missing bank debit line");
  } else {
    if (legacyDebit.accountId !== canonicalDebit.accountId) reasons.push("bank debit account mismatch");
    if (!closeEnough(legacyDebit.debit, canonicalDebit.debit)) reasons.push("bank debit amount mismatch");
  }

  return { safe: reasons.length === 0, reasons };
}

export interface ReverseHistoricalDuplicateInput {
  legacyEntryId: number;
  canonicalEntryId: number;
  actor: string;
  reason: string;
  validateOnly?: boolean;
}

export interface ReverseHistoricalDuplicateResult {
  ok: boolean;
  reversalEntryId?: number;
  error?: string;
  code?: "NOT_FOUND" | "NOT_SAFE" | "ALREADY_REVERSED";
}

export const VERIFIED_HISTORICAL_DUPLICATE_PAIRS = [
  [14593, 28585],
  [14594, 28587],
  [20966, 28601],
  [20967, 28602],
  [28382, 28688],
  [28383, 28689],
  [28384, 28690],
] as const;

export interface HistoricalDuplicateBatchResult {
  ok: boolean;
  preflight: ReverseHistoricalDuplicateResult[];
  applied: ReverseHistoricalDuplicateResult[];
}

/**
 * Controlled batch harness. Every pair is validated read-only first; no
 * reversal starts unless every verified pair is safe.
 */
export async function reverseVerifiedHistoricalDuplicateBatch(input: {
  actor: string;
  reason: string;
}): Promise<HistoricalDuplicateBatchResult> {
  const preflight: ReverseHistoricalDuplicateResult[] = [];
  for (const [legacyEntryId, canonicalEntryId] of VERIFIED_HISTORICAL_DUPLICATE_PAIRS) {
    const result = await reverseHistoricalDuplicate({
      legacyEntryId,
      canonicalEntryId,
      actor: input.actor,
      reason: input.reason,
      validateOnly: true,
    });
    preflight.push(result);
    if (!result.ok) return { ok: false, preflight, applied: [] };
  }

  const applied: ReverseHistoricalDuplicateResult[] = [];
  for (const [legacyEntryId, canonicalEntryId] of VERIFIED_HISTORICAL_DUPLICATE_PAIRS) {
    const result = await reverseHistoricalDuplicate({
      legacyEntryId,
      canonicalEntryId,
      actor: input.actor,
      reason: input.reason,
    });
    applied.push(result);
    if (!result.ok) return { ok: false, preflight, applied };
  }
  return { ok: true, preflight, applied };
}

function numeric(value: unknown): number {
  return Number(value ?? 0);
}

function lineRows(rows: unknown[]): HistoricalDuplicateEvidence["legacyLines"] {
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    accountId: numeric(row.account_id),
    debit: numeric(row.debit),
    credit: numeric(row.credit),
  }));
}

/**
 * Official owner path for historical duplicate cleanup.
 * It reverses only the legacy entry; canonical entries and payments are never
 * updated by this function.
 */
export async function reverseHistoricalDuplicate(
  input: ReverseHistoricalDuplicateInput,
): Promise<ReverseHistoricalDuplicateResult> {
  const legacyResult = await db.execute(sql`
    SELECT id, company_id, status::text AS status, source::text AS source, source_id,
           ref, total_debit, total_credit, void_entry_id,
           COALESCE(is_voided, false) AS is_voided,
           COALESCE(is_reversed, false) AS is_reversed,
           journal_id, date
    FROM accounting_entries
    WHERE id = ${input.legacyEntryId}
    LIMIT 1
  `);
  const canonicalResult = await db.execute(sql`
    SELECT ae.id, ae.company_id, ae.status::text AS status, ae.source::text AS source,
           ae.source_payment_id, ae.total_debit, ae.total_credit,
           ap.source_type AS payment_source_type, ap.source_doc_id AS payment_source_doc_id,
           ap.status::text AS payment_status, ap.amount AS payment_amount,
           sp.id AS sport_payment_id, sp.status::text AS sport_payment_status,
           sp.booking_id AS sport_booking_id, sb.id AS sport_booking_row_id,
           sb.order_number AS sport_booking_order_number,
           ae.journal_id, ae.date
    FROM accounting_entries ae
    LEFT JOIN accounting_payments ap
      ON ap.entry_id = ae.id
      OR (ap.source_type = 'sport_center' AND ap.source_doc_id = ae.source_payment_id)
    LEFT JOIN sport_center.sport_payments sp ON sp.id = ae.source_payment_id
    LEFT JOIN sport_center.sport_bookings sb ON sb.id = sp.booking_id
    WHERE ae.id = ${input.canonicalEntryId}
    LIMIT 1
  `);
  if (!legacyResult.rows.length || !canonicalResult.rows.length) {
    return { ok: false, code: "NOT_FOUND", error: "legacy or canonical entry not found" };
  }

  const legacyRow = legacyResult.rows[0] as Record<string, unknown>;
  const canonicalRow = canonicalResult.rows[0] as Record<string, unknown>;
  const reversalResult = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM accounting_entries
    WHERE source::text = 'historical_duplicate_reversal'
      AND source_id = ${input.legacyEntryId}
  `);
  const [legacyLinesResult, canonicalLinesResult] = await Promise.all([
    db.execute(sql`SELECT account_id, debit, credit FROM accounting_entry_lines WHERE entry_id = ${input.legacyEntryId}`),
    db.execute(sql`SELECT account_id, debit, credit FROM accounting_entry_lines WHERE entry_id = ${input.canonicalEntryId}`),
  ]);

  const evidence: HistoricalDuplicateEvidence = {
    legacy: {
      id: numeric(legacyRow.id),
      companyId: numeric(legacyRow.company_id),
      status: String(legacyRow.status),
      source: String(legacyRow.source),
      sourceId: legacyRow.source_id == null ? null : numeric(legacyRow.source_id),
      ref: legacyRow.ref == null ? null : String(legacyRow.ref),
      totalDebit: numeric(legacyRow.total_debit),
      totalCredit: numeric(legacyRow.total_credit),
      voidEntryId: legacyRow.void_entry_id == null ? null : numeric(legacyRow.void_entry_id),
      isVoided: Boolean(legacyRow.is_voided),
      isReversed: Boolean(legacyRow.is_reversed),
    },
    canonical: {
      id: numeric(canonicalRow.id),
      companyId: numeric(canonicalRow.company_id),
      status: String(canonicalRow.status),
      source: String(canonicalRow.source),
      sourcePaymentId: canonicalRow.source_payment_id == null ? null : numeric(canonicalRow.source_payment_id),
      totalDebit: numeric(canonicalRow.total_debit),
      totalCredit: numeric(canonicalRow.total_credit),
      paymentSourceType: canonicalRow.payment_source_type == null ? null : String(canonicalRow.payment_source_type),
      paymentSourceDocId: canonicalRow.payment_source_doc_id == null ? null : numeric(canonicalRow.payment_source_doc_id),
      paymentStatus: canonicalRow.payment_status == null ? null : String(canonicalRow.payment_status),
      paymentAmount: canonicalRow.payment_amount == null ? null : numeric(canonicalRow.payment_amount),
      sportPaymentId: canonicalRow.sport_payment_id == null ? null : numeric(canonicalRow.sport_payment_id),
      sportPaymentStatus: canonicalRow.sport_payment_status == null ? null : String(canonicalRow.sport_payment_status),
      sportBookingId: canonicalRow.sport_booking_id == null ? null : numeric(canonicalRow.sport_booking_id),
      sportBookingRowId: canonicalRow.sport_booking_row_id == null ? null : numeric(canonicalRow.sport_booking_row_id),
      sportBookingOrderNumber: canonicalRow.sport_booking_order_number == null ? null : String(canonicalRow.sport_booking_order_number),
    },
    legacyLines: lineRows(legacyLinesResult.rows),
    canonicalLines: lineRows(canonicalLinesResult.rows),
    existingReversalCount: numeric((reversalResult.rows[0] as Record<string, unknown>)?.count),
  };
  const validation = validateHistoricalDuplicateEvidence(evidence);
  if (!validation.safe) {
    return { ok: false, code: "NOT_SAFE", error: validation.reasons.join("; ") };
  }
  if (input.validateOnly) return { ok: true };

  const reversalLines: PostingLine[] = evidence.legacyLines.map((line) => ({
    accountId: line.accountId,
    debit: line.credit,
    credit: line.debit,
    description: `[HISTORICAL DUPLICATE REVERSAL] ${input.reason}`,
  }));
  const journalId = numeric(legacyRow.journal_id);
  let reversal: Awaited<ReturnType<typeof postEntry>>;
  try {
    reversal = await postEntry({
      journalId,
      date: new Date(),
      ref: evidence.legacy.ref,
      description: input.reason,
      source: "historical_duplicate_reversal" as never,
      sourceId: evidence.legacy.id,
      createdById: input.actor,
      companyId: evidence.legacy.companyId,
      lines: reversalLines,
    }, "JNL");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  await db.execute(sql`
    UPDATE accounting_entries
    SET status = 'voided',
        void_entry_id = ${reversal.id},
        void_reason = ${input.reason},
        updated_at = NOW()
    WHERE id = ${input.legacyEntryId}
      AND status::text = 'posted'
      AND void_entry_id IS NULL
  `);
  logger.info(
    { legacyEntryId: input.legacyEntryId, canonicalEntryId: input.canonicalEntryId, reversalEntryId: reversal.id },
    "[reverseHistoricalDuplicate] historical duplicate reversed",
  );
  return { ok: true, reversalEntryId: reversal.id };
}