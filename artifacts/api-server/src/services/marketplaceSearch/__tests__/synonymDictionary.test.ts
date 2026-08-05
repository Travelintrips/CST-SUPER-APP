/**
 * Unit tests — Synonym Dictionary
 */

import { describe, it, expect } from "vitest";
import { getSynonyms, expandTerms, getCategoryAliases } from "../synonymDictionary.js";

describe("getSynonyms — bilingual mapping", () => {
  it("kopi → coffee (ID→EN)", () => {
    const syns = getSynonyms("kopi");
    expect(syns.has("coffee")).toBe(true);
  });

  it("coffee → kopi (EN→ID)", () => {
    const syns = getSynonyms("coffee");
    expect(syns.has("kopi")).toBe(true);
  });

  it("bawang putih → garlic", () => {
    const syns = getSynonyms("bawang putih");
    expect(syns.has("garlic")).toBe(true);
  });

  it("garlic → bawang putih", () => {
    const syns = getSynonyms("garlic");
    expect(syns.has("bawang putih")).toBe(true);
  });

  it("bawang merah → shallot", () => {
    const syns = getSynonyms("bawang merah");
    expect(syns.has("shallot")).toBe(true);
  });

  it("shallot → bawang merah", () => {
    const syns = getSynonyms("shallot");
    expect(syns.has("bawang merah")).toBe(true);
  });

  it("arang kelapa → coconut charcoal", () => {
    const syns = getSynonyms("arang kelapa");
    expect(syns.has("coconut charcoal")).toBe(true);
  });

  it("coconut charcoal → arang kelapa", () => {
    const syns = getSynonyms("coconut charcoal");
    expect(syns.has("arang kelapa")).toBe(true);
  });

  it("batubara → coal", () => {
    const syns = getSynonyms("batubara");
    expect(syns.has("coal")).toBe(true);
  });

  it("coal → batubara", () => {
    const syns = getSynonyms("coal");
    expect(syns.has("batubara")).toBe(true);
  });

  it("baja → steel", () => {
    const syns = getSynonyms("baja");
    expect(syns.has("steel")).toBe(true);
  });

  it("steel → baja", () => {
    const syns = getSynonyms("steel");
    expect(syns.has("baja")).toBe(true);
  });

  it("kacang mete → cashew", () => {
    const syns = getSynonyms("kacang mete");
    expect(syns.has("cashew")).toBe(true);
  });

  it("cashew → kacang mete", () => {
    const syns = getSynonyms("cashew");
    expect(syns.has("kacang mete")).toBe(true);
  });

  it("unknown term returns set with itself", () => {
    const syns = getSynonyms("xyzunknown");
    expect(syns.has("xyzunknown")).toBe(true);
    expect(syns.size).toBe(1);
  });

  it("case-insensitive — KOPI matches kopi synonyms", () => {
    const syns = getSynonyms("KOPI");
    // getSynonyms lowercases input
    expect(syns.has("coffee")).toBe(true);
  });
});

describe("expandTerms", () => {
  it("always includes normalized query", () => {
    const terms = expandTerms(["kopi"], "kopi");
    expect(terms).toContain("kopi");
  });

  it("includes English synonym for Indonesian input", () => {
    const terms = expandTerms(["kopi"], "kopi");
    expect(terms).toContain("coffee");
    expect(terms).toContain("coffee bean");
  });

  it("includes Indonesian synonym for English input", () => {
    const terms = expandTerms(["garlic"], "garlic");
    expect(terms).toContain("bawang putih");
  });

  it("handles multi-token input (arang kelapa)", () => {
    const terms = expandTerms(["arang", "kelapa"], "arang kelapa");
    expect(terms).toContain("coconut charcoal");
    expect(terms).toContain("charcoal briquette");
  });

  it("does not exceed max expanded terms", () => {
    const terms = expandTerms(["kopi", "arabika", "bawang"], "kopi arabika bawang");
    expect(terms.length).toBeLessThanOrEqual(15);
  });
});

describe("getCategoryAliases", () => {
  it("makanan → contains food-related terms", () => {
    const aliases = getCategoryAliases("makanan");
    expect(aliases).toContain("food");
  });

  it("pertambangan → contains coal/mineral", () => {
    const aliases = getCategoryAliases("pertambangan");
    expect(aliases).toContain("coal");
  });

  it("unknown category → empty array", () => {
    expect(getCategoryAliases("xyzunknown")).toHaveLength(0);
  });
});
