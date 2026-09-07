import { describe, expect, it } from "vitest";
import {
  assertSettlementAccounts,
  assertSettlementPeriodOpen,
  assertSettlementRows,
  assertPayrollPaymentEvidence,
  repaymentIdempotencyKey,
  settlementReference,
  settlementSourceId,
} from "../lib/payroll/payrollSettlementGuards.js";

function rows(): Array<{
  id: number;
  amount: string;
  entry_id: number | null;
  posted_at: Date | null;
  idempotency_key: string | null;
}> {
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

  it("requires one exact approved bank/payment link for the payroll run", () => {
    const evidence = {
      mutation_id: 900,
      mutation_company_id: 1,
      mutation_amount: "63210000",
      mutation_direction: "OUT",
      mutation_status: "matched",
      mutation_linked_type: "accounting_payment",
      mutation_linked_id: 901,
      mutation_reconciliation_status: "matched",
      mutation_journal_entry_id: null,
      payment_id: 901,
      payment_company_id: 1,
      payment_amount: "63210000",
      payment_status: "posted",
      payment_entry_id: null,
      payment_source_type: "payroll",
      payment_source_doc_id: 31,
      payment_source_id: null,
      match_id: 902,
      match_status: "approved",
      match_candidate_type: "accounting_payment",
      match_candidate_id: 901,
    };
    expect(assertPayrollPaymentEvidence([evidence], 1, 31, 63_210_000)).toBe(evidence);
    expect(() => assertPayrollPaymentEvidence([], 1, 31, 63_210_000))
      .toThrow("PAYROLL_PAYMENT_EVIDENCE_NOT_UNIQUE");
    expect(() => assertPayrollPaymentEvidence([{ ...evidence, mutation_amount: "63209999" }], 1, 31, 63_210_000))
      .toThrow("PAYROLL_PAYMENT_EVIDENCE_INVALID");
  });
});