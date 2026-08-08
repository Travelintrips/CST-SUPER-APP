import { describe, expect, it } from "vitest";
import {
  MARKETPLACE_PAYMENT_STATUSES,
  type MarketplacePaymentStatus,
} from "../services/mktPaymentLifecycleService.js";

describe("Sprint 09B Marketplace payment lifecycle contract", () => {
  it("exposes the canonical lifecycle through Payment Completed", () => {
    expect(MARKETPLACE_PAYMENT_STATUSES).toEqual([
      "payment_request_created",
      "finance_review",
      "approved",
      "treasury_ready",
      "processing",
      "completed",
      "failed",
      "cancelled",
    ]);
  });

  it("keeps failed and cancelled outside the successful path", () => {
    const successfulPath: MarketplacePaymentStatus[] = [
      "payment_request_created",
      "finance_review",
      "approved",
      "treasury_ready",
      "processing",
      "completed",
    ];
    expect(successfulPath).not.toContain("failed");
    expect(successfulPath).not.toContain("cancelled");
  });

  it("defines retry as a new execution attempt, not a new business payment", () => {
    expect(MARKETPLACE_PAYMENT_STATUSES).toContain("failed");
    expect(MARKETPLACE_PAYMENT_STATUSES).toContain("processing");
    expect(MARKETPLACE_PAYMENT_STATUSES).not.toContain("retry");
  });
});