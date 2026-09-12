/**
 * Settlement Pattern Engine — Regression Tests
 *
 * Phase 20: Tests for QRIS, Midtrans, Xendit, Paylabs, EDC, VA,
 *   Regex, Contains, Settlement Delay, Batch Matching, Fee Matching, Merchant Matching.
 *
 * These tests exercise the pure-function scoring logic without hitting the DB.
 * The engine's loadPatterns is mocked to return in-memory patterns.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  matchSettlementPattern,
  batchMatchSettlementPatterns,
  calculateSettlementAmounts,
  invalidatePatternCache,
  type SettlementPattern,
  type PatternKeyword,
} from "../lib/settlementPatternEngine.js";

// ─── Mock DB load ─────────────────────────────────────────────────────────────

const MOCK_PATTERNS: SettlementPattern[] = [
  {
    id: 1,
    companyId: null,
    code: "QRIS_TRAVELINTRIPS",
    name: "QRIS Travelintrips",
    provider: "QRIS",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 10,
    status: "active",
    merchantName: "TRAVELINTRIPS",
    merchantId: null,
    terminalId: null,
    bankName: null,
    accountNumber: null,
    currency: "IDR",
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    feeAccountId: null,
    confidenceThreshold: 0.50,
    keywords: [
      { id: 1, patternId: 1, keyword: "QRTRAVELI", matchMode: "contains", priority: 0 },
      { id: 2, patternId: 1, keyword: "QRIS",      matchMode: "contains", priority: 1 },
      { id: 3, patternId: 1, keyword: "7177.*",    matchMode: "regex",    priority: 2 },
    ] as PatternKeyword[],
  },
  {
    id: 2,
    companyId: null,
    code: "QRIS_GENERIC",
    name: "QRIS Generic",
    provider: "QRIS",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 20,
    status: "active",
    merchantName: null,
    merchantId: null,
    terminalId: null,
    bankName: null,
    accountNumber: null,
    currency: "IDR",
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    feeAccountId: null,
    confidenceThreshold: 0.50,
    keywords: [
      { id: 4, patternId: 2, keyword: "QRIS",     matchMode: "contains", priority: 0 },
      { id: 5, patternId: 2, keyword: "QR CODE",  matchMode: "contains", priority: 1 },
    ] as PatternKeyword[],
  },
  {
    id: 3,
    companyId: null,
    code: "MIDTRANS",
    name: "Midtrans Settlement",
    provider: "Midtrans",
    patternType: "settlement",
    matchStrategy: "ONE_TO_MANY",
    priority: 15,
    status: "active",
    merchantName: null,
    merchantId: null,
    terminalId: null,
    bankName: null,
    accountNumber: null,
    currency: "IDR",
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    feeAccountId: null,
    confidenceThreshold: 0.50,
    keywords: [
      { id: 6, patternId: 3, keyword: "MIDTRANS", matchMode: "contains", priority: 0 },
      { id: 7, patternId: 3, keyword: "MDTRANS",  matchMode: "contains", priority: 1 },
    ] as PatternKeyword[],
  },
  {
    id: 4,
    companyId: null,
    code: "XENDIT",
    name: "Xendit Settlement",
    provider: "Xendit",
    patternType: "settlement",
    matchStrategy: "ONE_TO_MANY",
    priority: 15,
    status: "active",
    merchantName: null,
    merchantId: null,
    terminalId: null,
    bankName: null,
    accountNumber: null,
    currency: "IDR",
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    feeAccountId: null,
    confidenceThreshold: 0.50,
    keywords: [
      { id: 8, patternId: 4, keyword: "XENDIT",         matchMode: "contains", priority: 0 },
      { id: 9, patternId: 4, keyword: "PT SINAR DIGITAL",matchMode: "contains", priority: 1 },
    ] as PatternKeyword[],
  },
  {
    id: 5,
    companyId: null,
    code: "PAYLABS",
    name: "Paylabs Settlement",
    provider: "Paylabs",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 15,
    status: "active",
    merchantName: null,
    merchantId: null,
    terminalId: null,
    bankName: null,
    accountNumber: null,
    currency: "IDR",
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    feeAccountId: null,
    confidenceThreshold: 0.50,
    keywords: [
      { id: 10, patternId: 5, keyword: "PAYLABS",    matchMode: "contains", priority: 0 },
      { id: 11, patternId: 5, keyword: "PT MONETRA", matchMode: "contains", priority: 1 },
    ] as PatternKeyword[],
  },
  {
    id: 6,
    companyId: null,
    code: "BCA_EDC",
    name: "BCA EDC Settlement",
    provider: "BCA EDC",
    patternType: "settlement",
    matchStrategy: "ONE_TO_MANY",
    priority: 25,
    status: "active",
    merchantName: null,
    merchantId: null,
    terminalId: null,
    bankName: "BCA",
    accountNumber: null,
    currency: "IDR",
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    feeAccountId: null,
    confidenceThreshold: 0.50,
    keywords: [
      { id: 12, patternId: 6, keyword: "BCA EDC",   matchMode: "contains", priority: 0 },
      { id: 13, patternId: 6, keyword: "EDC BCA",   matchMode: "contains", priority: 1 },
      { id: 14, patternId: 6, keyword: "SETTLE BCA",matchMode: "contains", priority: 2 },
    ] as PatternKeyword[],
  },
  {
    id: 7,
    companyId: null,
    code: "VIRTUAL_ACCOUNT",
    name: "Virtual Account Settlement",
    provider: "Virtual Account",
    patternType: "settlement",
    matchStrategy: "ONE_TO_ONE",
    priority: 30,
    status: "active",
    merchantName: null,
    merchantId: null,
    terminalId: null,
    bankName: null,
    accountNumber: null,
    currency: "IDR",
    settlementDelayDays: 0,
    grossMatching: true,
    feeMatching: false,
    feeAccountId: null,
    confidenceThreshold: 0.50,
    keywords: [
      { id: 15, patternId: 7, keyword: "VIRTUAL ACCOUNT", matchMode: "contains", priority: 0 },
      { id: 16, patternId: 7, keyword: "VA ",             matchMode: "contains", priority: 1 },
      { id: 17, patternId: 7, keyword: "TRANSFER VA",     matchMode: "contains", priority: 2 },
    ] as PatternKeyword[],
  },
  {
    id: 8,
    companyId: null,
    code: "MERCHANT_TEST",
    name: "Merchant Test Pattern",
    provider: "QRIS",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 5,
    status: "active",
    merchantName: "TOKO_MAJU",
    merchantId: "MID-12345",
    terminalId: null,
    bankName: null,
    accountNumber: null,
    currency: "IDR",
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    feeAccountId: 999,
    confidenceThreshold: 0.50,
    keywords: [
      { id: 18, patternId: 8, keyword: "SETTL",    matchMode: "starts_with", priority: 0 },
      { id: 19, patternId: 8, keyword: "TOKO_MAJU",matchMode: "contains",    priority: 1 },
    ] as PatternKeyword[],
  },
];

// ─── Mock the DB call inside loadPatterns ─────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from "@workspace/db";

beforeAll(() => {
  // Mock db.execute to return patterns + keywords for cache miss
  (db.execute as any).mockImplementation(async (query: any) => {
    const queryStr = String(query?.queryChunks?.map((c: any) => c.value ?? c).join("") ?? query);

    if (queryStr.includes("recon_settlement_pattern_keywords") && queryStr.includes("ANY")) {
      return {
        rows: MOCK_PATTERNS.flatMap(p => p.keywords.map(kw => ({
          id: kw.id,
          pattern_id: kw.patternId,
          keyword: kw.keyword,
          match_mode: kw.matchMode,
          priority: kw.priority,
        }))),
      };
    }

    if (queryStr.includes("recon_settlement_patterns")) {
      return {
        rows: MOCK_PATTERNS.map(p => ({
          id: p.id,
          company_id: p.companyId,
          code: p.code,
          name: p.name,
          provider: p.provider,
          pattern_type: p.patternType,
          match_strategy: p.matchStrategy,
          priority: p.priority,
          status: p.status,
          merchant_name: p.merchantName,
          merchant_id: p.merchantId,
          terminal_id: p.terminalId,
          bank_name: p.bankName,
          account_number: p.accountNumber,
          currency: p.currency,
          settlement_delay_days: p.settlementDelayDays,
          gross_matching: p.grossMatching,
          fee_matching: p.feeMatching,
          fee_account_id: p.feeAccountId,
          confidence_threshold: String(p.confidenceThreshold),
        })),
      };
    }

    // usage_count update — ignore
    return { rows: [] };
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Settlement Pattern Engine", () => {

  // Clear cache between tests
  beforeAll(() => invalidatePatternCache());

  // ── QRIS ──────────────────────────────────────────────────────────────────

  describe("QRIS", () => {
    it("matches QRIS Travelintrips by QRTRAVELI keyword (runtime UAT example)", async () => {
      invalidatePatternCache();
      const desc = "7177632488799999999111111111111QRTRAVELI DR 0000029511812 KR 1640006707220 99106";
      const result = await matchSettlementPattern(desc);
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("QRIS");
      expect(result.pattern?.name).toBe("QRIS Travelintrips");
      expect(result.matchStrategy).toBe("BATCH_SETTLEMENT");
      expect(result.confidence).toBeGreaterThan(0.95);
      expect(result.matchedKeywords).toContain("QRTRAVELI");
    });

    it("matches QRIS by regex 7177.*", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("71770001234567890 QRTRAVELI settlement");
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("QRIS");
    });

    it("matches QRIS Generic by QR CODE keyword", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("SETLE QR CODE 20240101 1000000");
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("QRIS");
    });

    it("returns BATCH_SETTLEMENT strategy for QRIS", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("QRIS SETTLEMENT 12345678");
      expect(result.matchStrategy).toBe("BATCH_SETTLEMENT");
    });

    it("returns settlementDelayDays=1 for QRIS", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("QRTRAVELI SETTLEMENT");
      expect(result.settlementDelayDays).toBe(1);
    });
  });

  // ── Midtrans ───────────────────────────────────────────────────────────────

  describe("Midtrans", () => {
    it("matches Midtrans by keyword", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("SETLE MIDTRANS 20240801 INV-9999");
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("Midtrans");
      expect(result.matchStrategy).toBe("ONE_TO_MANY");
    });

    it("matches Midtrans by MDTRANS abbreviation", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("TRANSFER MDTRANS TRX001");
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("Midtrans");
    });
  });

  // ── Xendit ────────────────────────────────────────────────────────────────

  describe("Xendit", () => {
    it("matches Xendit settlement", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("XENDIT DISBURSEMENT BATCH 20240801");
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("Xendit");
    });

    it("matches Xendit by full company name", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("PT SINAR DIGITAL NUSANTARA SETTLE");
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("Xendit");
    });
  });

  // ── Paylabs ───────────────────────────────────────────────────────────────

  describe("Paylabs", () => {
    it("matches Paylabs settlement", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("PAYLABS BATCH SETTLEMENT 20240801");
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("Paylabs");
      expect(result.matchStrategy).toBe("BATCH_SETTLEMENT");
    });
  });

  // ── EDC ───────────────────────────────────────────────────────────────────

  describe("EDC", () => {
    it("matches BCA EDC settlement", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("SETLE EDC BCA TGL 20240801 TOTAL 5000000");
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("BCA EDC");
      expect(result.matchStrategy).toBe("ONE_TO_MANY");
    });

    it("matches BCA EDC by BCA EDC keyword", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("BCA EDC SETTLEMENT HARIAN");
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("BCA EDC");
    });
  });

  // ── Virtual Account ───────────────────────────────────────────────────────

  describe("Virtual Account", () => {
    it("matches Virtual Account by keyword", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("BAYAR VIRTUAL ACCOUNT INV-001 DT 20240801");
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("Virtual Account");
      expect(result.matchStrategy).toBe("ONE_TO_ONE");
    });

    it("returns settlementDelayDays=0 for VA (same-day)", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("TRANSFER VA 10001234567890");
      expect(result.settlementDelayDays).toBe(0);
    });
  });

  // ── Regex matching ────────────────────────────────────────────────────────

  describe("Regex match_mode", () => {
    it("matches with regex pattern 7177.*", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("71778888888888 SETLE QRIS TRAVELINTRIPS");
      expect(result.matched).toBe(true);
      expect(result.matchedKeywords.some(kw => kw === "7177.*")).toBe(true);
    });
  });

  // ── Contains matching ─────────────────────────────────────────────────────

  describe("Contains match_mode", () => {
    it("matches contains keyword case-insensitively", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("setle midtrans batch 20240801");
      expect(result.matched).toBe(true);
      expect(result.provider).toBe("Midtrans");
    });
  });

  // ── Settlement Delay ──────────────────────────────────────────────────────

  describe("Settlement Delay", () => {
    it("QRIS returns delay H+1", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("QRIS SETTLEMENT HARIAN");
      expect(result.settlementDelayDays).toBe(1);
    });

    it("Virtual Account returns delay H+0 (same day)", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("VIRTUAL ACCOUNT BAYAR INV-123");
      expect(result.settlementDelayDays).toBe(0);
    });
  });

  // ── Batch Matching ────────────────────────────────────────────────────────

  describe("Batch Matching", () => {
    it("batch-matches multiple descriptions at once", async () => {
      invalidatePatternCache();
      const items = [
        { description: "QRTRAVELI SETTLEMENT BATCH" },
        { description: "XENDIT DISBURSEMENT DAILY" },
        { description: "EDC BCA SETTLE HARIAN" },
        { description: "RANDOM DESCRIPTION NO MATCH" },
      ];
      const results = await batchMatchSettlementPatterns(items);
      expect(results).toHaveLength(4);
      expect(results[0].matched).toBe(true);
      expect(results[0].provider).toBe("QRIS");
      expect(results[1].matched).toBe(true);
      expect(results[1].provider).toBe("Xendit");
      expect(results[2].matched).toBe(true);
      expect(results[2].provider).toBe("BCA EDC");
      expect(results[3].matched).toBe(false);
    });
  });

  // ── Fee Matching ──────────────────────────────────────────────────────────

  describe("Fee Matching", () => {
    it("QRIS pattern has feeMatching=true", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("QRTRAVELI SETLE BATCH 1000000");
      expect(result.feeMatching).toBe(true);
    });

    it("Virtual Account has feeMatching=false", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("VIRTUAL ACCOUNT BAYAR INV-001");
      expect(result.feeMatching).toBe(false);
    });
  });

  // ── Merchant Matching ─────────────────────────────────────────────────────

  describe("Merchant Matching", () => {
    it("boosts confidence when merchantName present in description", async () => {
      invalidatePatternCache();
      // MERCHANT_TEST pattern has priority=5 (highest), merchantName=TOKO_MAJU
      const withMerchant    = await matchSettlementPattern("SETTL TOKO_MAJU QRIS BATCH");
      const withoutMerchant = await matchSettlementPattern("SETTL BATCH HARIAN");
      expect(withMerchant.confidence).toBeGreaterThan(withoutMerchant.confidence);
    });

    it("returns feeAccountId from matched pattern", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("SETTL TOKO_MAJU QRIS BATCH");
      expect(result.feeAccountId).toBe(999);
    });
  });

  // ── calculateSettlementAmounts ────────────────────────────────────────────

  describe("calculateSettlementAmounts (Batch fee helper)", () => {
    it("derives net from gross + fee", () => {
      const r = calculateSettlementAmounts({ grossAmount: 1_000_000, feeAmount: 10_000 });
      expect(r).not.toBeNull();
      expect(r!.gross).toBe(1_000_000);
      expect(r!.fee).toBe(10_000);
      expect(r!.net).toBe(990_000);
    });

    it("derives gross from net + fee (Phase 9 formula)", () => {
      const r = calculateSettlementAmounts({ netAmount: 990_000, feeAmount: 10_000 });
      expect(r).not.toBeNull();
      expect(r!.gross).toBe(1_000_000);
    });

    it("derives fee from gross - net", () => {
      const r = calculateSettlementAmounts({ grossAmount: 1_000_000, netAmount: 990_000 });
      expect(r).not.toBeNull();
      expect(r!.fee).toBe(10_000);
    });

    it("returns null when insufficient inputs", () => {
      expect(calculateSettlementAmounts({ grossAmount: 100 })).toBeNull();
    });
  });

  // ── No match ──────────────────────────────────────────────────────────────

  describe("No match", () => {
    it("returns matched=false for unrecognized description", async () => {
      invalidatePatternCache();
      const result = await matchSettlementPattern("PEMBAYARAN TUNAI KASIR 20240801");
      expect(result.matched).toBe(false);
      expect(result.pattern).toBeNull();
    });
  });

});
