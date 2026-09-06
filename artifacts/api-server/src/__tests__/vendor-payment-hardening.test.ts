import { describe, expect, it } from "vitest";
import {
  buildGrossVendorInvoicePostingLines,
  buildNetVendorPaymentPostingLines,
  evaluateThreeWayMatchLines,
  evaluateVendorInvoicePostingGate,
} from "../lib/vendorPaymentHardening.js";
import { buildSapTaxInput } from "../lib/sapTaxEngine.js";

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

  it("creates a separate PPN Masukan debit for the Angkasa Pura tax amount", () => {
    const lines = buildGrossVendorInvoicePostingLines({
      lines: [
        { coaAccountId: 76110, subtotal: 1_756_710, description: "PEMAKAIAN AIR" },
        { coaAccountId: 76112, subtotal: 10_962_796, description: "PEMAKAIAN LISTRIK" },
        { coaAccountId: 76111, subtotal: 15_834_000, description: "PENDAPATAN KONSESI" },
      ],
      taxAmount: 3_140_886,
      ppnInputAccountId: 49_104,
      apAccountId: 49_108,
      grandTotal: 31_694_392,
    });

    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        accountId: 49_104,
        debit: 3_140_886,
        description: "PPN Masukan",
      }),
      expect.objectContaining({ accountId: 49_108, credit: 31_694_392 }),
    ]));
  });

  it("recovers posted PPN evidence when the persisted header tax is zero", () => {
    const invoice = {
      status: "posted",
      totalAmount: 28_553_506,
      taxAmount: 0,
      grandTotal: 28_553_506,
      invoiceBreakdown: {
        totals: { dpp: 26_174_048, ppn: 3_140_886, gross: 29_314_934 },
        components: [
          { gross: 1_756_710 },
          { gross: 10_962_796 },
          { gross: 15_834_000 },
        ],
      },
    };
    const resolved = buildSapTaxInput({
      subtotal: invoice.totalAmount,
      tax: invoice.taxAmount,
      total_amount: invoice.grandTotal,
      invoice_breakdown: invoice.invoiceBreakdown,
    });
    const lines = buildGrossVendorInvoicePostingLines({
      lines: [
        { coaAccountId: 76_110, subtotal: 1_756_710, description: "PEMAKAIAN AIR" },
        { coaAccountId: 76_112, subtotal: 10_962_796, description: "PEMAKAIAN LISTRIK" },
        { coaAccountId: 76_111, subtotal: 15_834_000, description: "PENDAPATAN KONSESI" },
      ],
      taxAmount: resolved.vat ?? 0,
      ppnInputAccountId: 49_104,
      apAccountId: 49_108,
      grandTotal: resolved.gross ?? 0,
    });

    expect(resolved.vat).toBe(3_140_886);
    expect(lines.filter((line) => line.accountId === 76_110)).toEqual([
      expect.objectContaining({ debit: 1_756_710 }),
    ]);
    expect(lines.filter((line) => line.accountId === 76_112)).toEqual([
      expect.objectContaining({ debit: 10_962_796 }),
    ]);
    expect(lines.filter((line) => line.accountId === 76_111)).toEqual([
      expect.objectContaining({ debit: 15_834_000 }),
    ]);
    expect(lines.filter((line) => line.accountId === 49_104 && line.debit > 0)).toHaveLength(1);
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 49_104, debit: 3_140_886, description: "PPN Masukan" }),
      expect.objectContaining({ accountId: 49_108, credit: 31_694_392 }),
    ]));
    expect(lines.reduce((sum, line) => sum + line.debit, 0))
      .toBe(lines.reduce((sum, line) => sum + line.credit, 0));
  });

});