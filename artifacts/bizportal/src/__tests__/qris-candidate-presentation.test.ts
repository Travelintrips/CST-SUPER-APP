import { describe, expect, it } from "vitest";
import {
  getAvailableQrisPaymentIds,
  getQrisCandidatePresentationState,
} from "../lib/qrisCandidatePresentation";

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
});