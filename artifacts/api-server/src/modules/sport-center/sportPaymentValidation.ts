export type SportPaymentPostingState = "failed" | "manual_review";

export interface SportPaymentPostingEvidence {
  sourcePaymentId?: number | string | null | undefined;
  mirrorPaymentId?: number | string | null | undefined;
  sourceAmount: number | null | undefined;
  mirrorAmount: number | null | undefined;
  accountingPaymentAmount: number | null | undefined;
  journalTotalDebit: number | null | undefined;
  journalTotalCredit: number | null | undefined;
  sourceBookingId: number | string | null | undefined;
  sourceBookingNumber: string | null | undefined;
  mirrorBookingId: number | string | null | undefined;
  mirrorSourceBookingId?: number | string | null | undefined;
  mirrorBookingNumber: string | null | undefined;
  accountingSourceType: string | null | undefined;
  accountingSourceDocId: number | string | null | undefined;
  accountingReference: string | null | undefined;
  journalSource: string | null | undefined;
  journalSourceId: number | string | null | undefined;
  duplicateMirrorCount?: number;
  duplicateBookingMirrorCount?: number;
  duplicateAccountingPaymentCount?: number;
}

export interface SportPaymentMirrorEvidence {
  sourcePaymentId?: number | string | null | undefined;
  mirrorPaymentId?: number | string | null | undefined;
  sourceAmount: number | null | undefined;
  mirrorAmount: number | null | undefined;
  sourceBookingId: number | string | null | undefined;
  sourceBookingNumber: string | null | undefined;
  mirrorBookingId: number | string | null | undefined;
  mirrorSourceBookingId?: number | string | null | undefined;
  mirrorBookingNumber: string | null | undefined;
  duplicateMirrorCount?: number;
  duplicateBookingMirrorCount?: number;
}

export interface SportPaymentValidationFailure {
  ok: false;
  state: SportPaymentPostingState;
  error: string;
  mismatches: string[];
}

export interface SportPaymentValidationSuccess {
  ok: true;
}

export type SportPaymentValidation =
  | SportPaymentValidationSuccess
  | SportPaymentValidationFailure;

const MONEY_TOLERANCE = 0.01;

export function isSportPaymentPostingRetryable(state: string | null | undefined): boolean {
  return state == null || state === "unposted" || state === "failed";
}

function sameMoney(left: number | null | undefined, right: number | null | undefined): boolean {
  return left != null
    && right != null
    && Number.isFinite(Number(left))
    && Number.isFinite(Number(right))
    && Math.abs(Number(left) - Number(right)) <= MONEY_TOLERANCE;
}

function sameIdentity(left: number | string | null | undefined, right: number | string | null | undefined): boolean {
  return left != null && right != null && String(left).trim() === String(right).trim();
}

function sameText(left: string | null | undefined, right: string | null | undefined): boolean {
  return left != null && right != null && String(left).trim() !== ""
    && String(left).trim() === String(right).trim();
}

function failure(
  state: SportPaymentPostingState,
  mismatches: string[],
): SportPaymentValidationFailure {
  const unique = [...new Set(mismatches)];
  return {
    ok: false,
    state,
    mismatches: unique,
    error: `${state === "manual_review" ? "Sport payment requires manual review" : "Sport payment posting failed"}: ${unique.join("; ")}`,
  };
}

export function validateSportPaymentMirror(
  evidence: SportPaymentMirrorEvidence,
): SportPaymentValidation {
  const failedMismatches: string[] = [];
  const manualMismatches: string[] = [];

  if (evidence.sourceAmount == null) {
    failedMismatches.push("source payment amount unavailable");
  }
  if (evidence.sourceBookingId == null || evidence.sourceBookingNumber == null) {
    failedMismatches.push("source booking identity unavailable");
  }
  if (evidence.mirrorAmount == null) {
    failedMismatches.push("mirror payment amount unavailable");
  }
  if (evidence.mirrorBookingId == null || evidence.mirrorBookingNumber == null) {
    failedMismatches.push("mirror booking identity unavailable");
  }
  if (failedMismatches.length > 0) return failure("failed", failedMismatches);

  if ((evidence.duplicateMirrorCount ?? 0) > 1) {
    manualMismatches.push(`duplicate payment mirrors (${evidence.duplicateMirrorCount})`);
  }
  if ((evidence.duplicateBookingMirrorCount ?? 0) > 1) {
    manualMismatches.push(`duplicate booking mirrors (${evidence.duplicateBookingMirrorCount})`);
  }
  if (evidence.sourceAmount == null) {
    manualMismatches.push("source payment amount unavailable");
  } else if (!sameMoney(evidence.sourceAmount, evidence.mirrorAmount)) {
    manualMismatches.push(`source amount ${evidence.sourceAmount} != mirror amount ${evidence.mirrorAmount ?? "NULL"}`);
  }
  if (!sameIdentity(evidence.sourceBookingId, evidence.mirrorSourceBookingId)) {
    manualMismatches.push(`source booking id ${evidence.sourceBookingId ?? "NULL"} != mirror source booking id ${evidence.mirrorSourceBookingId ?? "NULL"}`);
  }
  if (!sameText(evidence.sourceBookingNumber, evidence.mirrorBookingNumber)) {
    manualMismatches.push(`source booking ${evidence.sourceBookingNumber ?? "NULL"} != mirror booking ${evidence.mirrorBookingNumber ?? "NULL"}`);
  }

  return manualMismatches.length > 0
    ? failure("manual_review", manualMismatches)
    : { ok: true };
}

