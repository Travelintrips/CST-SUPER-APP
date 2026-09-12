import { describe, expect, it } from "vitest";
import {
  isSportPaymentPostingRetryable,
  validateSportPaymentMirror,
  validateSportPaymentPosting,
  type SportPaymentPostingEvidence,
} from "../modules/sport-center/sportPaymentValidation.js";

function evidence(overrides: Partial<SportPaymentPostingEvidence> = {}): SportPaymentPostingEvidence {
  return {
    sourcePaymentId: 41,
    mirrorPaymentId: 501,
    sourceAmount: 125000,
    mirrorAmount: 125000,
    accountingPaymentAmount: 125000,
    journalTotalDebit: 125000,
    journalTotalCredit: 125000,
    sourceBookingId: 77,
    sourceBookingNumber: "BK-077",
    mirrorBookingId: 9001,
    mirrorSourceBookingId: 77,
    mirrorBookingNumber: "BK-077",
    accountingSourceType: "sport_center",
    accountingSourceDocId: 501,
    accountingReference: "BK-077",
    journalSource: "sport_center_booking",
    journalSourceId: 9001,
    ...overrides,
  };
}

describe("Sport Center payment posting validation", () => {
  it("allows posting only when all amount and identity evidence agrees", () => {
    expect(validateSportPaymentPosting(evidence())).toEqual({ ok: true });
  });

  it.each([
    ["source vs mirror", { mirrorAmount: 125001 }, "source amount"],
    ["source vs accounting payment", { accountingPaymentAmount: 125001 }, "accounting payment amount"],
    ["source vs journal debit total", { journalTotalDebit: 125001 }, "journal debit total"],
    ["source vs journal credit total", { journalTotalCredit: 125001 }, "journal credit total"],
  ])("blocks %s amount mismatch as manual review", (_name, override, expectedText) => {
    const result = validateSportPaymentPosting(evidence(override));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("manual_review");
      expect(result.error).toContain(expectedText);
    }
  });

  it.each([
    ["source/mirror booking id", { mirrorSourceBookingId: 78 }],
    ["mirror/journal booking id", { journalSourceId: 9002 }],
    ["source/mirror booking number", { mirrorBookingNumber: "BK-078" }],
    ["source/accounting booking reference", { accountingReference: "BK-078" }],
  ])("blocks %s identity mismatch as manual review", (_name, override) => {
    const result = validateSportPaymentPosting(evidence(override));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.state).toBe("manual_review");
  });

  it("blocks duplicate booking mirrors as manual review", () => {
    const result = validateSportPaymentPosting(
      evidence({ duplicateBookingMirrorCount: 2 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("manual_review");
      expect(result.error).toContain("duplicate booking mirrors");
      expect(isSportPaymentPostingRetryable(result.state)).toBe(false);
    }
  });

  it("uses failed for unavailable evidence and keeps it retryable", () => {
    const result = validateSportPaymentPosting(
      evidence({ accountingPaymentAmount: null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.state).toBe("failed");

    expect(isSportPaymentPostingRetryable("unposted")).toBe(true);
    expect(isSportPaymentPostingRetryable("failed")).toBe(true);
    expect(isSportPaymentPostingRetryable("manual_review")).toBe(false);
    expect(isSportPaymentPostingRetryable("posted")).toBe(false);
  });

  it("classifies missing source or mirror data as an explicit failure", () => {
    const result = validateSportPaymentMirror(
      {
        sourceAmount: null,
        mirrorAmount: 125000,
        sourceBookingId: 77,
        sourceBookingNumber: "BK-077",
        mirrorBookingId: 9001,
        mirrorSourceBookingId: 77,
        mirrorBookingNumber: "BK-077",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.state).toBe("failed");
  });
});