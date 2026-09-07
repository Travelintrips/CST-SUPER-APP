import { describe, expect, it } from "vitest";
import {
  assertSettlementAccounts,
  assertSettlementPeriodOpen,
  assertSettlementRows,
  repaymentIdempotencyKey,
  settlementReference,
  settlementSourceId,
} from "../lib/payroll/payrollSettlementGuards.js";

function rows() {
  return Array.from({ length: 12 }, (_, index) => ({
    id: index + 2,
    amount: index === 0 ? "1500000" : "3221818.181818",
    entry_id: null,
    posted_at: null,
    idempotency_key: null,
  }));
}

describe("payroll kasbon settlement guards", () => {
  it("uses deterministic identities for reruns", () => {
    expect(settlementSourceId(31)).toBe(-31);
    expect(settlementReference(31, "2026-06")).toBe("PAYROLL/2026-06/R31-KASBON");
    expect(repaymentIdempotencyKey(31, 2)).toBe("PAYROLL-R31-KASBON-REPAYMENT-2");
  });

  it("accepts the exact repayment cohort", () => {
    expect(() => assertSettlementRows(rows(), 12, 36_940_000)).not.toThrow();
  });

  it("fails closed for wrong count, amount, or partial linkage", () => {
    expect(() => assertSettlementRows(rows().slice(0, 11), 12, 36_940_000))
      .toThrow("KASBON_REPAYMENT_COUNT_MISMATCH");
    expect(() => assertSettlementRows(rows(), 12, 63_210_000))
      .toThrow("KASBON_REPAYMENT_AMOUNT_MISMATCH");
    const partial = rows();
    partial[0]!.entry_id = 99;
    expect(() => assertSettlementRows(partial, 12, 36_940_000))
      .toThrow("KASBON_REPAYMENT_PARTIAL_LINK");
  });

  it("fails closed for inconsistent links, COA, and locked periods", () => {
    const inconsistent = rows().map((row) => ({ ...row, entry_id: 99, posted_at: new Date() }));
    inconsistent[1]!.entry_id = 100;
    expect(() => assertSettlementRows(inconsistent, 12, 36_940_000))
      .toThrow("KASBON_REPAYMENT_LINK_INCONSISTENT");
    expect(() => assertSettlementAccounts([
      { company_id: 1, is_active: true, is_postable: false, status: "ACTIVE" },
      { company_id: 1, is_active: true, is_postable: true, status: "ACTIVE" },
    ], 1)).toThrow("KASBON_SETTLEMENT_COA_INVALID");
    expect(() => assertSettlementPeriodOpen({ is_closed: true, override_allowed: false }, "2026-06"))
      .toThrow("PERIOD_CLOSED");
  });
});