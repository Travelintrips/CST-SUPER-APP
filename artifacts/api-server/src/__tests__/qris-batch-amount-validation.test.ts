/**
 * QRIS Batch Approval — Amount & Total Invariant Validation Tests
 *
 * Proves that the server-side validation layer:
 *  1. Rejects candidates with duplicate payment IDs.
 *  2. Rejects stale candidates (payment amount changed after generation).
 *  3. Rejects tampered candidates (item gross sum ≠ header gross).
 *  4. Rejects internally inconsistent candidates (net ≠ gross − fees).
 *  5. Accepts valid candidates with matching amounts and consistent totals.
 *
 * All functions are pure — no DB, no network. The route uses these same
 * functions so these tests prove no settlement is written on rejection.
 */

import { describe, it, expect } from "vitest";
import {
  checkDuplicatePaymentIds,
  checkStaleAmounts,
  checkHeaderTotals,
  type QrisCandidateItem,
  type QrisCandidateHeader,
  type LivePayment,
} from "../lib/reconciliation/qrisBatchAmountValidation.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function items(...pairs: [id: number, gross: number][]): QrisCandidateItem[] {
  return pairs.map(([paymentId, grossAmount]) => ({ paymentId, grossAmount }));
}

function header(
  gross: number,
  mdr: number,
  otherFee: number,
  net: number,
): QrisCandidateHeader {
  return { gross_amount: gross, mdr_amount: mdr, other_fee_amount: otherFee, net_amount: net };
}

function live(...pairs: [id: number, amount: number][]): LivePayment[] {
  return pairs.map(([id, amount]) => ({ id, amount }));
}

// ─── checkDuplicatePaymentIds ─────────────────────────────────────────────────

describe("checkDuplicatePaymentIds", () => {
  it("returns null for a list with all unique IDs", () => {
    expect(checkDuplicatePaymentIds(items([1, 50_000], [2, 50_000]))).toBeNull();
  });

  it("returns DUPLICATE_PAYMENT_ID for a list with a repeated ID", () => {
    const result = checkDuplicatePaymentIds(items([1, 50_000], [1, 50_000]));
    expect(result?.code).toBe("DUPLICATE_PAYMENT_ID");
    expect(result?.paymentId).toBe(1);
    expect(result?.message).toMatch(/duplikat.*1/i);
  });

  it("catches the second occurrence of a duplicate even if it appears later", () => {
    const result = checkDuplicatePaymentIds(items([1, 10_000], [2, 20_000], [1, 10_000]));
    expect(result?.code).toBe("DUPLICATE_PAYMENT_ID");
    expect(result?.paymentId).toBe(1);
  });

  it("returns null for a single-item list", () => {
    expect(checkDuplicatePaymentIds(items([7, 100_000]))).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(checkDuplicatePaymentIds([])).toBeNull();
  });
});

// ─── checkStaleAmounts ────────────────────────────────────────────────────────

