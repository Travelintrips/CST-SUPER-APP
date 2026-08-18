import { describe, expect, it } from "vitest";
import {
  companyScopesMatch,
  normalizeCompanyId,
} from "../lib/services/portalCompanyScopeUtils.js";

describe("portal payment and reconciliation company scope", () => {
  it("rejects missing, zero, fractional, and invalid company values", () => {
    expect(normalizeCompanyId(null)).toBeNull();
    expect(normalizeCompanyId(undefined)).toBeNull();
    expect(normalizeCompanyId(0)).toBeNull();
    expect(normalizeCompanyId("")).toBeNull();
    expect(normalizeCompanyId(1.5)).toBeNull();
    expect(normalizeCompanyId("not-a-company")).toBeNull();
  });

  it("accepts database string IDs and normalizes them", () => {
    expect(normalizeCompanyId("42")).toBe(42);
    expect(normalizeCompanyId(42)).toBe(42);
  });

  it("does not treat an unscoped or cross-company candidate as a match", () => {
    expect(companyScopesMatch(null, 10)).toBe(false);
    expect(companyScopesMatch(0, 10)).toBe(false);
    expect(companyScopesMatch(10, 11)).toBe(false);
    expect(companyScopesMatch("10", 10)).toBe(true);
  });
});