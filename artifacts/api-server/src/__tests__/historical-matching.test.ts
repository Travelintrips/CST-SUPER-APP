/**
 * Phase 4 — Historical Matching Engine: Unit Tests
 *
 * Pure-logic tests — no DB, no HTTP. All tests run fully offline.
 *
 * Run: pnpm --filter @workspace/api-server test
 *      or: pnpm exec vitest run src/__tests__/historical-matching.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  normalizeText,
  tokenize,
  jaccardSimilarity,
  tokenOverlapRatio,
  scoreExactNormalized,
  scoreVendorMatch,
  scoreSimilarity,
  scoreRecurringMonthly,
  scoreAmountConsistency,
  buildSuggestion,
  classifyConfidenceBand,
  SIGNAL_WEIGHTS,
  CONFIDENCE_BANDS,
  PER_RECORD_MATCH_THRESHOLD,
  type HistoricalRecord,
} from "../lib/reconciliation/historicalMatchingEngine.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<HistoricalRecord> = {}): HistoricalRecord {
  return {
    mutationId: 1,
    normalizedDescription: "biaya sewa konsesi area b",
    rawDescription: "BIAYA SEWA KONSESI AREA B",
    amount: 5_000_000,
    direction: "OUT",
    transactionDate: "2026-05-15",
    companyId: 1,
    candidateType: "expense",
    candidateId: 42,
    originalMatchScore: 90,
    vendorName: null,
    ...overrides,
  };
}

// ─── 1. normalizeText ─────────────────────────────────────────────────────────

describe("normalizeText", () => {
  it("lowercases input", () => {
    expect(normalizeText("BAYAR PLN")).toBe("bayar pln");
  });

  it("strips non-alphanumeric", () => {
    expect(normalizeText("Biaya Rp.5.000.000,-")).toBe("biaya rp 5 000 000");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeText("a   b   c")).toBe("a b c");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeText("  konsesi  ")).toBe("konsesi");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeText("")).toBe("");
  });

  it("handles special chars only", () => {
    expect(normalizeText("!@#$%")).toBe("");
  });

  it("preserves numbers", () => {
    expect(normalizeText("INV-2026-001")).toBe("inv 2026 001");
  });
});

// ─── 2. tokenize ─────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("splits on spaces and filters short tokens", () => {
    expect(tokenize("bayar pln token listrik")).toEqual(["bayar", "pln", "token", "listrik"]);
  });

  it("filters tokens shorter than 3 chars", () => {
    expect(tokenize("a bb ccc dddd")).toEqual(["ccc", "dddd"]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("returns empty array when all tokens are short", () => {
    expect(tokenize("a b c")).toEqual([]);
  });
});

// ─── 3. jaccardSimilarity ────────────────────────────────────────────────────

describe("jaccardSimilarity", () => {
  it("identical sets → 1.0", () => {
    expect(jaccardSimilarity(["biaya", "sewa"], ["biaya", "sewa"])).toBe(1);
  });

  it("disjoint sets → 0.0", () => {
    expect(jaccardSimilarity(["biaya"], ["sewa"])).toBe(0);
  });

  it("empty arrays → 0.0", () => {
    expect(jaccardSimilarity([], ["sewa"])).toBe(0);
    expect(jaccardSimilarity(["biaya"], [])).toBe(0);
    expect(jaccardSimilarity([], [])).toBe(0);
  });

  it("half overlap → correct ratio", () => {
    // |{a,b} ∩ {b,c}| = 1, |{a,b,c}| = 3 → 1/3
    const ratio = jaccardSimilarity(["aaa", "bbb"], ["bbb", "ccc"]);
    expect(ratio).toBeCloseTo(1 / 3, 4);
  });

  it("superset → correct ratio", () => {
    // |{a} ∩ {a,b,c}| = 1, union = 3 → 1/3
    const ratio = jaccardSimilarity(["aaa"], ["aaa", "bbb", "ccc"]);
    expect(ratio).toBeCloseTo(1 / 3, 4);
  });
});

// ─── 4. tokenOverlapRatio ─────────────────────────────────────────────────────

describe("tokenOverlapRatio", () => {
  it("identical arrays → 1.0", () => {
    expect(tokenOverlapRatio(["abc", "def"], ["abc", "def"])).toBe(1);
  });

  it("no overlap → 0.0", () => {
    expect(tokenOverlapRatio(["abc"], ["xyz"])).toBe(0);
  });

  it("single overlap → correct ratio", () => {
    // overlap=1, max(2,3)=3 → 1/3
    const ratio = tokenOverlapRatio(["abc", "def"], ["abc", "ghi", "jkl"]);
    expect(ratio).toBeCloseTo(1 / 3, 4);
  });

  it("empty first array → 0", () => {
    expect(tokenOverlapRatio([], ["abc"])).toBe(0);
  });

  it("empty second array → 0", () => {
    expect(tokenOverlapRatio(["abc"], [])).toBe(0);
  });
});

// ─── 5. scoreExactNormalized ─────────────────────────────────────────────────

describe("scoreExactNormalized", () => {
  it("identical strings → full 40 pts, matched=true", () => {
    const sig = scoreExactNormalized("biaya sewa konsesi", "biaya sewa konsesi");
    expect(sig.matched).toBe(true);
    expect(sig.points).toBe(SIGNAL_WEIGHTS.exact_normalized);
    expect(sig.type).toBe("exact_normalized");
  });

  it("different strings → 0 pts, matched=false", () => {
    const sig = scoreExactNormalized("biaya sewa", "bayar pln");
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("empty mutation description → 0 pts", () => {
    const sig = scoreExactNormalized("", "biaya sewa konsesi");
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("both empty → 0 pts (empty string not a valid signal)", () => {
    const sig = scoreExactNormalized("", "");
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("case-sensitive after normalization (caller must pre-normalize)", () => {
    // normalizeText output is always lowercase, so this tests the contract:
    // the function compares as-is, so uppercase would not match
    const sig = scoreExactNormalized("Biaya Sewa", "biaya sewa");
    expect(sig.matched).toBe(false);
  });

  it("maxPoints is always 40", () => {
    expect(scoreExactNormalized("a", "b").maxPoints).toBe(40);
    expect(scoreExactNormalized("a", "a").maxPoints).toBe(40);
  });
});

// ─── 6. scoreVendorMatch ─────────────────────────────────────────────────────

describe("scoreVendorMatch", () => {
  it("high token overlap on vendor name → 25 pts", () => {
    const sig = scoreVendorMatch("pt sumber jaya mandiri", "PT Sumber Jaya", null);
    expect(sig.matched).toBe(true);
    expect(sig.points).toBe(SIGNAL_WEIGHTS.vendor_match);
  });

  it("unrelated mutation and vendor → 0 pts", () => {
    const sig = scoreVendorMatch("bayar pln token listrik", "PT Sumber Jaya", null);
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("falls back to history description when vendorName is null", () => {
    const sig = scoreVendorMatch("biaya sewa konsesi area", null, "biaya sewa konsesi area b");
    // Strong overlap → should match
    expect(sig.matched).toBe(true);
    expect(sig.points).toBe(SIGNAL_WEIGHTS.vendor_match);
  });

  it("partial overlap below threshold → 0 pts", () => {
    // Single overlapping token out of 4 → ratio = 1/4 = 0.25 < 0.4
    const sig = scoreVendorMatch("biaya sewa konsesi area", "sewa xyz abc", null);
    // 'biaya', 'sewa', 'konsesi', 'area' vs 'sewa', 'xyz', 'abc'
    // overlap = 1 (sewa), max(4,3) = 4 → ratio = 0.25 < 0.4 → no match
    expect(sig.matched).toBe(false);
  });

  it("both empty → 0 pts", () => {
    const sig = scoreVendorMatch("", null, "");
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("similarityRatio is set on result", () => {
    const sig = scoreVendorMatch("pt sumber jaya", "PT Sumber Jaya", null);
    expect(sig.similarityRatio).toBeGreaterThan(0);
  });

  it("type is vendor_match", () => {
    expect(scoreVendorMatch("abc", "abc", null).type).toBe("vendor_match");
  });
});

// ─── 7. scoreSimilarity ──────────────────────────────────────────────────────

describe("scoreSimilarity", () => {
  it("identical descriptions → max 15 pts", () => {
    const sig = scoreSimilarity("biaya sewa konsesi area", "biaya sewa konsesi area");
    expect(sig.matched).toBe(true);
    expect(sig.points).toBe(SIGNAL_WEIGHTS.similarity);
  });

  it("Jaccard < 0.25 → 0 pts, matched=false", () => {
    // "aaa bbb" vs "ccc ddd eee fff" → overlap=0 → Jaccard=0
    const sig = scoreSimilarity("aaa bbb", "ccc ddd eee fff");
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("partial overlap → fractional pts between 0 and 15", () => {
    // "biaya sewa konsesi" vs "biaya sewa pdam" → overlap={'biaya','sewa'}, union=4 → Jaccard=0.5
    const sig = scoreSimilarity("biaya sewa konsesi", "biaya sewa pdam");
    expect(sig.matched).toBe(true);
    expect(sig.points).toBeGreaterThan(0);
    expect(sig.points).toBeLessThanOrEqual(SIGNAL_WEIGHTS.similarity);
  });

  it("similarityRatio is Jaccard value", () => {
    const sig = scoreSimilarity("aaa bbb ccc", "aaa bbb ccc");
    expect(sig.similarityRatio).toBeCloseTo(1, 4);
  });

  it("empty mutation description → 0 pts", () => {
    const sig = scoreSimilarity("", "biaya sewa konsesi");
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("points never exceed maxPoints", () => {
    const sig = scoreSimilarity("aaa bbb ccc ddd eee", "aaa bbb ccc ddd eee");
    expect(sig.points).toBeLessThanOrEqual(sig.maxPoints);
  });

  it("type is similarity", () => {
    expect(scoreSimilarity("abc", "abc").type).toBe("similarity");
  });
});

// ─── 8. scoreRecurringMonthly ─────────────────────────────────────────────────

describe("scoreRecurringMonthly", () => {
  const baseRecords: HistoricalRecord[] = [
    makeRecord({ transactionDate: "2026-03-15", amount: 5_000_000 }),
    makeRecord({ transactionDate: "2026-04-15", amount: 5_000_000 }),
    makeRecord({ transactionDate: "2026-05-14", amount: 5_000_000 }), // ±5 days from 15th
  ];

  it("≥ 2 distinct months with same amount + similar day → 12 pts", () => {
    const sig = scoreRecurringMonthly("2026-06-15", 5_000_000, baseRecords);
    expect(sig.matched).toBe(true);
    expect(sig.points).toBe(SIGNAL_WEIGHTS.recurring_monthly);
  });

  it("only 1 matching month → 0 pts", () => {
    const sig = scoreRecurringMonthly("2026-06-15", 5_000_000, [
      makeRecord({ transactionDate: "2026-05-15", amount: 5_000_000 }),
    ]);
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("same amount but different day (> 5 days apart) → does not count", () => {
    const records = [
      makeRecord({ transactionDate: "2026-03-01", amount: 5_000_000 }), // day 1, target day 20
      makeRecord({ transactionDate: "2026-04-01", amount: 5_000_000 }),
    ];
    const sig = scoreRecurringMonthly("2026-05-20", 5_000_000, records);
    expect(sig.matched).toBe(false);
  });

  it("different amount → does not count even with matching day", () => {
    const records = [
      makeRecord({ transactionDate: "2026-03-15", amount: 3_000_000 }),
      makeRecord({ transactionDate: "2026-04-15", amount: 3_000_000 }),
    ];
    const sig = scoreRecurringMonthly("2026-05-15", 5_000_000, records);
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("empty records → 0 pts", () => {
    const sig = scoreRecurringMonthly("2026-06-15", 5_000_000, []);
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("invalid date → 0 pts", () => {
    const sig = scoreRecurringMonthly("invalid-date", 5_000_000, baseRecords);
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("day wrap-around at month boundary (day 1 vs day 28 in Feb)", () => {
    // day 28 vs target day 1 → dayDiff=27, wrapped=min(27,3)=3 → within ±5
    const records = [
      makeRecord({ transactionDate: "2026-02-28", amount: 5_000_000 }),
      makeRecord({ transactionDate: "2026-03-28", amount: 5_000_000 }),
    ];
    const sig = scoreRecurringMonthly("2026-05-01", 5_000_000, records);
    expect(sig.matched).toBe(true);
  });

  it("sourceCount equals number of matching months", () => {
    const sig = scoreRecurringMonthly("2026-06-15", 5_000_000, baseRecords);
    expect(sig.sourceCount).toBeGreaterThanOrEqual(2);
  });

  it("type is recurring_monthly", () => {
    expect(scoreRecurringMonthly("2026-01-01", 0, []).type).toBe("recurring_monthly");
  });
});

// ─── 9. scoreAmountConsistency ────────────────────────────────────────────────

describe("scoreAmountConsistency", () => {
  it("≥ 2 records with same amount → 8 pts", () => {
    const records = [
      makeRecord({ amount: 5_000_000 }),
      makeRecord({ amount: 5_000_000 }),
    ];
    const sig = scoreAmountConsistency(5_000_000, records);
    expect(sig.matched).toBe(true);
    expect(sig.points).toBe(SIGNAL_WEIGHTS.amount_consistency);
  });

  it("only 1 matching record → 0 pts", () => {
    const sig = scoreAmountConsistency(5_000_000, [makeRecord({ amount: 5_000_000 })]);
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("no records with matching amount → 0 pts", () => {
    const records = [
      makeRecord({ amount: 3_000_000 }),
      makeRecord({ amount: 4_000_000 }),
    ];
    const sig = scoreAmountConsistency(5_000_000, records);
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("empty records → 0 pts", () => {
    const sig = scoreAmountConsistency(5_000_000, []);
    expect(sig.matched).toBe(false);
    expect(sig.points).toBe(0);
  });

  it("amount must be within 0.01 tolerance", () => {
    const records = [
      makeRecord({ amount: 5_000_000.009 }),
      makeRecord({ amount: 5_000_000.005 }),
    ];
    // Both within 0.01 of 5_000_000 → should count
    const sig = scoreAmountConsistency(5_000_000, records);
    expect(sig.matched).toBe(true);
  });

  it("sourceCount reflects number of matching records", () => {
    const records = [
      makeRecord({ amount: 5_000_000 }),
      makeRecord({ amount: 5_000_000 }),
      makeRecord({ amount: 5_000_000 }),
    ];
    const sig = scoreAmountConsistency(5_000_000, records);
    expect(sig.sourceCount).toBe(3);
  });

  it("type is amount_consistency", () => {
    expect(scoreAmountConsistency(0, []).type).toBe("amount_consistency");
  });
});

// ─── 10. classifyConfidenceBand ───────────────────────────────────────────────

describe("classifyConfidenceBand", () => {
  it("≥ 80 → high", () => {
    expect(classifyConfidenceBand(80)).toBe("high");
    expect(classifyConfidenceBand(95)).toBe("high");
    expect(classifyConfidenceBand(100)).toBe("high");
  });

  it("55–79 → medium", () => {
    expect(classifyConfidenceBand(55)).toBe("medium");
    expect(classifyConfidenceBand(70)).toBe("medium");
    expect(classifyConfidenceBand(79)).toBe("medium");
  });

  it("30–54 → low", () => {
    expect(classifyConfidenceBand(30)).toBe("low");
    expect(classifyConfidenceBand(45)).toBe("low");
    expect(classifyConfidenceBand(54)).toBe("low");
  });

  it("< 30 → none", () => {
    expect(classifyConfidenceBand(0)).toBe("none");
    expect(classifyConfidenceBand(15)).toBe("none");
    expect(classifyConfidenceBand(29)).toBe("none");
  });

  it("boundary: exactly CONFIDENCE_BANDS.HIGH → high", () => {
    expect(classifyConfidenceBand(CONFIDENCE_BANDS.HIGH)).toBe("high");
  });

  it("boundary: exactly CONFIDENCE_BANDS.MEDIUM → medium", () => {
    expect(classifyConfidenceBand(CONFIDENCE_BANDS.MEDIUM)).toBe("medium");
  });

  it("boundary: exactly CONFIDENCE_BANDS.LOW → low", () => {
    expect(classifyConfidenceBand(CONFIDENCE_BANDS.LOW)).toBe("low");
  });
});

// ─── 11. buildSuggestion ─────────────────────────────────────────────────────

describe("buildSuggestion", () => {
  const exactDesc = "biaya sewa konsesi area lantai dasar";
  const exactRecord = makeRecord({
    normalizedDescription: exactDesc,
    amount: 5_000_000,
    transactionDate: "2026-05-15",
    candidateType: "expense",
    candidateId: 42,
  });

  it("exact match across multiple months → high confidence", () => {
    const records = [
      makeRecord({ normalizedDescription: exactDesc, amount: 5_000_000, transactionDate: "2026-03-15" }),
      makeRecord({ normalizedDescription: exactDesc, amount: 5_000_000, transactionDate: "2026-04-15" }),
      makeRecord({ normalizedDescription: exactDesc, amount: 5_000_000, transactionDate: "2026-05-15" }),
    ];
    const s = buildSuggestion("expense", 42, exactDesc, "2026-06-15", 5_000_000, records);
    expect(s.confidence).toBeGreaterThanOrEqual(CONFIDENCE_BANDS.HIGH);
    expect(s.confidenceBand).toBe("high");
    expect(s.candidateType).toBe("expense");
    expect(s.candidateId).toBe(42);
  });

  it("includes all 5 signal types", () => {
    const s = buildSuggestion("expense", 42, exactDesc, "2026-06-15", 5_000_000, [exactRecord]);
    const types = s.signals.map(sig => sig.type);
    expect(types).toContain("exact_normalized");
    expect(types).toContain("vendor_match");
    expect(types).toContain("similarity");
    expect(types).toContain("recurring_monthly");
    expect(types).toContain("amount_consistency");
  });

  it("confidence never exceeds 100", () => {
    // All signals should fire → could theoretically sum > 100 without cap
    const records = [
      makeRecord({ normalizedDescription: exactDesc, amount: 5_000_000, transactionDate: "2026-03-15", vendorName: exactDesc }),
      makeRecord({ normalizedDescription: exactDesc, amount: 5_000_000, transactionDate: "2026-04-15", vendorName: exactDesc }),
      makeRecord({ normalizedDescription: exactDesc, amount: 5_000_000, transactionDate: "2026-05-15", vendorName: exactDesc }),
    ];
    const s = buildSuggestion("expense", 42, exactDesc, "2026-06-15", 5_000_000, records);
    expect(s.confidence).toBeLessThanOrEqual(100);
  });

  it("sourceCount equals number of records in group", () => {
    const records = [exactRecord, makeRecord({ ...exactRecord, mutationId: 2 })];
    const s = buildSuggestion("expense", 42, exactDesc, "2026-06-15", 5_000_000, records);
    expect(s.sourceCount).toBe(2);
  });

  it("lastApprovedDate is the most recent transactionDate", () => {
    const records = [
      makeRecord({ transactionDate: "2026-03-01" }),
      makeRecord({ transactionDate: "2026-05-20" }),
      makeRecord({ transactionDate: "2026-04-10" }),
    ];
    const s = buildSuggestion("expense", 42, exactDesc, "2026-06-15", 5_000_000, records);
    expect(s.lastApprovedDate).toBe("2026-05-20");
  });

  it("reasons array is non-empty when at least one signal fires", () => {
    const s = buildSuggestion("expense", 42, exactDesc, "2026-06-15", 5_000_000, [exactRecord]);
    expect(s.reasons.length).toBeGreaterThan(0);
  });

  it("throws when given empty records array", () => {
    expect(() => buildSuggestion("expense", 42, exactDesc, "2026-06-15", 5_000_000, [])).toThrow();
  });

  it("weak similarity only → low or medium confidence (not high)", () => {
    // Completely unrelated description → no signal fires strongly
    const record = makeRecord({ normalizedDescription: "transfer gaji karyawan bulanan", vendorName: null });
    const s = buildSuggestion("expense", 42, "bayar listrik pln kwh", "2026-06-15", 5_000_000, [record]);
    expect(s.confidence).toBeLessThan(CONFIDENCE_BANDS.HIGH);
  });
});

// ─── 12. Signal weight constants ─────────────────────────────────────────────

describe("SIGNAL_WEIGHTS contract", () => {
  it("all weights sum to 100", () => {
    const total = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it("exact_normalized weight is 40", () => {
    expect(SIGNAL_WEIGHTS.exact_normalized).toBe(40);
  });

  it("vendor_match weight is 25", () => {
    expect(SIGNAL_WEIGHTS.vendor_match).toBe(25);
  });

  it("similarity weight is 15", () => {
    expect(SIGNAL_WEIGHTS.similarity).toBe(15);
  });

  it("recurring_monthly weight is 12", () => {
    expect(SIGNAL_WEIGHTS.recurring_monthly).toBe(12);
  });

  it("amount_consistency weight is 8", () => {
    expect(SIGNAL_WEIGHTS.amount_consistency).toBe(8);
  });
});

// ─── 13. PER_RECORD_MATCH_THRESHOLD ──────────────────────────────────────────

describe("PER_RECORD_MATCH_THRESHOLD", () => {
  it("is a positive number < 100", () => {
    expect(PER_RECORD_MATCH_THRESHOLD).toBeGreaterThan(0);
    expect(PER_RECORD_MATCH_THRESHOLD).toBeLessThan(100);
  });
});

// ─── 14. Company isolation invariant ─────────────────────────────────────────

describe("Company isolation — pure signal functions do not leak", () => {
  it("records from different companies can still be scored independently (isolation is at fetch layer)", () => {
    // Pure scoring functions do not check companyId — isolation is enforced at fetchApprovedHistory.
    // This test documents that contract explicitly.
    const record = makeRecord({ companyId: 99, normalizedDescription: "biaya sewa konsesi" });
    const sig = scoreExactNormalized("biaya sewa konsesi", record.normalizedDescription);
    expect(sig.matched).toBe(true); // scoring does not care about company
    // The guarantee: fetchApprovedHistory would never return company 99 records for company 1.
  });

  it("CONFIDENCE_BANDS.HIGH boundary is 80", () => {
    expect(CONFIDENCE_BANDS.HIGH).toBe(80);
  });

  it("CONFIDENCE_BANDS.LOW boundary is 30", () => {
    expect(CONFIDENCE_BANDS.LOW).toBe(30);
  });
});

// ─── 15. Edge cases & boundary conditions ────────────────────────────────────

describe("Edge cases", () => {
  it("normalizeText + tokenize roundtrip is stable", () => {
    const s = "BIAYA KONSESI AREA B-12 / Rp.5.000.000,-";
    const norm = normalizeText(s);
    const tokens = tokenize(norm);
    expect(tokens).toContain("biaya");
    expect(tokens).toContain("konsesi");
    expect(tokens).toContain("area");
  });

  it("jaccardSimilarity is symmetric", () => {
    const a = ["biaya", "sewa", "konsesi"];
    const b = ["sewa", "konsesi", "area"];
    expect(jaccardSimilarity(a, b)).toBe(jaccardSimilarity(b, a));
  });

  it("scoreExactNormalized: whitespace difference is caught by normalization contract", () => {
    // After normalizeText, trailing/leading spaces are gone
    const norm = normalizeText("  biaya sewa  ");
    expect(norm).toBe("biaya sewa");
    const sig = scoreExactNormalized(norm, "biaya sewa");
    expect(sig.matched).toBe(true);
  });

  it("scoreSimilarity: very long description still returns ≤ maxPoints", () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const sig = scoreSimilarity(long, long);
    expect(sig.points).toBeLessThanOrEqual(SIGNAL_WEIGHTS.similarity);
  });

  it("scoreRecurringMonthly: same month counted only once", () => {
    // Two records in same month → should count as 1 month
    const records = [
      makeRecord({ transactionDate: "2026-05-14", amount: 5_000_000 }),
      makeRecord({ transactionDate: "2026-05-16", amount: 5_000_000 }),
    ];
    const sig = scoreRecurringMonthly("2026-06-15", 5_000_000, records);
    expect(sig.sourceCount).toBe(1); // only 1 distinct month
    expect(sig.matched).toBe(false); // need ≥ 2 months
  });
});
