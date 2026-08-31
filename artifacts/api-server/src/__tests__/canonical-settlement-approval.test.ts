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
  validateHistoricalSettlementRepairEvidence,
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

  it("recognizes only the complete same-settlement/public-mutation retry", () => {
    expect(
      isCanonicalApprovalIdempotentState({
        settlement_status: "reconciled",
        settlement_bank_mutation_id: 42,
        mutation_id: 42,
        match_status: "approved",
        public_mutation_status: "approved",
      }),
    ).toBe(true);

    expect(
      isCanonicalApprovalIdempotentState({
        settlement_status: "reconciled",
        settlement_bank_mutation_id: 99,
        mutation_id: 42,
        match_status: "approved",
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
        public_mutation_status: "unmatched",
      }),
    ).toBe(true);
    expect(
      isCanonicalReopenIdempotentState({
        settlement_status: "posted",
        settlement_bank_mutation_id: null,
        match_status: "candidate",
        public_mutation_status: "approved",
      }),
    ).toBe(false);
    expect(CANONICAL_APPROVAL_CODES.REOPEN_NOT_ELIGIBLE).toBe(
      "CANONICAL_SETTLEMENT_REOPEN_NOT_ELIGIBLE",
    );
  });

  const validHistoricalEvidence = {
    settlementStatus: "posted",
    linkedMutationId: null,
    linkedCanonicalMutationId: null,
    mutationDirection: "IN",
    mutationCompanyId: 1,
    settlementCompanyId: 1,
    mutationDate: "2026-07-13",
    settlementDate: "2026-07-13",
    mutationAmount: 873_840,
    settlementNetAmount: 873_840,
    accountMatched: true,
    journalEligible: true,
    paymentMethods: ["QRIS", "qris"],
  };

  it("accepts a posted historical batch without requiring every payment to be H-1", () => {
    expect(validateHistoricalSettlementRepairEvidence(validHistoricalEvidence)).toEqual({ ok: true });
    expect(CANONICAL_APPROVAL_CODES.HISTORICAL_REPAIR_CONFIRMATION_REQUIRED).toBe(
      "CANONICAL_HISTORICAL_REPAIR_CONFIRMATION_REQUIRED",
    );
  });

  it.each([
    ["stale state", { settlementStatus: "reconciled" }],
    ["duplicate link", { linkedMutationId: 4037 }],
    ["wrong company", { settlementCompanyId: 2 }],
    ["wrong date", { settlementDate: "2026-07-14" }],
    ["wrong net", { settlementNetAmount: 774_540 }],
    ["wrong account", { accountMatched: false }],
    ["missing journal", { journalEligible: false }],
    ["non QRIS item", { paymentMethods: ["QRIS", "BANK_TRANSFER"] }],
  ])("rejects historical repair with %s", (_label, override) => {
    expect(
      validateHistoricalSettlementRepairEvidence({
        ...validHistoricalEvidence,
        ...override,
      }),
    ).toMatchObject({ ok: false });
  });
});