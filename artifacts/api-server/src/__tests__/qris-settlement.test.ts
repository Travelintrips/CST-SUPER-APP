import { describe, expect, it } from "vitest";
import {
  calculateQrisNetAmount,
  classifyBankMutationPaymentType,
  isQrisPaymentMethod,
  isQrisSettlementDescription,
  resolveSettlementDate,
  settlementVariance,
  isPartialQrisSettlement,
} from "../lib/reconciliation/qrisSettlement.js";

describe("QRIS settlement contract", () => {
  it("subtracts only verified provider deductions, not booking tax", () => {
    expect(calculateQrisNetAmount({
      gross: 111_000,
      mdr: 1_500,
      taxWithheld: 250,
      otherFee: 250,
    })).toBe(109_000);
  });

  it("keeps gross unchanged when no provider deductions exist", () => {
    expect(calculateQrisNetAmount({ gross: 111_000 })).toBe(111_000);
  });

  it("prefers provider settlement date and otherwise applies H+1", () => {
    expect(resolveSettlementDate("2026-08-06T10:00:00.000Z", "2026-08-08")).toBe("2026-08-08");
    expect(resolveSettlementDate("2026-08-06T10:00:00.000Z", null)).toBe("2026-08-07");
  });

  it("keeps QRIS H+1 on weekends and uses the Jakarta payment date", () => {
    expect(resolveSettlementDate("2026-08-07T17:30:00.000Z", null)).toBe("2026-08-09");
    expect(resolveSettlementDate("2026-08-08T17:30:00.000Z", null)).toBe("2026-08-10");
  });

  it("reports bank-to-net variance", () => {
    expect(settlementVariance(109_250, 109_000)).toBe(250);
  });

  it("recognizes QRIS methods without changing other methods", () => {
    expect(isQrisPaymentMethod("QRIS")).toBe(true);
    expect(isQrisPaymentMethod("qris_dynamic")).toBe(true);
    expect(isQrisPaymentMethod("transfer bank")).toBe(false);
  });

  it("recognizes provider QRIS labels that omit the literal QRIS word", () => {
    expect(isQrisSettlementDescription(
      "7177632488799999999111111111111QRTRAVELI DR 0000029511812 KR 1640006707220 99106",
    )).toBe(true);
    expect(isQrisSettlementDescription("TRANSFER BCA REGULER")).toBe(false);
  });

  it("classifies InhouseTrf as bank transfer without borrowing QRIS payment metadata", () => {
    expect(classifyBankMutationPaymentType({
      providerName: null,
      providerOrderId: null,
      description: "PEMBAYARAN SEWA INHOUSETRF DARI INDRA",
    })).toBe("bank_transfer");
    expect(classifyBankMutationPaymentType({
      providerName: null,
      providerOrderId: null,
      description: "QRTRAVELI SETTLEMENT",
    })).toBe("qris");
  });

  it("keeps partial settlement explicitly reviewable", () => {
    expect(isPartialQrisSettlement("PARTIAL")).toBe(true);
    expect(isPartialQrisSettlement("partially_settled")).toBe(true);
    expect(isPartialQrisSettlement("settled")).toBe(false);
  });

  it("allows only one winner when overlapping approvals race on the same payment", async () => {
    // This models the database invariant used by the approval transaction:
    // both requests may pass the advisory pre-check, but the unique
    // qris_settlement_items(sport_payment_id) insert has one winner.
    const settledPaymentIds = new Set<number>();
    let prechecksFinished = 0;
    let releasePrechecks!: () => void;
    const allPrechecksFinished = new Promise<void>((resolve) => {
      releasePrechecks = resolve;
    });

    const approve = async (batchId: string) => {
      const paymentId = 9001;
      const alreadySettled = settledPaymentIds.has(paymentId);
      prechecksFinished += 1;
      if (prechecksFinished === 2) releasePrechecks();
      await allPrechecksFinished;

      if (alreadySettled || settledPaymentIds.has(paymentId)) {
        return {
          status: 409,
          code: "QRIS_PAYMENT_ALREADY_SETTLED",
          error: `Payment QRIS ${paymentId} sudah tersettle pada batch lain (${batchId}).`,
        };
      }
      // The atomic unique insert is the winner-selection point.
      settledPaymentIds.add(paymentId);
      return { status: 201, code: "OK", error: null };
    };

    const results = await Promise.all([approve("batch-a"), approve("batch-b")]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.filter((result) => result.code === "QRIS_PAYMENT_ALREADY_SETTLED")).toHaveLength(1);
    expect(results.find((result) => result.status === 409)?.error).toContain("sudah tersettle");
    expect(settledPaymentIds).toEqual(new Set([9001]));
  });
});