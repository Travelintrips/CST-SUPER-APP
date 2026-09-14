import { describe, expect, it } from "vitest";
import {
  deriveVendorInvoicePaymentStatus,
  inferVendorInvoiceGrossSettlement,
} from "../lib/vendorInvoicePaymentStatus.js";

describe("vendor invoice payment status", () => {
  it("recognizes a net bank transfer as gross settlement when persisted PPh closes the balance", () => {
    expect(inferVendorInvoiceGrossSettlement({
      paymentAmount: 9_000,
      outstanding: 10_000,
      withholdingAmount: 1_000,
    })).toEqual({
      grossAmount: 10_000,
      withholdingAmount: 1_000,
    });
  });

  it("uses the gross balance as the comparison baseline for a persisted net payment", () => {
    const netPaid = 23_783_170;
    const grossTotal = 26_852_296;
    const withholding = 3_069_126;

    expect(inferVendorInvoiceGrossSettlement({
      paymentAmount: netPaid,
      outstanding: grossTotal,
      withholdingAmount: withholding,
    })).toEqual({
      grossAmount: grossTotal,
      withholdingAmount: withholding,
    });
  });

  it("does not credit the full PPh amount on a genuinely partial payment", () => {
    expect(inferVendorInvoiceGrossSettlement({
      paymentAmount: 4_000,
      outstanding: 10_000,
      withholdingAmount: 1_000,
    })).toEqual({
      grossAmount: 4_000,
      withholdingAmount: 0,
    });
  });

  it("keeps an invoice posted until withholding proof is complete", () => {
    expect(deriveVendorInvoicePaymentStatus({
      amountPaid: 10_000,
      grandTotal: 10_000,
      currentStatus: "posted",
      hasWithholding: true,
      withholdingComplete: false,
    })).toBe("posted");
  });

  it("marks the invoice paid after gross settlement and confirmed withholding proof", () => {
    expect(deriveVendorInvoicePaymentStatus({
      amountPaid: 10_000,
      grandTotal: 10_000,
      currentStatus: "posted",
      hasWithholding: true,
      withholdingComplete: true,
    })).toBe("paid");
  });

  it("does not use three-way match state to decide payment status", () => {
    const paymentStatus = deriveVendorInvoicePaymentStatus({
      amountPaid: 10_000,
      grandTotal: 10_000,
      currentStatus: "posted",
      hasWithholding: false,
      withholdingComplete: false,
    });
    expect(paymentStatus).toBe("paid");
    expect({ threeWayMatchStatus: "unmatched", paymentStatus }).toEqual({
      threeWayMatchStatus: "unmatched",
      paymentStatus: "paid",
    });
  });
});
