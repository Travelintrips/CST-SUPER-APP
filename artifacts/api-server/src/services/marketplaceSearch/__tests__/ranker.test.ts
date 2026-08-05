/**
 * Unit tests — Ranker
 *
 * Tests scoring, deduplication, sorting, and data safety.
 * Uses mock CandidateRow data — no DB calls.
 */

import { describe, it, expect } from "vitest";
import { rankCandidates } from "../ranker.js";
import type { CandidateRow } from "../types.js";
import { SCORE } from "../types.js";

function makeRow(overrides: Partial<CandidateRow>): CandidateRow {
  return {
    id: 1,
    name: "Test Product",
    kategori: null,
    categoryKey: null,
    description: null,
    hsCode: null,
    stockStatus: "available",
    priceSell: null,
    unit: "kg",
    vendorName: "Test Vendor",
    supplierPublicName: null,
    isFeatured: false,
    ...overrides,
  };
}

describe("rankCandidates — scoring", () => {
  it("exact full name match gets EXACT_FULL_NAME score (100)", () => {
    const rows = [makeRow({ name: "bawang putih", id: 1 })];
    const results = rankCandidates(rows, "bawang putih", ["bawang", "putih"], ["bawang putih", "garlic"], [], 5);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(SCORE.EXACT_FULL_NAME);
  });

  it("synonym match scores lower than exact name match", () => {
    const rows = [
      makeRow({ id: 1, name: "Garlic Bulb" }),           // synonym match
      makeRow({ id: 2, name: "bawang putih segar" }),     // token match
    ];
    const results = rankCandidates(rows, "bawang putih", ["bawang", "putih"], ["bawang putih", "garlic"], [], 5);
    expect(results[0].id).toBe(2); // token match ranks higher
  });

  it("HS Code exact match scores high", () => {
    const rows = [makeRow({ id: 1, name: "Arabica Coffee", hsCode: "0901.11" })];
    const results = rankCandidates(rows, "0901 11", ["0901", "11"], ["0901", "0901.11"], ["0901.11", "090111"], 5);
    expect(results[0].matchStrategy).toBe("hs_code_exact");
    expect(results[0].score).toBe(SCORE.HS_CODE_EXACT);
  });

  it("fuzzy match scores lower than synonym", () => {
    const exact = makeRow({ id: 1, name: "Garlic Fresh" });
    const fuzzy = makeRow({ id: 2, name: "Garlick Export" });
    // synonym for "garlic" should rank exact higher
    const results = rankCandidates(
      [fuzzy, exact],
      "garlic",
      ["garlic"],
      ["garlic", "bawang putih"],
      [],
      5,
    );
    // Exact token "garlic" in name of id=1 should score EXACT_TOKEN
    const id1 = results.find((r) => r.id === 1);
    const id2 = results.find((r) => r.id === 2);
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    if (id1 && id2) {
      expect(id1.score).toBeGreaterThanOrEqual(id2.score);
    }
  });
});

describe("rankCandidates — deduplication", () => {
  it("duplicate product appears only once", () => {
    const rows = [
      makeRow({ id: 42, name: "Coffee Arabica" }),
      makeRow({ id: 42, name: "Coffee Arabica" }), // duplicate
    ];
    const results = rankCandidates(rows, "coffee", ["coffee"], ["coffee", "kopi"], [], 5);
    const ids = results.map((r) => r.id);
    expect(ids.filter((id) => id === 42)).toHaveLength(1);
  });

  it("keeps highest score when deduplicating", () => {
    const rows = [
      makeRow({ id: 99, name: "Steel Bar", kategori: "metal" }),
      makeRow({ id: 99, name: "Steel Bar", kategori: "baja" }),
    ];
    const results = rankCandidates(rows, "baja", ["baja"], ["baja", "steel"], [], 5);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(SCORE.FUZZY_WEAK);
  });
});