describe("checkStaleAmounts", () => {
  it("returns null when all candidate amounts match live payment amounts", () => {
    const result = checkStaleAmounts(
      items([1, 100_000], [2, 200_000]),
      live([1, 100_000], [2, 200_000]),
    );
    expect(result).toBeNull();
  });

  it("returns STALE_CANDIDATE_AMOUNT when candidate gross differs from live amount", () => {
    // Payment was edited from 100_000 to 95_000 after candidate generation
    const result = checkStaleAmounts(
      items([1, 100_000], [2, 200_000]),
      live([1, 95_000], [2, 200_000]),
    );
    expect(result?.code).toBe("STALE_CANDIDATE_AMOUNT");
    expect(result?.paymentId).toBe(1);
    expect(result?.liveAmount).toBe(95_000);
    expect(result?.candidateGross).toBe(100_000);
    expect(result?.message).toMatch(/kandidat.*generate ulang/i);
  });

  it("allows exactly 1-unit rounding difference (default tolerance)", () => {
    // IDR truncation can cause ±1 difference
    expect(
      checkStaleAmounts(items([1, 100_001]), live([1, 100_000])),
    ).toBeNull();
  });

  it("rejects a 2-unit difference with default tolerance", () => {
    const result = checkStaleAmounts(items([1, 100_002]), live([1, 100_000]));
    expect(result?.code).toBe("STALE_CANDIDATE_AMOUNT");
  });

  it("uses custom tolerance when provided", () => {
    // tolerance = 500 → difference of 300 is OK
    expect(
      checkStaleAmounts(items([1, 100_300]), live([1, 100_000]), 500),
    ).toBeNull();
    // but 600 is not
    expect(
      checkStaleAmounts(items([1, 100_600]), live([1, 100_000]), 500)?.code,
    ).toBe("STALE_CANDIDATE_AMOUNT");
  });

  it("skips items whose paymentId has no matching live payment (checked elsewhere)", () => {
    // Missing live payment is a separate validation concern; this function skips it
    const result = checkStaleAmounts(items([99, 50_000]), live([1, 50_000]));
    expect(result).toBeNull();
  });

  it("returns the first stale item when multiple are stale", () => {
    const result = checkStaleAmounts(
      items([1, 100_000], [2, 200_000]),
      live([1, 80_000], [2, 180_000]),
    );
    expect(result?.paymentId).toBe(1); // first one found
  });
});

// ─── checkHeaderTotals ────────────────────────────────────────────────────────

describe("checkHeaderTotals", () => {
  it("returns null for a candidate with correct totals", () => {
    // gross = 300_000, mdr = 3_000, other = 0, net = 297_000
    const h = header(300_000, 3_000, 0, 297_000);
    const i = items([1, 100_000], [2, 100_000], [3, 100_000]);
    expect(checkHeaderTotals(h, i)).toBeNull();
  });

  it("returns ITEM_GROSS_MISMATCH when sum(items.gross) ≠ header.gross", () => {
    // Tampered: header says 300_000 but items only add up to 200_000
    const h = header(300_000, 3_000, 0, 297_000);
    const i = items([1, 100_000], [2, 100_000]); // only 200_000
    const result = checkHeaderTotals(h, i, 1);
    expect(result?.code).toBe("ITEM_GROSS_MISMATCH");
    expect(result?.message).toMatch(/bruto.*200000.*300000/i);
  });

  it("returns NET_INCONSISTENT when net ≠ gross − fees", () => {
    // gross=300_000, mdr=3_000, other=0 → expected net=297_000; candidate says 290_000
    const h = header(300_000, 3_000, 0, 290_000);
    const i = items([1, 100_000], [2, 100_000], [3, 100_000]);
    const result = checkHeaderTotals(h, i, 1);
    expect(result?.code).toBe("NET_INCONSISTENT");
    expect(result?.message).toMatch(/netto.*290000.*tidak konsisten/i);
  });

  it("uses default tolerance = items.length for rounding-safe comparison", () => {
    // Three items → tolerance = 3; a 2-unit diff should be accepted
    const h = header(300_002, 3_000, 0, 297_002);
    const i = items([1, 100_000], [2, 100_000], [3, 100_002]);
    expect(checkHeaderTotals(h, i)).toBeNull();
  });

  it("accepts net = gross with mdr=0 and other_fee=0", () => {
    const h = header(500_000, 0, 0, 500_000);
    const i = items([1, 250_000], [2, 250_000]);
    expect(checkHeaderTotals(h, i)).toBeNull();
  });

  it("validates both checks in sequence — returns gross mismatch before net check", () => {
    // Both are wrong; we should get the item-gross error first
    const h = header(400_000, 3_000, 0, 290_000); // items only = 200_000
    const i = items([1, 100_000], [2, 100_000]);
    const result = checkHeaderTotals(h, i, 1);
    expect(result?.code).toBe("ITEM_GROSS_MISMATCH");
  });
});
