import { describe, expect, it } from "vitest";
import {
  CANONICAL_SETTLEMENT_SOURCE,
  isCanonicalSettlementEligible,
  mapCanonicalSettlementRow,
} from "../lib/reconciliation/canonicalSettlementAdapter.js";
import {
  classifyMatch,
  dedupeCandidatesByIdentity,
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

  it("ranks an exact canonical settlement date above the ±1-day tolerance", () => {
    const exactDate = scoreUnified(
      mutation({ transaction_date: "2026-08-10" }),
      canonicalCandidate({ settlement_date: "2026-08-10", date: "2026-08-10" }),
    );
    const oneDayTolerance = scoreUnified(
      mutation({ transaction_date: "2026-08-10" }),
      canonicalCandidate({ id: 2, settlement_date: "2026-08-11", date: "2026-08-11" }),
    );

    expect(exactDate.amount_match).toBe(true);
    expect(oneDayTolerance.amount_match).toBe(true);
    expect(exactDate.date_match).toBe(true);
    expect(oneDayTolerance.date_match).toBe(true);
    expect(exactDate.score).toBe(80);
    expect(oneDayTolerance.score).toBe(70);
    expect(exactDate.score).toBeGreaterThan(oneDayTolerance.score);
    expect(exactDate.reason).toContain("tanggal settlement canonical tepat (+10)");
    expect(oneDayTolerance.reason).not.toContain("tanggal settlement canonical tepat (+10)");
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
    // Exact canonical-date evidence reaches the existing generic confidence
    // threshold, but the orchestration boundary still forces canonical
    // candidates to manual_review before any approval path.
    expect(classifyMatch(scored)).toBe("auto_matched");
    expect(scored.candidate.candidateSource).toBe(CANONICAL_SETTLEMENT_SOURCE);
  });

  it("deduplicates by the full source-qualified identity", () => {
    const canonical = canonicalCandidate({ id: 2 });
    const legacy = canonicalCandidate({
      id: 2,
      candidateSource: "public.qris_settlements",
    });
    const historical = canonicalCandidate({ id: 2, candidateSource: null });

    const deduped = dedupeCandidatesByIdentity([
      canonical,
      { ...canonical, scoreOnly: "duplicate" } as MatchCandidate,
      legacy,
      historical,
      { ...historical, scoreOnly: "historical duplicate" } as MatchCandidate,
    ]);

    expect(deduped).toHaveLength(3);
    expect(deduped.map((candidate) => candidate.candidateSource)).toEqual([
      CANONICAL_SETTLEMENT_SOURCE,
      "public.qris_settlements",
      null,
    ]);
  });
});