describe("rankCandidates — sorting", () => {
  it("higher score ranks first", () => {
    const rows = [
      makeRow({ id: 1, name: "xyz unrelated coffee variant", kategori: "coffee" }),
      makeRow({ id: 2, name: "coffee" }), // exact match
    ];
    const results = rankCandidates(rows, "coffee", ["coffee"], ["coffee", "kopi"], [], 5);
    expect(results[0].id).toBe(2);
  });

  it("featured does not override higher relevance", () => {
    const rows = [
      makeRow({ id: 1, name: "coffee arabica", isFeatured: false }),
      makeRow({ id: 2, name: "coffee premium", isFeatured: true }),
    ];
    const results = rankCandidates(rows, "coffee arabica", ["coffee", "arabica"], ["coffee arabica", "coffee", "kopi"], [], 5);
    // id=1 should score higher (exact phrase match) despite not being featured
    expect(results[0].id).toBe(1);
  });

  it("name ASC is tie-breaker for equal score", () => {
    const rows = [
      makeRow({ id: 2, name: "coffee extra" }),
      makeRow({ id: 1, name: "coffee A" }),
    ];
    // Same score scenario: both match "coffee" via exact token
    const results = rankCandidates(rows, "coffee", ["coffee"], ["coffee", "kopi"], [], 5);
    // Alphabetically "coffee A" < "coffee extra"
    expect(results[0].name.toLowerCase() <= results[1]?.name.toLowerCase() || results.length === 1).toBe(true);
  });
});

describe("rankCandidates — data safety", () => {
  it("never exposes priceSell raw (returns formatted priceStatus)", () => {
    const rows = [makeRow({ id: 1, name: "coffee", priceSell: "50000" })];
    const results = rankCandidates(rows, "coffee", ["coffee"], ["coffee"], [], 5);
    const product = results[0];
    // Should have priceStatus, not raw priceBase or markup
    expect(product).not.toHaveProperty("priceBase");
    expect(product).not.toHaveProperty("markupPct");
    expect(product).not.toHaveProperty("cost");
    expect(product).not.toHaveProperty("margin");
    expect(product.priceStatus).toContain("Rp");
  });

  it("null priceSell → Harga berdasarkan permintaan", () => {
    const rows = [makeRow({ id: 1, name: "coffee", priceSell: null })];
    const results = rankCandidates(rows, "coffee", ["coffee"], ["coffee"], [], 5);
    expect(results[0].priceStatus).toBe("Harga berdasarkan permintaan");
  });

  it("respects limit — max 5", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow({ id: i + 1, name: `coffee product ${i}` }),
    );
    const results = rankCandidates(rows, "coffee", ["coffee"], ["coffee"], [], 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("FUZZY_WEAK results are excluded", () => {
    const rows = [makeRow({ id: 1, name: "xyz123abc", kategori: "xyz" })];
    const results = rankCandidates(rows, "coffee", ["coffee"], ["coffee", "kopi"], [], 5);
    // "xyz123abc" should not match coffee at all
    expect(results).toHaveLength(0);
  });

  it("publicUrl is always /marketplace/:id", () => {
    const rows = [makeRow({ id: 77, name: "coffee" })];
    const results = rankCandidates(rows, "coffee", ["coffee"], ["coffee"], [], 5);
    expect(results[0].publicUrl).toBe("/marketplace/77");
  });
});

describe("rankCandidates — stock label mapping", () => {
  const cases: Array<[string | null, string]> = [
    ["available", "Tersedia"],
    ["in_stock", "Tersedia"],
    ["limited", "Stok terbatas"],
    ["on_inquiry", "Ketersediaan berdasarkan konfirmasi"],
    ["on_order", "Ketersediaan berdasarkan konfirmasi"],
    ["out_of_stock", "Tidak tersedia saat ini"],
    [null, "Silakan konfirmasi ketersediaan"],
    ["unknown_status", "Silakan konfirmasi ketersediaan"],
  ];

  for (const [status, expectedLabel] of cases) {
    it(`stockStatus="${status}" → "${expectedLabel}"`, () => {
      const rows = [makeRow({ id: 1, name: "coffee", stockStatus: status })];
      const results = rankCandidates(rows, "coffee", ["coffee"], ["coffee"], [], 5);
      expect(results[0].stockLabel).toBe(expectedLabel);
    });
  }
});
