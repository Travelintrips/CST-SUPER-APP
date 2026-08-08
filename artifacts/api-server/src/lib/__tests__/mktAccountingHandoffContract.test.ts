import { describe, expect, it } from "vitest";
import {
  buildAccountingHandoffFingerprint,
  MARKETPLACE_ACCOUNTING_HANDOFF_SOURCE,
  validateAccountingHandoffKey,
} from "../mktAccountingHandoffContract.js";

const base = {
  apPreparationId: 12,
  vendorInvoiceId: 22,
  mktPurchaseOrderId: 31,
  mktGoodsReceiptId: 44,
  paymentRequestId: 55,
  companyId: 7,
  supplierId: 19,
  currency: "IDR",
  amount: "125000.00",
  approvalState: "approved",
  paymentLifecycleState: "completed",
};

describe("Sprint 09D Marketplace → Accounting handoff contract", () => {
  it("uses an evidence-only Marketplace source", () => {
    expect(MARKETPLACE_ACCOUNTING_HANDOFF_SOURCE).toBe("marketplace_accounting_handoff");
  });

  it("accepts bounded idempotency keys and trims whitespace", () => {
    expect(validateAccountingHandoffKey("  mkt-accounting-123  ")).toBe("mkt-accounting-123");
    expect(validateAccountingHandoffKey("a".repeat(128))).toHaveLength(128);
  });

  it("rejects missing, short, long, and non-string keys", () => {
    expect(validateAccountingHandoffKey(undefined)).toBeNull();
    expect(validateAccountingHandoffKey("short")).toBeNull();
    expect(validateAccountingHandoffKey("a".repeat(129))).toBeNull();
    expect(validateAccountingHandoffKey(123)).toBeNull();
  });

  it("is deterministic and normalizes currency case", () => {
    expect(buildAccountingHandoffFingerprint(base)).toBe(
      buildAccountingHandoffFingerprint({ ...base, currency: "idr" }),
    );
  });

  it("changes when an authoritative reference or amount changes", () => {
    expect(buildAccountingHandoffFingerprint(base)).not.toBe(
      buildAccountingHandoffFingerprint({ ...base, amount: "125001.00" }),
    );
    expect(buildAccountingHandoffFingerprint(base)).not.toBe(
      buildAccountingHandoffFingerprint({ ...base, paymentRequestId: 56 }),
    );
  });
});