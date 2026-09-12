export type CanonicalRepairStateInput = {
  mutationId: number;
  mutationStatus: string;
  mutationCompanyId: number | null;
  mutationJournalEntryId: number | null;
  mutationDate: string | null;
  mutationAmount: number | string | null;
  approvedMatchCount: number;
  matchCandidateType: string | null;
  matchCandidateSource: string | null;
  matchCandidateId: number | string | null;
  canonicalSource: string;
  candidateExists: boolean;
  candidateCompanyId: number | null;
  candidateStatus: string | null;
  candidateBankMutationId: number | null;
  candidateCanonicalBankMutationId: number | null;
  candidateSettlementJournalId: number | null;
  candidateSettlementDate: string | null;
  candidateNetAmount: number | string | null;
  candidateApprovedMutationIds: number[];
  canonicalJournalExists: boolean;
  canonicalJournalStatus: string | null;
  canonicalJournalType: string | null;
  canonicalJournalIsReversal: boolean | null;
  canonicalJournalSettlementBatchId: number | null;
  candidateId: number;
};

export type CanonicalRepairStateResult = {
  valid: boolean;
  code: "CANONICAL_STATE_VALID" | "FINANCIAL_STATE_REQUIRES_REVIEW";
  reason: string;
};

const amountMatches = (left: number | string | null, right: number | string | null) =>
  left != null && right != null && Math.abs(Number(left) - Number(right)) <= 0.001;

const sameDate = (left: string | null, right: string | null) =>
  left != null && right != null && String(left).slice(0, 10) === String(right).slice(0, 10);

/**
 * Canonical ownership is already valid when the public mutation is only linked
 * to one source-aware match and the canonical batch remains in a valid
 * settlement state with a consistent settlement journal. A reconciled batch is
 * already a completed canonical state, not a financial inconsistency. This is
 * a read-only classification; it never repairs or weakens an approval/posting
 * guard.
 */
export function classifyCanonicalRepairState(
  state: CanonicalRepairStateInput,
): CanonicalRepairStateResult {
  const approvedMutationIds = state.candidateApprovedMutationIds.filter(
    (mutationId) => Number.isSafeInteger(mutationId) && mutationId > 0,
  );
  const hasNoOtherApprovedOwner = approvedMutationIds.every(
    (mutationId) => mutationId === state.mutationId,
  );
  const linkedMutationIds = [
    state.candidateBankMutationId,
    state.candidateCanonicalBankMutationId,
  ].filter((value): value is number => value != null);
  const hasNoOwnershipConflict = linkedMutationIds.every(
    (mutationId) => mutationId === state.mutationId,
  );
  const candidateOwnsMutation =
    (state.candidateBankMutationId == null || state.candidateBankMutationId === state.mutationId)
    && (
      state.candidateCanonicalBankMutationId == null
      || state.candidateCanonicalBankMutationId === state.mutationId
    );
  const candidateSettlementStatus = state.candidateStatus?.toLowerCase();
  const candidateSettlementIsValid =
    candidateSettlementStatus === "posted"
    || candidateSettlementStatus === "reconciled";
  const journalIsValid =
    state.candidateSettlementJournalId != null
    && state.canonicalJournalExists
    && state.canonicalJournalStatus?.toLowerCase() === "posted"
    && state.canonicalJournalType?.toLowerCase() === "settlement"
    && state.canonicalJournalIsReversal === false
    && state.canonicalJournalSettlementBatchId === state.candidateId;

  const valid =
    state.mutationStatus === "matched"
    && state.mutationJournalEntryId == null
    && state.approvedMatchCount === 1
    && state.matchCandidateType === "qris_settlement"
    && state.matchCandidateSource === state.canonicalSource
    && Number(state.matchCandidateId) === state.candidateId
    && state.candidateExists
    && candidateSettlementIsValid
    && state.candidateCompanyId === state.mutationCompanyId
    && candidateOwnsMutation
    && approvedMutationIds.length === 1
    && hasNoOwnershipConflict
    && hasNoOtherApprovedOwner
    && sameDate(state.candidateSettlementDate, state.mutationDate)
    && amountMatches(state.candidateNetAmount, state.mutationAmount)
    && journalIsValid;

  return valid
    ? {
        valid: true,
        code: "CANONICAL_STATE_VALID",
        reason:
          "State canonical sudah valid: mutasi matched, tepat satu approved match source-aware, " +
          "batch canonical dimiliki mutasi ini, dan settlement journal posted konsisten.",
      }
    : {
        valid: false,
        code: "FINANCIAL_STATE_REQUIRES_REVIEW",
        reason: "Kondisi menyentuh journal/ledger posted, settlement canonical, atau ownership match yang belum konsisten.",
      };
}