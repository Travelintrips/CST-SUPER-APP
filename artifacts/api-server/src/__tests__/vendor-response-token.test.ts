import { afterEach, describe, expect, it, vi } from "vitest";
import {
  signVendorResponseToken,
  verifyVendorResponseToken,
} from "../lib/vendorResponseToken.js";

describe("vendor response token contract", () => {
  const originalSecret = process.env.SESSION_SECRET;

  afterEach(() => {
    vi.useRealTimers();
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  });

  it("binds the credential to order and purpose", () => {
    process.env.SESSION_SECRET = "focused-token-test-secret";
    const token = signVendorResponseToken(
      "PRD-TEST-1",
      null,
      undefined,
      "product_vendor_response",
    );

    expect(verifyVendorResponseToken(
      "PRD-TEST-1",
      token,
      null,
      "product_vendor_response",
    )).toBe(true);
    expect(verifyVendorResponseToken(
      "PRD-TEST-2",
      token,
      null,
      "product_vendor_response",
    )).toBe(false);
    expect(verifyVendorResponseToken(
      "PRD-TEST-1",
      token,
      null,
      "logistic_vendor_response",
    )).toBe(false);
  });

  it("expires explicitly instead of accepting a previous time window", () => {
    process.env.SESSION_SECRET = "focused-token-test-secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T00:00:00.000Z"));
    const token = signVendorResponseToken(
      "PRD-TEST-EXPIRY",
      null,
      undefined,
      "product_vendor_response",
    );

    vi.setSystemTime(new Date("2026-09-14T00:00:01.000Z"));
    expect(verifyVendorResponseToken(
      "PRD-TEST-EXPIRY",
      token,
      null,
      "product_vendor_response",
    )).toBe(false);
  });

  it("rejects tampering and legacy unscoped hex credentials", () => {
    process.env.SESSION_SECRET = "focused-token-test-secret";
    const token = signVendorResponseToken("PRD-TEST-TAMPER");
    const parts = token.split(".");
    parts[1] = `${parts[1]}x`;

    expect(verifyVendorResponseToken("PRD-TEST-TAMPER", parts.join("."))).toBe(false);
    expect(verifyVendorResponseToken(
      "PRD-TEST-TAMPER",
      "00".repeat(32),
    )).toBe(false);
  });
});