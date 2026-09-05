import { describe, expect, it } from "vitest";
import { buildInvoiceTaxReview } from "../lib/invoiceTaxReview.js";

describe("invoice tax review gate", () => {
  it("does not require review for a PPN-only invoice", () => {
    expect(buildInvoiceTaxReview({})).toEqual({
      required: false,
      status: "not_required",
      reasons: [],
      withholding_tax_type: null,
      tax_object: null,
      withholding_amount: null,
    });
  });

  it("requires review when PPh is detected but the tax object is ambiguous", () => {
    const result = buildInvoiceTaxReview({
      withholdingTaxType: "PPh 23",
      withholdingAmount: 2000,
    });
    expect(result.required).toBe(true);
    expect(result.status).toBe("required");
    expect(result.reasons).toContain("Tax object belum terbaca dengan pasti.");
  });

  it("keeps every PPh result review-only even when fields are complete", () => {
    const result = buildInvoiceTaxReview({
      withholdingTaxType: "PPh 23",
      taxObject: "jasa konsultasi",
      withholdingAmount: 2000,
    });
    expect(result.required).toBe(true);
    expect(result.reasons[0]).toContain("belum boleh ditentukan otomatis");
  });
});