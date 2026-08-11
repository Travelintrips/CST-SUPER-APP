import { describe, expect, it } from "vitest";
import {
  CANONICAL_SETTLEMENT_SOURCE,
  isCanonicalSettlementEligible,
  mapCanonicalSettlementRow,
} from "../lib/reconciliation/canonicalSettlementAdapter.js";
import {
  classifyMatch,
  scoreUnified,
  type MatchCandidate,
} from "../lib/reconciliation/unifiedMatchingEngine.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    settlement_id: 1,
    settlement_reference: "SC-SETTLE-001",
    company_id: 7,
    provider_code: "mandiri_direct",
    provider_name: "Mandiri Direct",
    bank_account_id: 12,
    settlement_date: "2026-08-10",
    gross_amount: "100000",
    mdr_amount: "300",
    provider_fee_amount: "0",
    fee_tax_amount: "0",
    tax_withheld_amount: "0",
    adjustment_amount: "0",
    expected_bank_amount: "99700",
    settlement_status: "posted",
    settlement_journal_id: 44,
    bank_mutation_id: null,
    ...overrides,
  } as any;
}

function canonicalCandidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    ...mapCanonicalSettlementRow(makeRow()),
    ...overrides,
  };
}

function mutation(overrides: Record<string, unknown> = {}) {
  return {
    amount: 99700,
    transaction_date: "2026-08-10",
    provider_order_id: null,
    uploaded_proof_url: null,
    normalized_description: "MANDIRI DIRECT SETTLEMENT",
    company_id: 7,
    bank_account_id: 12,
    provider_name: "mandiri_direct",
    ...overrides,
  } as const;
}

describe("Phase 4C-5 canonical settlement matching", () => {
  it("matches the canonical net amount and retains source-qualified identity", () => {
    const scored = scoreUnified(mutation(), canonicalCandidate());

    expect(scored.amount_match).toBe(true);
    expect(scored.candidate.candidateSource).toBe(CANONICAL_SETTLEMENT_SOURCE);
    expect(scored.candidate.amount).toBe(99700);
    expect(scored.candidate.gross_amount).toBe(100000);
  });

  it("does not treat gross equality as a canonical exact amount match", () => {
    const scored = scoreUnified(
      mutation({ amount: 100000 }),
      canonicalCandidate(),
    );

    expect(scored.amount_match).toBe(false);
    expect(scored.score).toBeLessThan(50);
  });

  it.each([
    ["reconciled", { settlement_status: "reconciled" }],
    ["linked", { bank_mutation_id: 99 }],
    ["missing journal", { settlement_journal_id: null }],
  ])("excludes %s canonical settlements", (_label, overrides) => {
    expect(isCanonicalSettlementEligible(makeRow(overrides))).toBe(false);
  });

  it("blocks company and bank-account mismatches", () => {
    expect(scoreUnified(
      mutation({ company_id: 8 }),
      canonicalCandidate(),
    ).amount_match).toBe(false);
    expect(scoreUnified(
      mutation({ bank_account_id: 99 }),
      canonicalCandidate(),
    ).amount_match).toBe(false);
  });

  it("keeps canonical approval out of the generic auto-match classifier", () => {
    const scored = scoreUnified(mutation(), canonicalCandidate());
    expect(classifyMatch(scored)).toBe("manual_review");
    // The orchestration boundary also forces manual_review when a canonical
    // candidate has enough evidence for generic auto-matching. The candidate
    // itself remains scoreable and source-qualified.
    expect(scored.candidate.candidateSource).toBe(CANONICAL_SETTLEMENT_SOURCE);
  });
});