export function validateSportPaymentPosting(
  evidence: SportPaymentPostingEvidence,
): SportPaymentValidation {
  const mirrorValidation = validateSportPaymentMirror(evidence);
  if (!mirrorValidation.ok) return mirrorValidation;

  const failedMismatches: string[] = [];
  const manualMismatches: string[] = [];
  if (evidence.accountingPaymentAmount == null) {
    failedMismatches.push("accounting payment is missing");
  }
  if (evidence.journalTotalDebit == null || evidence.journalTotalCredit == null) {
    failedMismatches.push("journal entry or journal totals are missing");
  }
  if (evidence.accountingSourceDocId == null) {
    failedMismatches.push("accounting payment source_doc_id is missing");
  }
  if (!sameIdentity(evidence.mirrorPaymentId, evidence.accountingSourceDocId)) {
    manualMismatches.push(
      `mirror payment id ${evidence.mirrorPaymentId ?? "NULL"} != accounting source_doc_id ${evidence.accountingSourceDocId ?? "NULL"}`,
    );
  }
  if (evidence.journalSourceId == null) {
    failedMismatches.push("journal source_id is missing");
  }
  if (failedMismatches.length > 0) return failure("failed", failedMismatches);

  if ((evidence.duplicateAccountingPaymentCount ?? 0) > 1) {
    manualMismatches.push(
      `duplicate accounting payments (${evidence.duplicateAccountingPaymentCount})`,
    );
  }

  if (!sameMoney(evidence.sourceAmount, evidence.accountingPaymentAmount)) {
    manualMismatches.push(
      `source amount ${evidence.sourceAmount ?? "NULL"} != accounting payment amount ${evidence.accountingPaymentAmount ?? "NULL"}`,
    );
  }
  if (!sameMoney(evidence.sourceAmount, evidence.journalTotalDebit)) {
    manualMismatches.push(
      `source amount ${evidence.sourceAmount ?? "NULL"} != journal debit total ${evidence.journalTotalDebit ?? "NULL"}`,
    );
  }
  if (!sameMoney(evidence.sourceAmount, evidence.journalTotalCredit)) {
    manualMismatches.push(
      `source amount ${evidence.sourceAmount ?? "NULL"} != journal credit total ${evidence.journalTotalCredit ?? "NULL"}`,
    );
  }
  if (!sameIdentity(evidence.mirrorBookingId, evidence.journalSourceId)) {
    manualMismatches.push(
      `mirror booking id ${evidence.mirrorBookingId ?? "NULL"} != journal source id ${evidence.journalSourceId ?? "NULL"}`,
    );
  }
  if (!sameText(evidence.sourceBookingNumber, evidence.accountingReference)) {
    manualMismatches.push(
      `source booking ${evidence.sourceBookingNumber ?? "NULL"} != accounting reference ${evidence.accountingReference ?? "NULL"}`,
    );
  }
  if (evidence.accountingSourceType !== "sport_center") {
    manualMismatches.push(
      `accounting source type is ${evidence.accountingSourceType ?? "NULL"}, expected sport_center`,
    );
  }
  if (evidence.journalSource !== "sport_center_booking") {
    manualMismatches.push(
      `journal source is ${evidence.journalSource ?? "NULL"}, expected sport_center_booking`,
    );
  }

  if (manualMismatches.length > 0) return failure("manual_review", manualMismatches);

  return { ok: true };
}