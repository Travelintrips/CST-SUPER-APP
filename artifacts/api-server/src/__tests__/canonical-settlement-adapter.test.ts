import { describe, expect, it } from "vitest";
import {
  CANONICAL_SETTLEMENT_SOURCE,
  CanonicalSettlementEligibilityError,
  canonicalSettlementDetailsSql,
  isCanonicalSettlementEligible,
  mapCanonicalSettlementRow,
} from "../lib/reconciliation/canonicalSettlementAdapter.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    settlement_id: 1,
    settlement_reference: "SC-SETTLE-001",
    company_id: 7,
    provider_code: "QRIS_PROVIDER",
    provider_name: "QRIS Provider",
    bank_account_id: 12,
    settlement_date: "2026-08-10",
    gross_amount: "100000",
    mdr_amount: "300",
    provider_fee_amount: "100",
    fee_tax_amount: "10",
    tax_withheld_amount: "0",
    adjustment_amount: "0",
    expected_bank_amount: "99590",
    settlement_status: "posted",
    settlement_journal_id: 44,
    bank_mutation_id: null,
    ...overrides,
  } as any;
}

describe("Phase 4C-3 canonical settlement adapter", () => {
  it("maps the exact canonical row with expected bank amount as amount", () => {
    const candidate = mapCanonicalSettlementRow(
      makeRow({
        gross_amount: "100000",
        mdr_amount: "300",
        provider_fee_amount: "0",
        fee_tax_amount: "0",
        expected_bank_amount: "99700",
      }),
    );

    expect(candidate).toMatchObject({
      id: 1,
      type: "qris_settlement",
      candidateType: "qris_settlement",
      candidateId: 1,
      candidateSource: CANONICAL_SETTLEMENT_SOURCE,
      amount: 99700,
      gross_amount: 100000,
      mdr_amount: 300,
      provider_fee_amount: 0,
      fee_tax_amount: 0,
      adjustment_amount: 0,
      expected_bank_amount: 99700,
      settlement_journal_id: 44,
    });
  });

  it.each([
    ["reconciled status", { settlement_status: "reconciled" }],
    ["linked settlement", { bank_mutation_id: 99 }],
    ["missing journal", { settlement_journal_id: null }],
    ["draft status", { settlement_status: "draft" }],
  ])("rejects %s", (_label, overrides) => {
    expect(isCanonicalSettlementEligible(makeRow(overrides))).toBe(false);
    expect(() => mapCanonicalSettlementRow(makeRow(overrides))).toThrow(
      CanonicalSettlementEligibilityError,
    );
  });

  it("uses fully-qualified canonical tables and preserves all required details", () => {
    const detailsSql = canonicalSettlementDetailsSql("m.candidate_id");

    expect(detailsSql).toContain("sport_center.expected_bank_settlements");
    expect(detailsSql).toContain("sport_center.payment_settlement_items");
    expect(detailsSql).toContain("ebs.expected_bank_amount");
    expect(detailsSql).toContain("ebs.provider_fee_amount");
    expect(detailsSql).toContain("ebs.fee_tax_amount");
    expect(detailsSql).toContain("ebs.adjustment_amount");
    expect(detailsSql).toContain("expectedAmount");
    expect(detailsSql).toContain("actualBankAmount");
    expect(detailsSql).toContain("amountDifference");
    expect(detailsSql).toContain("mutationDate");
    expect(detailsSql).toContain(CANONICAL_SETTLEMENT_SOURCE);
    expect(detailsSql).not.toContain("public.qris_settlements");
  });

  it("rejects unsafe SQL expressions", () => {
    expect(() => canonicalSettlementDetailsSql("1; DROP TABLE")).toThrow(
      "Invalid canonical settlement candidate ID expression",
    );
  });
});