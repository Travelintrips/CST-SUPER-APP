/**
 * vendorReviewGuard.test.ts — Vendor Master Enhancement P1: anti self-review
 *
 * Pure logic tests for evaluateReviewEligibility(). No DB required — the
 * route handler resolves the facts (linked supplier, transaction ownership)
 * and this function only decides pass/fail.
 */

import { describe, it, expect } from "vitest";
import { evaluateReviewEligibility, type ReviewGuardInput } from "../vendorReviewGuard.js";

function baseInput(overrides: Partial<ReviewGuardInput> = {}): ReviewGuardInput {
  return {
    linkedSupplierId: null,
    vendorId: 10,
    transactionVendorId: 10,
    transactionCustomerId: 5,
    requestingCustomerId: 5,
    transactionStatusEligible: true,
    transactionFound: true,
    ...overrides,
  };
}

describe("evaluateReviewEligibility", () => {
  it("allows a normal buyer with a valid completed transaction", () => {
    const result = evaluateReviewEligibility(baseInput());
    expect(result.ok).toBe(true);
  });

  it("blocks a vendor from reviewing itself (linked supplier === target vendor)", () => {
    const result = evaluateReviewEligibility(
      baseInput({ linkedSupplierId: 10, vendorId: 10 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe("SELF_REVIEW_NOT_ALLOWED");
    }
  });

  it("allows a vendor to review a different vendor, given a valid transaction", () => {
    const result = evaluateReviewEligibility(
      baseInput({ linkedSupplierId: 99, vendorId: 10, transactionVendorId: 10 }),
    );
    expect(result.ok).toBe(true);
  });

  it("blocks cross-vendor transaction misuse (transaction belongs to a different vendor)", () => {
    const result = evaluateReviewEligibility(
      baseInput({ transactionVendorId: 999 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TRANSACTION_OWNERSHIP_INVALID");
  });

  it("blocks when the transaction does not belong to the requesting customer", () => {
    const result = evaluateReviewEligibility(
      baseInput({ transactionCustomerId: 7, requestingCustomerId: 5 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TRANSACTION_OWNERSHIP_INVALID");
  });

  it("blocks when the transaction status is not eligible (not completed)", () => {
    const result = evaluateReviewEligibility(
      baseInput({ transactionStatusEligible: false }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TRANSACTION_OWNERSHIP_INVALID");
  });

  it("blocks when the transaction is not found at all", () => {
    const result = evaluateReviewEligibility(
      baseInput({ transactionFound: false, transactionVendorId: null, transactionCustomerId: null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TRANSACTION_OWNERSHIP_INVALID");
  });

  it("self-review check takes priority even if the transaction would otherwise be valid", () => {
    const result = evaluateReviewEligibility(
      baseInput({ linkedSupplierId: 10, vendorId: 10, transactionVendorId: 10, transactionStatusEligible: true }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SELF_REVIEW_NOT_ALLOWED");
  });
});
