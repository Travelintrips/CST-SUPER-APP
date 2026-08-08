import { describe, expect, it } from "vitest";
import {
  buildPaymentHandoffFingerprint,
  MARKETPLACE_AP_HANDOFF_SOURCE,
  validatePaymentHandoffIdempotencyKey,
} from "../mktPaymentHandoffContract.js";

describe("Sprint 09A payment handoff contract", () => {
  it("uses the Marketplace AP source discriminator", () => {
    expect(MARKETPLACE_AP_HANDOFF_SOURCE).toBe("marketplace_ap_preparation");
  });

  it("accepts bounded idempotency keys and trims whitespace", () => {
    expect(validatePaymentHandoffIdempotencyKey("  request-123456  ")).toBe("request-123456");
    expect(validatePaymentHandoffIdempotencyKey("a".repeat(128))).toHaveLength(128);
  });

  it("rejects missing, short, long, and non-string keys", () => {
    expect(validatePaymentHandoffIdempotencyKey(undefined)).toBeNull();
    expect(validatePaymentHandoffIdempotencyKey("short")).toBeNull();
    expect(validatePaymentHandoffIdempotencyKey("a".repeat(129))).toBeNull();
    expect(validatePaymentHandoffIdempotencyKey(123)).toBeNull();
  });

  it("is deterministic for the same authoritative AP payload", () => {
    const input = {
      apPreparationId: 12,
      companyId: 7,
      supplierId: 19,
      vendorInvoiceId: 22,
      currency: "idr",
      grandTotal: "125000.00",
    };
    expect(buildPaymentHandoffFingerprint(input)).toBe(buildPaymentHandoffFingerprint(input));
  });

  it("changes when an authoritative amount changes", () => {
    const base = {
      apPreparationId: 12,
      companyId: 7,
      supplierId: 19,
      vendorInvoiceId: 22,
      currency: "IDR",
      grandTotal: "125000.00",
    };
    expect(buildPaymentHandoffFingerprint(base)).not.toBe(
      buildPaymentHandoffFingerprint({ ...base, grandTotal: "125001.00" }),
    );
  });

  it("normalizes currency case but preserves company and source identity", () => {
    const base = {
      apPreparationId: 12,
      companyId: 7,
      supplierId: 19,
      vendorInvoiceId: 22,
      currency: "IDR",
      grandTotal: "125000.00",
    };
    expect(buildPaymentHandoffFingerprint(base)).toBe(
      buildPaymentHandoffFingerprint({ ...base, currency: "idr" }),
    );
    expect(buildPaymentHandoffFingerprint(base)).not.toBe(
      buildPaymentHandoffFingerprint({ ...base, companyId: 8 }),
    );
  });
});