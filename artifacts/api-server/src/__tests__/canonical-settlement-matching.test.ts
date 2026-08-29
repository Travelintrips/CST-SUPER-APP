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
import { resolveQrisProviderFromEvidence } from "../lib/reconciliation/providerSettlementRules.js";

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

  it("keeps a canonical amount variance reviewable and exposes signed variance", () => {
    const scored = scoreUnified(
      mutation({ amount: 933420 }),
      canonicalCandidate({
        expected_bank_amount: 935000,
        amount: 935000,
        settlement_date: "2026-08-10",
        date: "2026-08-10",
        variance_eligible: true,
      }),
    );

    expect(scored.amount_match).toBe(false);
    expect(scored.amount_variance_match).toBe(true);
    expect(scored.variance_amount).toBe(-1580);
    expect(scored.variance_percent).toBeCloseTo(0.16898, 4);
    expect(scored.reason).toContain("canonical variance — perlu review");
  });

  it("resolves the bank-side provider from QRTRAVELI evidence when provider_name is generic QRIS", () => {
    expect(resolveQrisProviderFromEvidence({
      providerName: "QRIS",
      description: "7177 QRTRAVELI CC Merchant Paymt KR 1640006707220",
    })).toBe("gpn_qris");

    const scored = scoreUnified(
      mutation({
        amount: 158880,
        provider_name: "QRIS",
        normalized_description: "7177 QRTRAVELI CC MERCHANT PAYMT KR 1640006707220",
      }),
      canonicalCandidate({
        expected_bank_amount: 159520,
        amount: 159520,
        provider_code: "mandiri_direct",
        bank_account_id: 12,
        variance_eligible: true,
      }),
    );

    expect(scored.amount_match).toBe(false);
    expect(scored.amount_variance_match).toBe(true);
    expect(scored.variance_amount).toBe(-640);
    expect(scored.reason).toContain("canonical variance — perlu review");
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

  it("blocks provider mismatch before exact amount scoring", () => {
    const scored = scoreUnified(
      mutation({ provider_name: "paylabs" }),
      canonicalCandidate(),
    );

    expect(scored.amount_match).toBe(false);
    expect(scored.reason.join(" ")).toContain("provider tidak cocok");
  });

  it("fails closed when a QRIS identity is missing", () => {
    expect(scoreUnified(
      mutation({ company_id: null, provider_name: null }),
      canonicalCandidate(),
    ).amount_match).toBe(false);
    expect(scoreUnified(
      mutation({ provider_name: null, normalized_description: "QRIS SETTLEMENT" }),
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

  it("requires the same date for generic bank-transfer candidates", () => {
    const candidate: MatchCandidate = {
      id: 91,
      type: "accounting_payment",
      candidateSource: null,
      amount: 3000000,
      date: "2026-08-04",
      company_id: 7,
      ref: null,
      name: "Vendor",
    };
    const sameDay = scoreUnified(
      mutation({
        amount: 3000000,
        transaction_date: "2026-08-04",
        provider_name: "BCA",
        normalized_description: "TRANSFER VENDOR",
      }),
      candidate,
    );
    const nextDay = scoreUnified(
      mutation({
        amount: 3000000,
        transaction_date: "2026-08-05",
        provider_name: "BCA",
        normalized_description: "TRANSFER VENDOR",
      }),
      candidate,
    );

    expect(sameDay.amount_match).toBe(true);
    expect(sameDay.date_match).toBe(true);
    expect(sameDay.score).toBe(80);
    expect(nextDay.amount_match).toBe(true);
    expect(nextDay.date_match).toBe(false);
    expect(nextDay.score).toBe(60);
    expect(classifyMatch(nextDay)).toBe("unmatched");
  });
});