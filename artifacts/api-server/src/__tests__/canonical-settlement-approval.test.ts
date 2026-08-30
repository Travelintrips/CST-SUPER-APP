import { describe, expect, it } from "vitest";
import {
  CANONICAL_APPROVAL_BANK_MUTATION_STATUS,
  CANONICAL_APPROVAL_CODES,
  CANONICAL_REOPEN_BANK_MUTATION_STATUS,
  CANONICAL_REOPEN_MATCH_STATUS,
  CANONICAL_REOPEN_SETTLEMENT_STATUS,
  CANONICAL_SETTLEMENT_SOURCE,
  isCanonicalApprovalIdempotentState,
  isCanonicalBankMutationEligible,
  isCanonicalReopenIdempotentState,
} from "../lib/reconciliation/canonicalSettlementApproval.js";

describe("Phase 4C-6 canonical link-only approval contract", () => {
  it("uses the frozen source and approved mutation status", () => {
    expect(CANONICAL_SETTLEMENT_SOURCE).toBe(
      "sport_center.payment_settlement_batches",
    );
    expect(CANONICAL_APPROVAL_BANK_MUTATION_STATUS).toBe("approved");
    expect(CANONICAL_REOPEN_BANK_MUTATION_STATUS).toBe("unmatched");
    expect(CANONICAL_REOPEN_SETTLEMENT_STATUS).toBe("posted");
    expect(CANONICAL_REOPEN_MATCH_STATUS).toBe("candidate");
  });

  it.each(["unmatched", "matched", "auto_matched"])(
    "accepts %s as pre-approval mutation state",
    (status) => {
      expect(isCanonicalBankMutationEligible(status)).toBe(true);
    },
  );

  it.each(["need_review", "approved", "rejected", "posted", "reconciled"])(
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
    expect(CANONICAL_APPROVAL_CODES.GENERIC_JOURNAL_ALREADY_EXISTS).toBe(
      "CANONICAL_GENERIC_JOURNAL_ALREADY_EXISTS",
    );
  });

  it("models canonical reopen as link removal, not accounting reversal", () => {
    expect(
      isCanonicalReopenIdempotentState({
        settlement_status: "posted",
        settlement_bank_mutation_id: null,
        match_status: "candidate",
        canonical_mutation_status: "unmatched",
        public_mutation_status: "unmatched",
      }),
    ).toBe(true);
    expect(
      isCanonicalReopenIdempotentState({
        settlement_status: "posted",
        settlement_bank_mutation_id: null,
        match_status: "candidate",
        canonical_mutation_status: "unmatched",
        public_mutation_status: "approved",
      }),
    ).toBe(false);
    expect(CANONICAL_APPROVAL_CODES.REOPEN_NOT_ELIGIBLE).toBe(
      "CANONICAL_SETTLEMENT_REOPEN_NOT_ELIGIBLE",
    );
  });
});