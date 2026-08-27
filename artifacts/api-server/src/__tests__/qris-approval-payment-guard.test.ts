import { describe, expect, it } from "vitest";
import {
  partitionQrisCanonicalGroup,
  QrisApprovalPaymentGuardError,
  selectQrisApprovalPaymentIds,
} from "../lib/reconciliation/qrisApprovalPaymentGuard.js";

describe("QRIS supplemental approval payment guard", () => {
  it("removes a posted payment from a stale late-arriving candidate", () => {
    expect(selectQrisApprovalPaymentIds({
      candidatePaymentIds: [25, 26],
      activePostedPaymentIds: [25],
    })).toEqual([26]);
  });

  it("keeps the exact canonical payment group available for the supplemental builder", () => {
    expect(selectQrisApprovalPaymentIds({
      candidatePaymentIds: [25, 26],
      activePostedPaymentIds: [25],
    })).not.toContain(25);
  });

  it("fails closed when an explicit approval payload still includes the posted payment", () => {
    expect(() => selectQrisApprovalPaymentIds({
      candidatePaymentIds: [25, 26],
      requestedPaymentIds: [25, 26],
      activePostedPaymentIds: [25],
    })).toThrow(QrisApprovalPaymentGuardError);
    try {
      selectQrisApprovalPaymentIds({
        candidatePaymentIds: [25, 26],
        requestedPaymentIds: [25, 26],
        activePostedPaymentIds: [25],
      });
    } catch (error) {
      expect((error as QrisApprovalPaymentGuardError).code)
        .toBe("CANONICAL_SETTLEMENT_SELECTION_CONFLICT");
      expect((error as QrisApprovalPaymentGuardError).alreadySettledPaymentIds)
        .toEqual([25]);
      expect((error as QrisApprovalPaymentGuardError).eligiblePaymentIds)
        .toEqual([26]);
    }
  });

  it("does not allow a candidate containing only an already-posted payment", () => {
    expect(() => selectQrisApprovalPaymentIds({
      candidatePaymentIds: [25],
      activePostedPaymentIds: [25],
    })).toThrow("Semua payment pada kandidat");
  });

  it("partitions compatible bank-provider aliases into exact canonical groups", () => {
    expect(partitionQrisCanonicalGroup(
      [361, 362, 363, 364],
      [
        { id: 361, companyId: 1, providerCode: "mandiri_direct", bankAccountId: "17", expectedSettlementDate: "2026-08-16", settlementRuleVersion: "v1" },
        { id: 362, companyId: 1, providerCode: "mandiri_direct", bankAccountId: "17", expectedSettlementDate: "2026-08-16", settlementRuleVersion: "v1" },
        { id: 363, companyId: 1, providerCode: "mandiri_direct", bankAccountId: "17", expectedSettlementDate: "2026-08-16", settlementRuleVersion: "v1" },
        { id: 364, companyId: 1, providerCode: "gpn_qris", bankAccountId: "17", expectedSettlementDate: "2026-08-16", settlementRuleVersion: "v1" },
      ],
    )).toEqual({
      eligiblePaymentIds: [361, 362, 363],
      conflictingPaymentIds: [364],
    });
  });
});