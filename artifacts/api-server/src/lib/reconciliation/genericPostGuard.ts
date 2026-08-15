import { RECONCILIATION_CANDIDATE_SOURCES } from "@workspace/db";

export const GENERIC_POST_GUARD_CODES = {
  CANONICAL_SETTLEMENT_ALREADY_ACCOUNTED:
    "CANONICAL_SETTLEMENT_ALREADY_ACCOUNTED",
  CANONICAL_SETTLEMENT_APPROVAL_REQUIRED:
    "CANONICAL_SETTLEMENT_APPROVAL_REQUIRED",
  AMBIGUOUS_QRIS_SETTLEMENT_SOURCE: "AMBIGUOUS_QRIS_SETTLEMENT_SOURCE",
} as const;

export type GenericPostGuardCode =
  (typeof GENERIC_POST_GUARD_CODES)[keyof typeof GENERIC_POST_GUARD_CODES];

export class GenericPostGuardError extends Error {
  readonly code: GenericPostGuardCode;

  constructor(code: GenericPostGuardCode, message: string) {
    super(message);
    this.name = "GenericPostGuardError";
    this.code = code;
  }
}


export type ApprovedReconciliationMatchIdentity = {
  candidate_type?: string | null;
  candidate_id?: number | string | null;
  candidate_source?: string | null;
};

/**
 * Reject source-qualified canonical settlements before generic journal
 * loading or posting. Legacy QRIS remains allowed, while historical or
 * unknown QRIS provenance fails closed.
 */
export function assertGenericPostAllowed(
  match: ApprovedReconciliationMatchIdentity | null | undefined,
): void {
  if (!match || match.candidate_type !== "qris_settlement") return;

  const candidateId = Number(match.candidate_id);
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) {
    throw new GenericPostGuardError(
      GENERIC_POST_GUARD_CODES.AMBIGUOUS_QRIS_SETTLEMENT_SOURCE,
      "Identitas QRIS settlement tidak lengkap; generic posting ditolak.",
    );
  }

  if (
    match.candidate_source ===
    RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER
  ) {
    throw new GenericPostGuardError(
      GENERIC_POST_GUARD_CODES.CANONICAL_SETTLEMENT_ALREADY_ACCOUNTED,
      "Canonical Sport Center settlement sudah direkonsiliasi dan tidak menggunakan generic posting.",
    );
  }

  if (match.candidate_source === RECONCILIATION_CANDIDATE_SOURCES.LEGACY_QRIS) {
    return;
  }

  throw new GenericPostGuardError(
    GENERIC_POST_GUARD_CODES.AMBIGUOUS_QRIS_SETTLEMENT_SOURCE,
    "Sumber QRIS settlement tidak dapat dibuktikan secara source-aware; generic posting ditolak.",
  );
}

/**
 * Generic approval/journal creation is a separate bypass from /post. Canonical
 * QRIS settlements must reach the dedicated link-only owner before any generic
 * journal code is allowed to run.
 */
export function assertGenericApprovalAllowed(
  match: ApprovedReconciliationMatchIdentity | null | undefined,
): void {
  if (
    match?.candidate_type === "qris_settlement" &&
    match.candidate_source ===
      RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER
  ) {
    throw new GenericPostGuardError(
      GENERIC_POST_GUARD_CODES.CANONICAL_SETTLEMENT_APPROVAL_REQUIRED,
      "Canonical Sport Center settlement wajib memakai approval link-only; generic approval ditolak.",
    );
  }
}