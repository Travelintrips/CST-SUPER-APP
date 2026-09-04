import { describe, expect, it } from "vitest";
import {
  buildGrossVendorInvoicePostingLines,
  buildNetVendorPaymentPostingLines,
  evaluateThreeWayMatchLines,
  evaluateVendorInvoicePostingGate,
} from "../lib/vendorPaymentHardening.js";

describe("vendor payment hardening", () => {
  it("requires a Finance-confirmed COA on every invoice line", () => {
    const result = evaluateVendorInvoicePostingGate({
      lines: [
        { id: 1, subtotal: 100, coaAccountId: 101, coaResolutionStatus: "confirmed" },
        { id: 2, subtotal: 200, coaHint: "jasa", coaResolutionStatus: "unresolved" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "COA_CONFIRMATION_REQUIRED", lineId: 2 }),
    ]));
  });

  it("allows invoice posting before proof receipt, but only after tax review and record creation", () => {
    const base = {
      lines: [{ id: 1, subtotal: 1_000, coaAccountId: 101, coaResolutionStatus: "confirmed" }],
      withholdingTaxes: [{
        invoiceLineId: 1,
        taxType: "PPh 23",
        taxObject: "jasa",
        taxAmount: 20,
        liabilityAccountId: 202,
        resolutionStatus: "confirmed",
        withholdingRecordStatus: "proof_pending",
      }],
    } as const;

    expect(evaluateVendorInvoicePostingGate({
      ...base,
      withholdingTaxes: [{ ...base.withholdingTaxes[0], withholdingRecordStatus: undefined }],
    }).ok).toBe(false);
    expect(evaluateVendorInvoicePostingGate(base).ok).toBe(true);
  });

  it("blocks three-way variance outside the configured tolerance", () => {
    const result = evaluateThreeWayMatchLines(
      [{
        poLineId: 11,
        invoiceQuantity: 10,
        invoiceUnitPrice: 100,
        acceptedQuantity: 9,
        poUnitPrice: 100,
      }],
      { total: 1_000, poTotal: 900, tolerance: 0.01 },
    );

    expect(result.ok).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "QUANTITY_OUT_OF_TOLERANCE",
      "TOTAL_OUT_OF_TOLERANCE",
    ]));
  });

  it("posts gross AP and settles it with net bank plus separate PPh liability", () => {
    const invoiceLines = buildGrossVendorInvoicePostingLines({
      lines: [
        { coaAccountId: 101, subtotal: 600, description: "Sewa" },
        { coaAccountId: 102, subtotal: 400, description: "Konsultasi" },
      ],
      taxAmount: 110,
      ppnInputAccountId: 301,
      apAccountId: 401,
      grandTotal: 1_110,
    });
    expect(invoiceLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 101, debit: 600 }),
      expect.objectContaining({ accountId: 102, debit: 400 }),
      expect.objectContaining({ accountId: 401, credit: 1_110 }),
    ]));

    const paymentLines = buildNetVendorPaymentPostingLines({
      apAccountId: 401,
      bankAccountId: 501,
      grossPayment: 1_110,
      withholdingByAccount: new Map([[202, 20], [203, 10]]),
    });
    expect(paymentLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 401, debit: 1_110 }),
      expect.objectContaining({ accountId: 202, credit: 20 }),
      expect.objectContaining({ accountId: 203, credit: 10 }),
      expect.objectContaining({ accountId: 501, credit: 1_080 }),
    ]));
  });
});