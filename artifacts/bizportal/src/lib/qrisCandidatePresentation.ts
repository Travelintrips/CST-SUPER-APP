export type QrisCandidatePresentationState =
  | "ready"
  | "depleted"
  | "empty"
  | "stale"
  | "ineligible";

type QrisPaymentItemLike = {
  paymentId?: number | string | null;
  payment_id?: number | string | null;
};

type QrisCandidateLike = {
  reconciliation_status?: string | null;
  payment_items?: QrisPaymentItemLike[] | null;
  current_payment_ids?: Array<number | string> | null;
  settled_payment_ids?: Array<number | string> | null;
  active_settlement_payment_ids?: Array<number | string> | null;
  unconfirmed_payment_ids?: Array<number | string> | null;
};

function validIds(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function qrisCandidatePaymentIds(candidate: QrisCandidateLike): number[] {
  return (candidate.payment_items ?? [])
    .map((item) => Number(item.paymentId ?? item.payment_id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function getAvailableQrisPaymentIds(candidate: QrisCandidateLike): number[] {
  const unconfirmed = new Set(getUnconfirmedQrisPaymentIds(candidate));
  if (Array.isArray(candidate.current_payment_ids)) {
    return validIds(candidate.current_payment_ids).filter((id) => !unconfirmed.has(id));
  }

  const settled = new Set([
    ...validIds(candidate.settled_payment_ids),
    ...validIds(candidate.active_settlement_payment_ids),
  ]);
  return qrisCandidatePaymentIds(candidate).filter(
    (id) => !settled.has(id) && !unconfirmed.has(id),
  );
}

export function getUnconfirmedQrisPaymentIds(candidate: QrisCandidateLike): number[] {
  return validIds(candidate.unconfirmed_payment_ids);
}

/**
 * Classifies the visual/action state without changing approval eligibility.
 *
 * An empty live scope is only "depleted" when every snapshot payment is
 * accounted for as settled. Otherwise the candidate is stale/inconsistent and
 * must be regenerated rather than presented as a successful match.
 */
export function getQrisCandidatePresentationState(
  candidate: QrisCandidateLike,
): QrisCandidatePresentationState {
  const status = String(candidate.reconciliation_status ?? "").toUpperCase();
  if (status !== "MATCHED") return "ineligible";

  const snapshotIds = qrisCandidatePaymentIds(candidate);
  if (snapshotIds.length === 0) return "empty";
  if (getUnconfirmedQrisPaymentIds(candidate).length > 0) return "ineligible";

  const availableIds = getAvailableQrisPaymentIds(candidate);
  if (availableIds.length > 0) return "ready";

  const settled = new Set([
    ...validIds(candidate.settled_payment_ids),
    ...validIds(candidate.active_settlement_payment_ids),
  ]);
  const allSettled = snapshotIds.every((id) => settled.has(id));
  return allSettled ? "depleted" : "stale";
}