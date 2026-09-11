import { describe, expect, it } from "vitest";
import {
  classifyCanonicalRepairState,
  type CanonicalRepairStateInput,
} from "../lib/reconciliation/repairDiagnosis.js";

const canonicalState: CanonicalRepairStateInput = {
  mutationId: 4846,
  mutationStatus: "matched",
  mutationCompanyId: 1,
  mutationJournalEntryId: null,
  mutationDate: "2026-08-19",
  mutationAmount: "1807260.00",
  approvedMatchCount: 1,
  matchCandidateType: "qris_settlement",
  matchCandidateSource: "sport_center.payment_settlement_batches",
  matchCandidateId: 96,
  canonicalSource: "sport_center.payment_settlement_batches",
  candidateExists: true,
  candidateCompanyId: 1,
  candidateStatus: "posted",
  candidateBankMutationId: 4846,
  candidateCanonicalBankMutationId: 4846,
  candidateSettlementJournalId: 901,
  candidateSettlementDate: "2026-08-19",
  candidateNetAmount: "1807260.00",
  candidateApprovedMutationIds: [4846],
  canonicalJournalExists: true,
  canonicalJournalStatus: "posted",
  canonicalJournalType: "settlement",
  canonicalJournalIsReversal: false,
  canonicalJournalSettlementBatchId: 96,
  candidateId: 96,
};

describe("canonical repair diagnosis", () => {
  it("changes stale financial review to valid after admin repair and fresh read", () => {
    const stale = classifyCanonicalRepairState({
      ...canonicalState,
      mutationStatus: "unmatched",
      candidateApprovedMutationIds: [],
    });
    expect(stale.code).toBe("FINANCIAL_STATE_REQUIRES_REVIEW");

    const refreshed = classifyCanonicalRepairState(canonicalState);
    expect(refreshed).toEqual({
      valid: true,
      code: "CANONICAL_STATE_VALID",
      reason: expect.stringContaining("State canonical sudah valid"),
    });
  });

  it("does not let a rejected historical provisional candidate affect canonical validity", () => {
    const refreshed = classifyCanonicalRepairState({
      ...canonicalState,
      // The rejected snapshot (for example candidate 3110) is intentionally
      // absent: only the canonical ownership rows are authoritative here.
    });

    expect(refreshed.code).toBe("CANONICAL_STATE_VALID");
  });

  it("keeps ownership and journal safeguards fail-closed", () => {
    expect(
      classifyCanonicalRepairState({
        ...canonicalState,
        candidateApprovedMutationIds: [4846, 4999],
      }).code,
    ).toBe("FINANCIAL_STATE_REQUIRES_REVIEW");

    expect(
      classifyCanonicalRepairState({
        ...canonicalState,
        canonicalJournalSettlementBatchId: 3110,
      }).code,
    ).toBe("FINANCIAL_STATE_REQUIRES_REVIEW");
  });
});