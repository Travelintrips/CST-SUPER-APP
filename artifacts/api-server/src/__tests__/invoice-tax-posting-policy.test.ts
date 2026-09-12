import { describe, expect, it } from "vitest";
import {
  evaluateInvoiceTaxGate,
  isInvoiceTaxBalanced,
  taxAccountRoleForDirection,
} from "../lib/invoiceTaxPostingPolicy.js";

describe("invoice tax posting policy", () => {
  it("maps purchase PPN to PPN Masukan and sales PPN to PPN Keluaran", () => {
    expect(taxAccountRoleForDirection("purchase", "PPN")).toBe("PPN_INPUT");
    expect(taxAccountRoleForDirection("sale", "PPN")).toBe("PPN_OUTPUT");
    expect(taxAccountRoleForDirection("purchase", "NONE")).toBe("NONE");
  });

  it("accepts balanced header values within the accounting tolerance", () => {
    expect(isInvoiceTaxBalanced(100_000, 11_000, 111_000)).toBe(true);
    expect(isInvoiceTaxBalanced(100_000, 11_000, 111_050)).toBe(true);
    expect(isInvoiceTaxBalanced(100_000, 11_000, 111_101)).toBe(false);
  });

  it("allows a high-confidence purchase invoice to auto-post", () => {
    const result = evaluateInvoiceTaxGate({
      direction: "purchase",
      net: 100_000,
      vat: 11_000,
      gross: 111_000,
      confidence: 1,
      rawConfidence: 0.95,
      taxType: "PPN",
      validationIsValid: true,
      validationDifference: 0,
    });

    expect(result.canAutoPost).toBe(true);
    expect(result.taxAccountRole).toBe("PPN_INPUT");
    expect(result.reasons).toEqual([]);
  });

  it("keeps low-confidence or mismatched OCR in review", () => {
    const result = evaluateInvoiceTaxGate({
      direction: "purchase",
      net: 100_000,
      vat: 11_000,
      gross: 120_000,
      confidence: 0.82,
      rawConfidence: 0.7,
      taxType: "PPN",
      validationIsValid: false,
      validationDifference: 9_000,
    });

    expect(result.canAutoPost).toBe(false);
    expect(result.requiresReview).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps a missing PPN value in review instead of inventing it", () => {
    const result = evaluateInvoiceTaxGate({
      direction: "purchase",
      net: 100_000,
      vat: null,
      gross: 100_000,
      confidence: 0.95,
      rawConfidence: 0.95,
      taxType: "PPN",
      validationIsValid: true,
      validationDifference: 0,
    });

    expect(result.canAutoPost).toBe(false);
    expect(result.reasons).toContain("Invoice diklasifikasikan PPN tetapi nilai PPN tidak tersedia.");
  });
});