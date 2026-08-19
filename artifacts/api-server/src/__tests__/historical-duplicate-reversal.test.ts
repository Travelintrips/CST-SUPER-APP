import { describe, expect, it } from "vitest";

import { vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: { execute: vi.fn() } }));
vi.mock("../lib/accounting.js", () => ({
  postEntry: vi.fn(),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  validateHistoricalDuplicateEvidence,
  type HistoricalDuplicateEvidence,
} from "../lib/accounting/historicalDuplicateReversal.js";

function evidence(overrides: Partial<HistoricalDuplicateEvidence> = {}): HistoricalDuplicateEvidence {
  return {
    legacy: {
      id: 14593, companyId: 1, status: "posted", source: "sport_center_booking",
      sourceId: 3930, ref: "SC-0239", totalDebit: 160000, totalCredit: 160000,
      voidEntryId: null, isVoided: false, isReversed: false,
    },
    canonical: {
      id: 28585, companyId: 1, status: "posted", source: "sport_center_payment",
      sourcePaymentId: 198, totalDebit: 160000, totalCredit: 160000,
      paymentSourceType: "sport_center", paymentSourceDocId: 198, paymentStatus: "posted",
      paymentAmount: 160000, sportPaymentId: 198, sportPaymentStatus: "confirmed",
      sportBookingId: 283, sportBookingOrderNumber: "SC-0239",
    },
    legacyLines: [
      { accountId: 1104, debit: 160000, credit: 0 },
      { accountId: 4001, debit: 0, credit: 160000 },
    ],
    canonicalLines: [
      { accountId: 1104, debit: 160000, credit: 0 },
      { accountId: 4001, debit: 0, credit: 160000 },
    ],
    existingReversalCount: 0,
    ...overrides,
  };
}

describe("historical duplicate reversal validation", () => {
  it("accepts different legacy source_id when ref identity chain matches", () => {
    const result = validateHistoricalDuplicateEvidence(evidence());
    expect(result.safe).toBe(true);
  });

  it("rejects a mismatched booking/order ref", () => {
    const result = validateHistoricalDuplicateEvidence(evidence({
      canonical: { ...evidence().canonical, sportBookingOrderNumber: "SC-OTHER" },
    }));
    expect(result.safe).toBe(false);
    expect(result.reasons).toContain("legacy ref does not match canonical sport booking order_number");
  });

  it("rejects a payment belonging to a different booking", () => {
    const result = validateHistoricalDuplicateEvidence(evidence({
      canonical: { ...evidence().canonical, sportBookingId: 999 },
    }));
    expect(result.safe).toBe(false);
    expect(result.reasons).toContain("canonical payment identity chain mismatch");
  });

  it("rejects a bank account mismatch", () => {
    const result = validateHistoricalDuplicateEvidence(evidence({
      canonicalLines: [
        { accountId: 1105, debit: 160000, credit: 0 },
        { accountId: 4001, debit: 0, credit: 160000 },
      ],
    }));
    expect(result.safe).toBe(false);
    expect(result.reasons).toContain("bank debit account mismatch");
  });

  it("rejects an amount mismatch", () => {
    const result = validateHistoricalDuplicateEvidence(evidence({
      canonical: { ...evidence().canonical, totalDebit: 150000, totalCredit: 150000 },
    }));
    expect(result.safe).toBe(false);
    expect(result.reasons).toContain("total debit mismatch");
  });

  it("keeps an existing reversal idempotently blocked", () => {
    const result = validateHistoricalDuplicateEvidence(evidence({ existingReversalCount: 1 }));
    expect(result.safe).toBe(false);
    expect(result.reasons).toContain("historical duplicate reversal already exists");
  });

  it("requires the canonical entry and payments to remain immutable by validation", () => {
    const result = validateHistoricalDuplicateEvidence(evidence({
      canonical: { ...evidence().canonical, source: "sport_center_booking" },
    }));
    expect(result.safe).toBe(false);
    expect(result.reasons).toContain("canonical source mismatch");
  });

  it("rejects unbalanced legacy evidence", () => {
    const result = validateHistoricalDuplicateEvidence(evidence({
      legacy: { ...evidence().legacy, totalCredit: 159999 },
    }));
    expect(result.safe).toBe(false);
    expect(result.reasons).toContain("legacy entry is unbalanced");
  });
});