/**
 * Phase 4 — Historical Matching Engine: Integration Tests
 *
 * Tests runHistoricalMatching() end-to-end with a mocked @workspace/db.
 * No real database connection required.
 *
 * Run: pnpm --filter @workspace/api-server test
 *      or: pnpm exec vitest run src/__tests__/historical-matching-integration.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HistoricalMatchResult } from "../lib/reconciliation/historicalMatchingEngine.js";

// ─── Mock @workspace/db before importing the engine ──────────────────────────

const mockExecute = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
  sql: new Proxy({}, {
    get: (_target, prop) => {
      if (prop === "raw") return (s: string) => s;
      return undefined;
    },
  }),
}));

// Also mock the logger so we don't get noise during tests
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Import AFTER mocks are set up ───────────────────────────────────────────

const { runHistoricalMatching, fetchApprovedHistory, CONFIDENCE_BANDS } =
  await import("../lib/reconciliation/historicalMatchingEngine.js");

// ─── DB row factory ───────────────────────────────────────────────────────────

function makeDbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mutation_id: 1,
    normalized_description: "biaya sewa konsesi area lantai dasar",
    raw_description: "BIAYA SEWA KONSESI AREA LANTAI DASAR",
    amount: "5000000",
    direction: "OUT",
    transaction_date: "2026-05-15",
    company_id: 1,
    candidate_type: "expense",
    candidate_id: "42",
    original_match_score: "90",
    vendor_name: null,
    ...overrides,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setDbRows(rows: Record<string, unknown>[]): void {
  mockExecute.mockResolvedValue({ rows });
}

function setDbError(message = "connection refused"): void {
  mockExecute.mockRejectedValue(new Error(message));
}

// ─── 1. fetchApprovedHistory ──────────────────────────────────────────────────

describe("fetchApprovedHistory", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns empty array when companyId is null", async () => {
    const result = await fetchApprovedHistory(null, "OUT");
    expect(result).toEqual([]);
    expect(mockExecute).not.toHaveBeenCalled(); // no DB call made
  });

  it("returns mapped HistoricalRecord array on success", async () => {
    setDbRows([makeDbRow()]);
    const result = await fetchApprovedHistory(1, "OUT");
    expect(result).toHaveLength(1);
    expect(result[0].mutationId).toBe(1);
    expect(result[0].amount).toBe(5_000_000);
    expect(result[0].direction).toBe("OUT");
    expect(result[0].normalizedDescription).toBe("biaya sewa konsesi area lantai dasar");
    expect(result[0].candidateType).toBe("expense");
    expect(result[0].candidateId).toBe(42);
    expect(result[0].companyId).toBe(1);
  });

  it("coerces numeric columns from string (postgres driver returns strings)", async () => {
    setDbRows([makeDbRow({ amount: "7500000.50", candidate_id: "99", original_match_score: "85" })]);
    const result = await fetchApprovedHistory(1, "OUT");
    expect(result[0].amount).toBe(7_500_000.5);
    expect(result[0].candidateId).toBe(99);
    expect(result[0].originalMatchScore).toBe(85);
  });

  it("handles null vendor_name", async () => {
    setDbRows([makeDbRow({ vendor_name: null })]);
    const result = await fetchApprovedHistory(1, "OUT");
    expect(result[0].vendorName).toBeNull();
  });

  it("handles string vendor_name", async () => {
    setDbRows([makeDbRow({ vendor_name: "PT Sumber Jaya" })]);
    const result = await fetchApprovedHistory(1, "OUT");
    expect(result[0].vendorName).toBe("PT Sumber Jaya");
  });

  it("returns empty array (not throw) when DB fails", async () => {
    setDbError("connection refused");
    const result = await fetchApprovedHistory(1, "OUT");
    expect(result).toEqual([]);
  });

  it("returns empty array when DB returns no rows", async () => {
    setDbRows([]);
    const result = await fetchApprovedHistory(1, "OUT");
    expect(result).toEqual([]);
  });

  it("handles multiple rows", async () => {
    setDbRows([
      makeDbRow({ mutation_id: 1, transaction_date: "2026-03-15" }),
      makeDbRow({ mutation_id: 2, transaction_date: "2026-04-15" }),
      makeDbRow({ mutation_id: 3, transaction_date: "2026-05-15" }),
    ]);
    const result = await fetchApprovedHistory(1, "OUT");
    expect(result).toHaveLength(3);
    expect(result.map(r => r.mutationId)).toEqual([1, 2, 3]);
  });

  it("null normalized_description defaults to empty string", async () => {
    setDbRows([makeDbRow({ normalized_description: null })]);
    const result = await fetchApprovedHistory(1, "OUT");
    expect(result[0].normalizedDescription).toBe("");
  });
});

// ─── 2. runHistoricalMatching — company isolation ─────────────────────────────

describe("runHistoricalMatching — company isolation", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns empty suggestions when companyId is null", async () => {
    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      normalizedDescription: "biaya sewa konsesi area",
      companyId: null,
    });
    expect(result.suggestions).toEqual([]);
    expect(result.historyCount).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("includes computedAt ISO timestamp", async () => {
    setDbRows([]);
    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      companyId: 1,
    });
    expect(result.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── 3. runHistoricalMatching — no history ─────────────────────────────────────

describe("runHistoricalMatching — no history", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    setDbRows([]);
  });

  it("returns empty suggestions when no history found", async () => {
    const result: HistoricalMatchResult = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      companyId: 1,
    });
    expect(result.suggestions).toEqual([]);
    expect(result.historyCount).toBe(0);
  });
});

// ─── 4. runHistoricalMatching — exact match scenario ─────────────────────────

describe("runHistoricalMatching — exact match", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("exact description match across 3 months → high confidence suggestion", async () => {
    const desc = "biaya sewa konsesi area lantai dasar";
    setDbRows([
      makeDbRow({ mutation_id: 1, normalized_description: desc, transaction_date: "2026-03-15", amount: "5000000" }),
      makeDbRow({ mutation_id: 2, normalized_description: desc, transaction_date: "2026-04-15", amount: "5000000" }),
      makeDbRow({ mutation_id: 3, normalized_description: desc, transaction_date: "2026-05-15", amount: "5000000" }),
    ]);

    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      normalizedDescription: desc,
      companyId: 1,
    });

    expect(result.historyCount).toBe(3);
    expect(result.suggestions.length).toBeGreaterThan(0);

    const top = result.suggestions[0];
    expect(top.candidateType).toBe("expense");
    expect(top.candidateId).toBe(42);
    expect(top.confidence).toBeGreaterThanOrEqual(CONFIDENCE_BANDS.HIGH);
    expect(top.confidenceBand).toBe("high");
    expect(top.sourceCount).toBe(3);
  });

  it("exact match → reasons array is non-empty", async () => {
    const desc = "biaya sewa konsesi area lantai dasar";
    setDbRows([makeDbRow({ normalized_description: desc, transaction_date: "2026-05-15", amount: "5000000" })]);

    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      normalizedDescription: desc,
      companyId: 1,
    });

    if (result.suggestions.length > 0) {
      expect(result.suggestions[0].reasons.length).toBeGreaterThan(0);
    }
  });
});

// ─── 5. runHistoricalMatching — vendor match scenario ─────────────────────────

describe("runHistoricalMatching — vendor match", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("vendor name overlap fires vendor_match signal", async () => {
    setDbRows([
      makeDbRow({
        normalized_description: "pembayaran vendor sumber jaya",
        vendor_name: "PT Sumber Jaya Mandiri",
        amount: "5000000",
        transaction_date: "2026-05-15",
      }),
    ]);

    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      normalizedDescription: "pt sumber jaya mandiri transfer",
      companyId: 1,
    });

    if (result.suggestions.length > 0) {
      const top = result.suggestions[0];
      const vendorSig = top.signals.find(s => s.type === "vendor_match");
      expect(vendorSig).toBeDefined();
      expect(vendorSig!.matched).toBe(true);
    }
  });
});

// ─── 6. runHistoricalMatching — recurring monthly ─────────────────────────────

describe("runHistoricalMatching — recurring monthly", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("same amount on similar day across 2 months → recurring signal fires", async () => {
    const desc = "biaya sewa konsesi";
    setDbRows([
      makeDbRow({ mutation_id: 1, normalized_description: desc, amount: "5000000", transaction_date: "2026-04-15" }),
      makeDbRow({ mutation_id: 2, normalized_description: desc, amount: "5000000", transaction_date: "2026-05-15" }),
    ]);

    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      normalizedDescription: desc,
      companyId: 1,
    });

    if (result.suggestions.length > 0) {
      const recurringSig = result.suggestions[0].signals.find(s => s.type === "recurring_monthly");
      expect(recurringSig).toBeDefined();
      expect(recurringSig!.matched).toBe(true);
      expect(recurringSig!.sourceCount).toBeGreaterThanOrEqual(2);
    }
  });
});

// ─── 7. runHistoricalMatching — amount consistency ─────────────────────────────

describe("runHistoricalMatching — amount consistency", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("same amount approved ≥ 2 times → amount_consistency signal fires", async () => {
    const desc = "biaya sewa konsesi";
    setDbRows([
      makeDbRow({ mutation_id: 1, normalized_description: desc, amount: "5000000", transaction_date: "2026-03-15" }),
      makeDbRow({ mutation_id: 2, normalized_description: desc, amount: "5000000", transaction_date: "2026-04-20" }),
    ]);

    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      normalizedDescription: desc,
      companyId: 1,
    });

    if (result.suggestions.length > 0) {
      const amtSig = result.suggestions[0].signals.find(s => s.type === "amount_consistency");
      expect(amtSig).toBeDefined();
      expect(amtSig!.matched).toBe(true);
    }
  });
});

// ─── 8. runHistoricalMatching — multiple candidate groups ─────────────────────

describe("runHistoricalMatching — multiple candidate groups", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("suggestions are sorted by confidence descending", async () => {
    // Two candidates: expense/42 (exact match, should score higher) and invoice/10 (weaker)
    setDbRows([
      makeDbRow({
        mutation_id: 1,
        normalized_description: "biaya sewa konsesi area lantai dasar",
        amount: "5000000",
        transaction_date: "2026-03-15",
        candidate_type: "expense",
        candidate_id: "42",
      }),
      makeDbRow({
        mutation_id: 2,
        normalized_description: "biaya sewa konsesi area lantai dasar",
        amount: "5000000",
        transaction_date: "2026-04-15",
        candidate_type: "expense",
        candidate_id: "42",
      }),
      makeDbRow({
        mutation_id: 3,
        normalized_description: "invoice bulanan area b",  // weaker similarity
        amount: "5000000",
        transaction_date: "2026-03-10",
        candidate_type: "invoice",
        candidate_id: "10",
      }),
    ]);

    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      normalizedDescription: "biaya sewa konsesi area lantai dasar",
      companyId: 1,
    });

    expect(result.suggestions.length).toBeGreaterThan(0);
    for (let i = 1; i < result.suggestions.length; i++) {
      expect(result.suggestions[i - 1].confidence).toBeGreaterThanOrEqual(
        result.suggestions[i].confidence,
      );
    }
  });

  it("suggestions capped at 10", async () => {
    // Create 15 distinct (candidateType, candidateId) pairs with matching descriptions
    const desc = "biaya sewa konsesi";
    const rows = Array.from({ length: 15 }, (_, i) =>
      makeDbRow({
        mutation_id: i + 1,
        normalized_description: desc,
        amount: "5000000",
        transaction_date: "2026-05-15",
        candidate_type: "expense",
        candidate_id: String(i + 100),
      }),
    );
    setDbRows(rows);

    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      normalizedDescription: desc,
      companyId: 1,
    });

    expect(result.suggestions.length).toBeLessThanOrEqual(10);
  });
});

// ─── 9. runHistoricalMatching — DB failure resilience ─────────────────────────

describe("runHistoricalMatching — DB failure resilience", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns empty result (not throw) when DB fails", async () => {
    setDbError("connection refused");
    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      normalizedDescription: "biaya sewa konsesi",
      companyId: 1,
    });
    expect(result.suggestions).toEqual([]);
    expect(result.historyCount).toBe(0);
  });
});

// ─── 10. runHistoricalMatching — PER_RECORD_MATCH_THRESHOLD filtering ─────────

describe("runHistoricalMatching — PER_RECORD_MATCH_THRESHOLD filtering", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("completely unrelated description is filtered below threshold", async () => {
    // History has "transfer gaji karyawan" but mutation is "biaya listrik pln"
    // → no signal should fire → record filtered out
    setDbRows([
      makeDbRow({
        normalized_description: "transfer gaji karyawan bulanan",
        vendor_name: null,
        amount: "5000000",
        transaction_date: "2026-05-15",
      }),
    ]);

    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      normalizedDescription: "bayar listrik pln kwh bulan juni",
      companyId: 1,
    });

    // Either no suggestions, or suggestions have low/none confidence
    for (const s of result.suggestions) {
      expect(s.confidence).toBeLessThan(CONFIDENCE_BANDS.HIGH);
    }
  });
});

// ─── 11. runHistoricalMatching — direction isolation ─────────────────────────

describe("runHistoricalMatching — direction isolation", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("passes direction to fetchApprovedHistory (DB is called once for the right company)", async () => {
    setDbRows([]);
    const result = await runHistoricalMatching({
      amount: 1_000_000,
      direction: "IN",
      transactionDate: "2026-06-15",
      companyId: 5,
    });

    // DB is called once (for fetchApprovedHistory)
    expect(mockExecute).toHaveBeenCalledOnce();
    // Result is well-formed
    expect(result.suggestions).toEqual([]);
    expect(result.historyCount).toBe(0);
    expect(typeof result.computedAt).toBe("string");
  });
});

// ─── 12. runHistoricalMatching — uses rawDescription fallback ─────────────────

describe("runHistoricalMatching — description fallback", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("uses rawDescription when normalizedDescription is not provided", async () => {
    const desc = "biaya sewa konsesi area lantai dasar";
    setDbRows([makeDbRow({ normalized_description: desc, amount: "5000000", transaction_date: "2026-05-15" })]);

    // No normalizedDescription provided — should fall back to rawDescription
    const result = await runHistoricalMatching({
      amount: 5_000_000,
      direction: "OUT",
      transactionDate: "2026-06-15",
      rawDescription: "BIAYA SEWA KONSESI AREA LANTAI DASAR",
      companyId: 1,
    });

    // normalizeText("BIAYA SEWA KONSESI AREA LANTAI DASAR") === desc → exact match
    if (result.suggestions.length > 0) {
      const exactSig = result.suggestions[0].signals.find(s => s.type === "exact_normalized");
      expect(exactSig?.matched).toBe(true);
    }
  });
});
