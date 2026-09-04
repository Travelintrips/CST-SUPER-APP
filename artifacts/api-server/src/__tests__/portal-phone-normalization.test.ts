import { describe, expect, it } from "vitest";
import { isValidIndonesianPhone, normalizePhone } from "../lib/phoneUtils";

describe("Customer Portal phone identity", () => {
  it.each([
    ["0812 3456 7890", "6281234567890"],
    ["+62 812-3456-7890", "6281234567890"],
    ["6281234567890", "6281234567890"],
    ["62081234567890", "6281234567890"],
  ])("canonicalizes %s to %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("recognizes the canonical Indonesian format", () => {
    expect(isValidIndonesianPhone(normalizePhone("081234567890"))).toBe(true);
    expect(isValidIndonesianPhone(normalizePhone("not-a-phone"))).toBe(false);
  });
});