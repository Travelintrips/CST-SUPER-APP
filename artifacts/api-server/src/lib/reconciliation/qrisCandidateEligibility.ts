/**
 * One allow-list for provisional QRIS candidate snapshots.
 *
 * Historical rows remain in the database for audit, but only these two states
 * are current evidence. Using an allow-list prevents a newly introduced
 * terminal state from accidentally becoming approvable.
 */
export const ACTIVE_QRIS_CANDIDATE_STATUSES = [
  "candidate_auto_matched",
  "candidate_review",
] as const;

export type ActiveQrisCandidateStatus = typeof ACTIVE_QRIS_CANDIDATE_STATUSES[number];

export const ACTIVE_QRIS_CANDIDATE_STATUS_SQL = "('candidate_auto_matched', 'candidate_review')";

export function isActiveQrisCandidateStatus(value: unknown): value is ActiveQrisCandidateStatus {
  return ACTIVE_QRIS_CANDIDATE_STATUSES.includes(
    String(value ?? "").trim().toLowerCase() as ActiveQrisCandidateStatus,
  );
}

/**
 * `bank_reconciliation_matches` has its own lifecycle. Keep this allow-list
 * separate from the provisional snapshot lifecycle above: rejected/blocked/
 * superseded match rows are audit history and must never become current QRIS
 * evidence just because their candidate ID is still present.
 */
export const ACTIVE_QRIS_MATCH_STATUSES = ["candidate", "approved"] as const;
export const ACTIVE_QRIS_MATCH_STATUS_SQL = "('candidate', 'approved')";

export function isActiveQrisMatchStatus(value: unknown): boolean {
  return ACTIVE_QRIS_MATCH_STATUSES.includes(
    String(value ?? "").trim().toLowerCase() as typeof ACTIVE_QRIS_MATCH_STATUSES[number],
  );
}

/**
 * Canonical batches are active source evidence only while they can still be
 * consumed by reconciliation. Reversed/voided batches are audit history and
 * must not keep a payment out of fresh candidate generation.
 */
export const ACTIVE_CANONICAL_SETTLEMENT_STATUSES = ["posted", "reconciled"] as const;
export const ACTIVE_CANONICAL_SETTLEMENT_STATUS_SQL = "('posted', 'reconciled')";

export function isActiveCanonicalSettlementStatus(value: unknown): boolean {
  return ACTIVE_CANONICAL_SETTLEMENT_STATUSES.includes(
    String(value ?? "").trim().toLowerCase() as typeof ACTIVE_CANONICAL_SETTLEMENT_STATUSES[number],
  );
}

/** Legacy public settlement rows use a wider lifecycle than canonical batches. */
export const ACTIVE_LEGACY_QRIS_SETTLEMENT_STATUS_SQL =
  "('unsettled', 'pending', 'settled', 'partial', 'partially_settled')";

export function isActiveLegacyQrisSettlementStatus(value: unknown): boolean {
  return [
    "unsettled",
    "pending",
    "settled",
    "partial",
    "partially_settled",
  ].includes(String(value ?? "").trim().toLowerCase());
}