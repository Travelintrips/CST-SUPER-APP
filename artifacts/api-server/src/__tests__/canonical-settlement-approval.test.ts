import { describe, expect, it } from "vitest";
import {
  CANONICAL_APPROVAL_BANK_MUTATION_STATUS,
  CANONICAL_APPROVAL_CODES,
  CANONICAL_SETTLEMENT_SOURCE,
  isCanonicalApprovalIdempotentState,
  isCanonicalBankMutationEligible,
} from "../lib/reconciliation/canonicalSettlementApproval.js";

describe("Phase 4C-6 canonical link-only approval contract", () => {
  it("uses the frozen source and approved mutation status", () => {
    expect(CANONICAL_SETTLEMENT_SOURCE).toBe(
      "sport_center.payment_settlement_batches",
    );
    expect(CANONICAL_APPROVAL_BANK_MUTATION_STATUS).toBe("approved");
  });

  it.each(["matched", "auto_matched"])(
    "accepts %s as pre-approval mutation state",
    (status) => {
      expect(isCanonicalBankMutationEligible(status)).toBe(true);
    },
  );

  it.each(["need_review", "approved", "unmatched", "rejected", "posted", "reconciled"])(
    "rejects %s as pre-approval mutation state",
    (status) => {
      expect(isCanonicalBankMutationEligible(status)).toBe(false);
    },
  );

  it("recognizes only the complete same-settlement/same-mutation retry", () => {
    expect(
      isCanonicalApprovalIdempotentState({
        settlement_status: "reconciled",
        settlement_bank_mutation_id: 42,
        canonical_mutation_id: 42,
        match_status: "approved",
        canonical_mutation_status: "approved",
        public_mutation_status: "approved",
      }),
    ).toBe(true);

    expect(
      isCanonicalApprovalIdempotentState({
        settlement_status: "reconciled",
        settlement_bank_mutation_id: 99,
        canonical_mutation_id: 42,
        match_status: "approved",
        canonical_mutation_status: "approved",
        public_mutation_status: "approved",
      }),
    ).toBe(false);
  });

  it("publishes controlled duplicate/conflict codes", () => {
    expect(CANONICAL_APPROVAL_CODES.MUTATION_ALREADY_USED).toBe(
      "CANONICAL_BANK_MUTATION_ALREADY_USED",
    );
    expect(CANONICAL_APPROVAL_CODES.SETTLEMENT_ALREADY_USED).toBe(
      "CANONICAL_SETTLEMENT_ALREADY_USED",
    );
    expect(CANONICAL_APPROVAL_CODES.PAYMENT_CONFLICT).toBe(
      "CANONICAL_SETTLEMENT_PAYMENT_RECONCILIATION_CONFLICT",
    );
  });
});