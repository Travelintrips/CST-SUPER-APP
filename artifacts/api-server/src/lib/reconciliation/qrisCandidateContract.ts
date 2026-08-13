export const CANONICAL_CANDIDATE_STALE = "CANONICAL_CANDIDATE_STALE";

export interface QrisCandidateSnapshotItem {
  paymentId: number;
  grossAmount: number;
  canonicalSettlementId?: number | null;
}

export interface QrisCandidateLivePayment {
  id: number;
  amount: number;
}

export interface QrisCandidateLiveSettlement {
  paymentId: number;
  settlementId: number;
  netAmount: number;
  isPosted: boolean;
}

export interface QrisCandidateFreshnessInput {
  candidateId: number;
  candidateItems: QrisCandidateSnapshotItem[];
  candidateNetAmount: number;
  candidateMutationAmount: number;
  livePayments: QrisCandidateLivePayment[];
  liveSettlements: QrisCandidateLiveSettlement[];
}

export interface QrisCandidateStaleResult {
  code: typeof CANONICAL_CANDIDATE_STALE;
  message: "Data kandidat sudah berubah. Daftar kandidat telah diperbarui.";
  staleCandidateId: number;
  currentPaymentIds: number[];
  currentExpectedAmount: number;
  reasons: string[];
}

function ids(items: QrisCandidateSnapshotItem[]): number[] {
  return [...new Set(items.map((item) => item.paymentId))].sort((a, b) => a - b);
}

function money(value: number): number {
  return Number((Number(value) || 0).toFixed(2));
}

/**
 * Compares the persisted provisional evidence with the locked canonical
 * payment/settlement state. This is intentionally pure so generation and
 * approval tests can prove the same contract without a database.
 */
export function checkQrisCandidateFreshness(
  input: QrisCandidateFreshnessInput,
): QrisCandidateStaleResult | null {
  const candidateIds = ids(input.candidateItems);
  const paymentById = new Map(input.livePayments.map((payment) => [payment.id, payment]));
  const postedIds = new Set(
    input.liveSettlements
      .filter((settlement) => settlement.isPosted)
      .map((settlement) => settlement.paymentId),
  );
  const currentPaymentIds = candidateIds.filter(
    (paymentId) => paymentById.has(paymentId) && !postedIds.has(paymentId),
  );
  const currentSettlementRows = input.liveSettlements.filter((settlement) =>
    currentPaymentIds.includes(settlement.paymentId),
  );
  const settlementIds = [...new Set(
    currentSettlementRows.map((settlement) => settlement.settlementId),
  )];
  const currentExpectedAmount = settlementIds.length > 0
    ? money(settlementIds.reduce((sum, settlementId) => {
      const row = currentSettlementRows.find((settlement) =>
        settlement.settlementId === settlementId,
      );
      return sum + (row?.netAmount ?? 0);
    }, 0))
    : money(input.candidateMutationAmount);

  const reasons: string[] = [];
  if (
    candidateIds.length !== currentPaymentIds.length
    || candidateIds.some((paymentId, index) => paymentId !== currentPaymentIds[index])
  ) {
    reasons.push("payment membership changed or a payment is already settled");
  }

  for (const item of input.candidateItems) {
    const live = paymentById.get(item.paymentId);
    if (live && Math.abs(money(live.amount) - money(item.grossAmount)) > 0.01) {
      reasons.push(`payment ${item.paymentId} amount changed`);
    }
    const liveSettlement = input.liveSettlements.find((settlement) =>
      settlement.paymentId === item.paymentId,
    );
    if (
      item.canonicalSettlementId != null
      && liveSettlement
      && item.canonicalSettlementId !== liveSettlement.settlementId
    ) {
      reasons.push(`payment ${item.paymentId} canonical settlement changed`);
    } else if (item.canonicalSettlementId == null && liveSettlement) {
      reasons.push(`payment ${item.paymentId} gained canonical settlement evidence`);
    }
  }

  if (Math.abs(money(input.candidateNetAmount) - money(input.candidateMutationAmount)) > 0.01) {
    reasons.push("bank mutation amount changed");
  }

  return reasons.length > 0
    ? {
      code: CANONICAL_CANDIDATE_STALE,
      message: "Data kandidat sudah berubah. Daftar kandidat telah diperbarui.",
      staleCandidateId: input.candidateId,
      currentPaymentIds,
      currentExpectedAmount,
      reasons: [...new Set(reasons)],
    }
    : null;
}
