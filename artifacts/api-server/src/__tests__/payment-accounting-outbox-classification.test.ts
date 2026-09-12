import { describe, expect, it } from "vitest";
import { classifyPaymentAccountingOutbox } from "../lib/jobs/paymentAccountingOutboxClassification.js";

describe("payment accounting outbox classification", () => {
  const failed = {
    status: "failed",
    rowText: '{"error_code":"PAYMENT_ACCOUNTING_INCOMPLETE"}',
  };

  it("treats a failed row with a posted canonical journal as recovered", () => {
    expect(classifyPaymentAccountingOutbox({
      ...failed,
      hasPostedPaymentJournal: true,
    })).toBe("RECOVERED");
  });

  it("keeps a failed row without canonical journal evidence active", () => {
    expect(classifyPaymentAccountingOutbox({
      ...failed,
      hasPostedPaymentJournal: false,
    })).toBe("ACTIVE_FAILURE");
  });

  it("ignores successful or unrelated outbox rows", () => {
    expect(classifyPaymentAccountingOutbox({
      status: "done",
      rowText: '{"error_code":"PAYMENT_ACCOUNTING_INCOMPLETE"}',
      hasPostedPaymentJournal: false,
    })).toBe("IGNORE");
    expect(classifyPaymentAccountingOutbox({
      status: "failed",
      rowText: '{"error_code":"OTHER_FAILURE"}',
      hasPostedPaymentJournal: false,
    })).toBe("IGNORE");
  });
});