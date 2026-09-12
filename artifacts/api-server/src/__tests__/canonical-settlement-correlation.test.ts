import { describe, expect, it } from "vitest";
import {
  normalizeCanonicalSettlementCorrelationRoot,
} from "../lib/reconciliation/canonicalSettlementCorrelation.js";

describe("canonical settlement correlation roots", () => {
  it.each([
    ["scb:v1:abc", "scb:v1:abc"],
    ["scb:v1:abc:supp:01", "scb:v1:abc"],
    ["  scb:v1:abc:supp:002  ", "scb:v1:abc"],
  ])("normalizes %s to %s", (value, expected) => {
    expect(normalizeCanonicalSettlementCorrelationRoot(value)).toBe(expected);
  });

  it.each([
    [null],
    [""],
    ["scb:v1:abc:supp:late"],
    ["scb:v1:abc:supp:"],
    ["scb:v1:abc:supp:01:supp:02"],
  ])("rejects malformed correlation id %s", (value) => {
    expect(normalizeCanonicalSettlementCorrelationRoot(value)).toBeNull();
  });
});
