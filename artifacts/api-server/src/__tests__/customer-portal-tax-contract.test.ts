import { describe, expect, it } from "vitest";
import {
  assertCustomerPortalServiceScope,
  calculateCustomerPortalExclusiveTax,
  normalizeCustomerPortalProductScope,
} from "../lib/customerPortalTaxContract.js";

describe("CF-CP-4D canonical tax contract", () => {
  it("normalizes barang to goods and calculates exclusive tax from the resolved rate", () => {
    expect(normalizeCustomerPortalProductScope("barang")).toBe("goods");
    expect(calculateCustomerPortalExclusiveTax(100000, { rate: 0.11 })).toEqual({
      taxAmount: 11000,
      grandTotal: 111000,
    });
  });

  it("fails closed for missing jasa identity and unknown scope", () => {
    expect(() => normalizeCustomerPortalProductScope("unknown")).toThrow("PRODUCT_SCOPE_INVALID");
    expect(() => assertCustomerPortalServiceScope("jasa", null)).toThrow("SERVICE_SCOPE_REQUIRED");
    expect(assertCustomerPortalServiceScope("goods", null)).toBeNull();
  });
});