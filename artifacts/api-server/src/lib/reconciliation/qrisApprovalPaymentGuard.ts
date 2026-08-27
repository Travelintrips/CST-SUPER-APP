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

export interface QrisCanonicalGroupPayment {
  id: number;
  companyId: number | null;
  providerCode: string | null;
  bankAccountId: string | null;
  expectedSettlementDate: string | null;
  settlementRuleVersion: string | null;
}

export interface QrisCanonicalGroupSelection {
  eligiblePaymentIds: number[];
  conflictingPaymentIds: number[];
}

function canonicalGroupKey(payment: QrisCanonicalGroupPayment): string {
  return [
    payment.companyId ?? "",
    String(payment.providerCode ?? "").trim().toLowerCase(),
    String(payment.bankAccountId ?? "").trim(),
    String(payment.expectedSettlementDate ?? "").slice(0, 10),
    String(payment.settlementRuleVersion ?? "").trim(),
  ].join("|");
}

/**
 * A canonical settlement builder call may consume only one exact payment
 * group. Provider aliases can match the same bank evidence, but they remain
 * separate canonical groups and must be approved in separate partial steps.
 */
export function partitionQrisCanonicalGroup(
  selectedPaymentIds: number[],
  payments: QrisCanonicalGroupPayment[],
): QrisCanonicalGroupSelection {
  const selectedIds = [...new Set(selectedPaymentIds)];
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  const source = paymentById.get(selectedIds[0] ?? -1);
  if (!source) {
    return {
      eligiblePaymentIds: [],
      conflictingPaymentIds: selectedIds,
    };
  }

  const sourceKey = canonicalGroupKey(source);
  const eligiblePaymentIds = selectedIds.filter((id) => {
    const payment = paymentById.get(id);
    return payment != null && canonicalGroupKey(payment) === sourceKey;
  });
  return {
    eligiblePaymentIds,
    conflictingPaymentIds: selectedIds.filter((id) => !eligiblePaymentIds.includes(id)),
  };
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