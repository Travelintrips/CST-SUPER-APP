/**
 * Unit tests — Query Normalizer
 */

import { describe, it, expect } from "vitest";
import {
  normalizeQuery,
  tokenize,
  extractHsCodes,
  detectLanguage,
  MAX_QUERY_LENGTH,
} from "../normalizer.js";

describe("normalizeQuery", () => {
  it("lowercases input", () => {
    expect(normalizeQuery("KOPI ARABIKA")).toBe("kopi arabika");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeQuery("  kopi  ")).toBe("kopi");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeQuery("kopi   arabika")).toBe("kopi arabika");
  });

  it("removes irrelevant punctuation", () => {
    expect(normalizeQuery("KOPI, Arabika!!")).toBe("kopi arabika");
  });

  it("removes trailing dots that are not HS codes", () => {
    expect(normalizeQuery("kopi.")).toBe("kopi");
  });

  it("preserves HS Code digits and dots", () => {
    const result = normalizeQuery("HS CODE 0901.11");
    expect(result).toContain("0901.11");
  });

  it("truncates to MAX_QUERY_LENGTH", () => {
    const long = "a".repeat(MAX_QUERY_LENGTH + 50);
    const result = normalizeQuery(long);
    expect(result!.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
  });

  it("returns null for empty string", () => {
    expect(normalizeQuery("")).toBeNull();
    expect(normalizeQuery("   ")).toBeNull();
  });

  it("returns null for only punctuation", () => {
    expect(normalizeQuery("!!! ???")).toBeNull();
  });
});

describe("tokenize", () => {
  it("splits on spaces", () => {
    expect(tokenize("kopi arabika")).toEqual(["kopi", "arabika"]);
  });

  it("filters out single-character tokens", () => {
    expect(tokenize("a b kopi")).toEqual(["kopi"]);
  });
});

describe("extractHsCodes", () => {
  // ── Canonical formats ──────────────────────────────────────────────────────
  it("extracts dot-separated format: 0901.11", () => {
    const codes = extractHsCodes("0901.11");
    expect(codes).toContain("0901.11");
  });

  it("extracts dotless 6-digit format: 090111", () => {
    const codes = extractHsCodes("090111");
    expect(codes).toContain("090111");
  });

  it("extracts 4-digit chapter/heading only: 0901", () => {
    const codes = extractHsCodes("0901");
    expect(codes).toContain("0901");
  });

  // ── Alternative separator formats ─────────────────────────────────────────
  it("extracts hyphen-separated format: 0901-11", () => {
    const codes = extractHsCodes("0901-11");
    expect(codes.some((c) => c === "0901.11" || c === "090111")).toBe(true);
  });

  it("extracts space-separated format: 0901 11", () => {
    const codes = extractHsCodes("0901 11");
    expect(codes.some((c) => c === "0901.11" || c === "090111")).toBe(true);
  });

  it("extracts slash-separated format: 0901/11", () => {
    const codes = extractHsCodes("0901/11");
    expect(codes.some((c) => c === "0901.11" || c === "090111")).toBe(true);
  });

  // ── HS Code intent keyword ─────────────────────────────────────────────────
  it("extracts HS Code after keyword 'hs code'", () => {
    const codes = extractHsCodes("hs code 0901.11");
    expect(codes.some((c) => c.includes("0901"))).toBe(true);
  });

  it("extracts HS Code after keyword 'kode hs'", () => {
    const codes = extractHsCodes("kode hs 090111");
    expect(codes.some((c) => c.includes("090111") || c.includes("0901"))).toBe(true);
  });

  // ── Dotless variant ────────────────────────────────────────────────────────
  it("also produces dotless variant for dot-separated input", () => {
    const codes = extractHsCodes("0901.11");
    expect(codes).toContain("090111");
  });

  // ── Leading-zero preservation ──────────────────────────────────────────────
  it("preserves leading zeros — never strips them", () => {
    const codes = extractHsCodes("0901.11");
    // Must contain "0901.11" not "901.11"
    expect(codes.every((c) => !c.startsWith("9") || c.length !== 6)).toBe(true);
    expect(codes).toContain("0901.11");
  });

  // ── No random character match ──────────────────────────────────────────────
  it("returns empty array for non-HS query", () => {
    const codes = extractHsCodes("bawang putih");
    expect(codes).toHaveLength(0);
  });

  it("does not match random short digit sequences as HS codes", () => {
    // "12" alone should not be extracted (too short to be an HS code)
    const codes = extractHsCodes("produk 12 tersedia");
    expect(codes.filter((c) => c === "12")).toHaveLength(0);
  });

  it("does not return number parsed as integer (leading zeros intact)", () => {
    const codes = extractHsCodes("0901");
    // Must be the string "0901", not 901
    expect(codes).toContain("0901");
    expect(codes.map(Number).every((n) => typeof n === "number")).toBe(true); // type check only
    expect(codes).not.toContain("901"); // leading zero must not be dropped
  });
});

describe("detectLanguage", () => {
  it("detects Indonesian", () => {
    expect(detectLanguage(["kopi", "ada", "apa"])).toBe("id");
  });

  it("detects English", () => {
    expect(detectLanguage(["coffee", "the", "and"])).toBe("en");
  });

  it("defaults to id for unknown", () => {
    expect(detectLanguage(["xyzabc"])).toBe("id");
  });
});
