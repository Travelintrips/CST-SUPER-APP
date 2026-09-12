import { describe, expect, it } from "vitest";
import { buildSapTaxInput, runSapTaxEngine } from "../lib/sapTaxEngine.js";

describe("SAP tax extraction for DPP Nilai Lain invoices", () => {
  it("recovers PPN from an explicit breakdown when header OCR dropped it", () => {
    const input = buildSapTaxInput({
      vendor_name: "PERUSAHAAN PERSEROAN (PERSERO) PT ANGKASA PURA INDONESIA",
      subtotal: 28_553_506,
      tax: 0,
      total_amount: 28_553_506,
      invoice_breakdown: {
        totals: {
          dpp: 26_174_048,
          ppn: 3_140_886,
          gross: 29_314_934,
        },
        components: [
          { gross: 1_756_710 },
          { gross: 10_962_796 },
          { gross: 15_834_000 },
        ],
      },
    });

    expect(input.net).toBe(28_553_506);
    expect(input.vat).toBe(3_140_886);
    expect(input.gross).toBe(31_694_392);

    const result = runSapTaxEngine(input);
    expect(result.tax.type).toBe("PPN");
    expect(result.validation.is_valid).toBe(true);
    expect(result.flags[0]).toContain("TAX_RESOLVED_FROM_BREAKDOWN");
  });

  it("does not infer PPN when component evidence does not reconcile", () => {
    const input = buildSapTaxInput({
      subtotal: 100_000,
      tax: 0,
      total_amount: 100_000,
      invoice_breakdown: {
        totals: { dpp: 90_000, ppn: 10_000, gross: 100_000 },
        components: [{ gross: 95_000 }],
      },
    });

    expect(input.vat).toBe(0);
    expect(input.gross).toBe(100_000);
  });
});