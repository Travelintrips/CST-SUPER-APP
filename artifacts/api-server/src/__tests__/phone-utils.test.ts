import { describe, expect, it } from "vitest";
import { isValidIndonesianPhone, normalizePhone } from "../lib/phoneUtils.js";

describe("WhatsApp phone normalization", () => {
  it.each([
    ["081234567890", "6281234567890"],
    ["6281234567890", "6281234567890"],
    ["+62 812-3456-7890", "6281234567890"],
  ])("normalizes %s to provider format", (raw, expected) => {
    const normalized = normalizePhone(raw);
    expect(normalized).toBe(expected);
    expect(isValidIndonesianPhone(normalized)).toBe(true);
  });

  it.each(["", "   ", "abc-not-a-phone", "123", "628123", "628123456789012345"])(
    "rejects invalid target %s",
    (raw) => {
      const normalized = normalizePhone(raw);
      expect(isValidIndonesianPhone(normalized)).toBe(false);
    },
  );
});