import { describe, expect, it } from "vitest";
import {
  calculateQrisNetAmount,
  isQrisPaymentMethod,
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

  it("reports bank-to-net variance", () => {
    expect(settlementVariance(109_250, 109_000)).toBe(250);
  });

  it("recognizes QRIS methods without changing other methods", () => {
    expect(isQrisPaymentMethod("QRIS")).toBe(true);
    expect(isQrisPaymentMethod("qris_dynamic")).toBe(true);
    expect(isQrisPaymentMethod("transfer bank")).toBe(false);
  });

  it("keeps partial settlement explicitly reviewable", () => {
    expect(isPartialQrisSettlement("PARTIAL")).toBe(true);
    expect(isPartialQrisSettlement("partially_settled")).toBe(true);
    expect(isPartialQrisSettlement("settled")).toBe(false);
  });
});