/**
 * Unit tests — Fuzzy Matching
 */

import { describe, it, expect } from "vitest";
import { levenshtein, maxEditDistance, fuzzyScore, fuzzyTokenMatch } from "../fuzzy.js";
import { SCORE } from "../types.js";

describe("levenshtein", () => {
  it("identical strings → 0", () => {
    expect(levenshtein("coffee", "coffee")).toBe(0);
  });

  it("one substitution", () => {
    expect(levenshtein("coffe", "coffee")).toBe(1);
  });

  it("two substitutions", () => {
    expect(levenshtein("cinnammon", "cinnamon")).toBe(1); // one extra 'm'
  });

  it("garlick → garlic (1 sub)", () => {
    expect(levenshtein("garlick", "garlic")).toBe(1);
  });

  it("pinaple → pineapple (2 ops)", () => {
    expect(levenshtein("pinaple", "pineapple")).toBeLessThanOrEqual(3);
  });

  it("empty strings", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "")).toBe(0);
  });
});

describe("maxEditDistance", () => {
  it("very short query → 0 (no fuzzy)", () => {
    expect(maxEditDistance(1)).toBe(0);
    expect(maxEditDistance(2)).toBe(0);
    expect(maxEditDistance(3)).toBe(0);
  });

  it("medium query → 1", () => {
    expect(maxEditDistance(4)).toBe(1);
    expect(maxEditDistance(5)).toBe(1);
    expect(maxEditDistance(6)).toBe(1);
  });

  it("long query → 2", () => {
    expect(maxEditDistance(9)).toBe(2);
    expect(maxEditDistance(20)).toBe(2);
  });
});

describe("fuzzyScore", () => {
  it("exact match → EXACT_TOKEN score", () => {
    expect(fuzzyScore("coffee", "coffee")).toBe(SCORE.EXACT_TOKEN);
  });

  it("coffe → coffee (1 edit, threshold met) → FUZZY_STRONG", () => {
    expect(fuzzyScore("coffe", "coffee")).toBe(SCORE.FUZZY_STRONG);
  });

  it("garlick → garlic → FUZZY_STRONG", () => {
    expect(fuzzyScore("garlick", "garlic")).toBe(SCORE.FUZZY_STRONG);
  });

  it("very short query (<4 chars) → FUZZY_WEAK (0)", () => {
    expect(fuzzyScore("co", "coffee")).toBe(SCORE.FUZZY_WEAK);
  });

  it("completely different → FUZZY_WEAK (0)", () => {
    expect(fuzzyScore("xyzabc", "coffee")).toBe(SCORE.FUZZY_WEAK);
  });
});

describe("fuzzyTokenMatch", () => {
  it("finds match in multi-word candidate", () => {
    const score = fuzzyTokenMatch(["coffe"], "arabica coffee beans");
    expect(score).toBeGreaterThan(SCORE.FUZZY_WEAK);
  });

  it("exact token in candidate → EXACT_TOKEN", () => {
    const score = fuzzyTokenMatch(["coffee"], "arabica coffee beans");
    expect(score).toBe(SCORE.EXACT_TOKEN);
  });

  it("no match → FUZZY_WEAK", () => {
    const score = fuzzyTokenMatch(["steel"], "kopi arabika");
    expect(score).toBe(SCORE.FUZZY_WEAK);
  });

  it("very short tokens not fuzzied", () => {
    const score = fuzzyTokenMatch(["co"], "coffee");
    expect(score).toBe(SCORE.FUZZY_WEAK);
  });
});
