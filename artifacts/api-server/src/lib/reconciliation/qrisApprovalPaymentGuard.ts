export const QRIS_APPROVAL_SELECTION_CONFLICT =
  "CANONICAL_SETTLEMENT_SELECTION_CONFLICT";

export class QrisApprovalPaymentGuardError extends Error {
  readonly code = QRIS_APPROVAL_SELECTION_CONFLICT;
  readonly paymentIds: number[];
  readonly alreadySettledPaymentIds: number[];
  readonly eligiblePaymentIds: number[];

  constructor(
    message: string,
    paymentIds: number[] = [],
    eligiblePaymentIds: number[] = [],
  ) {
    super(message);
    this.name = "QrisApprovalPaymentGuardError";
    this.paymentIds = paymentIds;
    this.alreadySettledPaymentIds = paymentIds;
    this.eligiblePaymentIds = eligiblePaymentIds;
  }
}

export interface QrisApprovalPaymentSelection {
  candidatePaymentIds: number[];
  requestedPaymentIds?: number[] | null;
  activePostedPaymentIds: number[];
}

/**
 * Keep canonical payment IDs out of a supplemental approval when they are
 * already active in a posted/reconciled canonical batch.
 *
 * An omitted request is a stale-candidate recovery path: it is safe to remove
 * completed items and continue with the remaining late-arriving payments.
 * An explicit request is user intent and therefore fails closed if it still
 * contains a completed payment. This prevents silently approving a different
 * payment set than the one the caller selected.
 */
export function selectQrisApprovalPaymentIds(
  input: QrisApprovalPaymentSelection,
): number[] {
  const candidateIds = [...new Set(input.candidatePaymentIds)];
  const activeIds = new Set(input.activePostedPaymentIds);

  if (
    candidateIds.length === 0
    || candidateIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
    || [...activeIds].some((id) => !candidateIds.includes(id))
  ) {
    throw new QrisApprovalPaymentGuardError(
      "Identitas payment canonical pada kandidat tidak valid.",
    );
  }

  const requested = input.requestedPaymentIds == null
    ? null
    : [...new Set(input.requestedPaymentIds)];
  if (
    requested !== null
    && (
      requested.length === 0
      || requested.some((id) => !Number.isSafeInteger(id) || id <= 0)
      || requested.some((id) => !candidateIds.includes(id))
    )
  ) {
    throw new QrisApprovalPaymentGuardError(
      "Payment yang dipilih harus berasal dari kandidat canonical yang terlihat.",
    );
  }

  const selected = requested ?? candidateIds.filter((id) => !activeIds.has(id));
  const completedSelected = selected.filter((id) => activeIds.has(id));
  const eligibleIds = candidateIds.filter((id) => !activeIds.has(id));
  if (completedSelected.length > 0) {
    throw new QrisApprovalPaymentGuardError(
      `Payment canonical ${completedSelected.join(", ")} sudah berada pada batch posted/reconciled; ` +
      "approval supplemental dibatalkan.",
      completedSelected,
      eligibleIds,
    );
  }
  if (selected.length === 0) {
    throw new QrisApprovalPaymentGuardError(
      "Semua payment pada kandidat sudah berada pada batch posted/reconciled.",
      candidateIds,
      eligibleIds,
    );
  }

  return selected;
}