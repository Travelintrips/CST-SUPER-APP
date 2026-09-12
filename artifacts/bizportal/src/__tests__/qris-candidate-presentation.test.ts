import { describe, expect, it } from "vitest";
import {
  getAvailableQrisPaymentIds,
  getQrisCandidatePresentationState,
  getUnconfirmedQrisPaymentIds,
} from "../lib/qrisCandidatePresentation";
import {
  classifyBankMutationPaymentType,
  isQrisBankApprovalAllowed,
} from "../lib/bankMutationPaymentType";

const item = (paymentId: number) => ({ paymentId });

describe("QRIS candidate presentation state", () => {
  it("keeps a MATCHED candidate ready when live payments remain", () => {
    const candidate = {
      reconciliation_status: "MATCHED",
      payment_items: [item(11), item(12)],
      current_payment_ids: [11],
      settled_payment_ids: [12],
    };

    expect(getAvailableQrisPaymentIds(candidate)).toEqual([11]);
    expect(getQrisCandidatePresentationState(candidate)).toBe("ready");
  });

  it("shows an exhausted MATCHED batch as completed, not as missing candidates", () => {
    const candidate = {
      reconciliation_status: "MATCHED",
      payment_items: [item(11)],
      current_payment_ids: [],
      settled_payment_ids: [11],
    };

    expect(getAvailableQrisPaymentIds(candidate)).toEqual([]);
    expect(getQrisCandidatePresentationState(candidate)).toBe("depleted");
  });

  it("distinguishes an empty MATCHED payload from a settled batch", () => {
    const candidate = {
      reconciliation_status: "MATCHED",
      payment_items: [],
      current_payment_ids: [],
      settled_payment_ids: [],
    };

    expect(getQrisCandidatePresentationState(candidate)).toBe("empty");
  });

  it("marks an empty live scope without settlement evidence as stale", () => {
    const candidate = {
      reconciliation_status: "MATCHED",
      payment_items: [item(11)],
      current_payment_ids: [],
      settled_payment_ids: [],
    };

    expect(getQrisCandidatePresentationState(candidate)).toBe("stale");
  });

  it("never creates an available payment for a non-MATCHED candidate", () => {
    expect(getQrisCandidatePresentationState({
      reconciliation_status: "REVIEW",
      payment_items: [item(11)],
      current_payment_ids: [11],
    })).toBe("ineligible");
  });

  it("keeps pending payments visible but excludes them from approval", () => {
    const candidate = {
      reconciliation_status: "MATCHED",
      payment_items: [item(361), item(364)],
      current_payment_ids: [361, 364],
      settled_payment_ids: [],
      unconfirmed_payment_ids: [364],
    };

    expect(getUnconfirmedQrisPaymentIds(candidate)).toEqual([364]);
    expect(getAvailableQrisPaymentIds(candidate)).toEqual([361]);
    expect(getQrisCandidatePresentationState(candidate)).toBe("ineligible");
  });

  it("uses active canonical settlement ids when a legacy snapshot has no live id list", () => {
    const candidate = {
      reconciliation_status: "MATCHED",
      payment_items: [item(11), item(12), item(13)],
      settled_payment_ids: [12],
      active_settlement_payment_ids: [13],
    };

    expect(getAvailableQrisPaymentIds(candidate)).toEqual([11]);
    expect(getQrisCandidatePresentationState(candidate)).toBe("ready");
  });

  it("treats a snapshot covered by active canonical settlements as depleted", () => {
    const candidate = {
      reconciliation_status: "MATCHED",
      payment_items: [item(11), item(12)],
      settled_payment_ids: [11],
      active_settlement_payment_ids: [12],
    };

    expect(getAvailableQrisPaymentIds(candidate)).toEqual([]);
    expect(getQrisCandidatePresentationState(candidate)).toBe("depleted");
  });
});

describe("QRIS bank-evidence approval boundary", () => {
  it("classifies InhouseTrf as Transfer Bank even with QRIS-looking candidate metadata", () => {
    const bankEvidence = {
      providerName: "QRIS",
      description: "PEMBAYARAN INHOUSETRF ANTAR REKENING",
    };

    expect(classifyBankMutationPaymentType(bankEvidence)).toBe("bank_transfer");
    expect(isQrisBankApprovalAllowed(bankEvidence)).toBe(false);
  });

  it("allows QRIS approval only when the bank row carries QRIS evidence", () => {
    expect(isQrisBankApprovalAllowed({
      providerName: null,
      description: "QRTRAVELI SETTLEMENT",
    })).toBe(true);
  });

  it("does not block Mandiri settlement markers SA/KR", () => {
    expect(isQrisBankApprovalAllowed({
      providerName: "Bank Mandiri",
      description: "SA 123456 KR 1640006707220",
    })).toBe(true);
  });
});