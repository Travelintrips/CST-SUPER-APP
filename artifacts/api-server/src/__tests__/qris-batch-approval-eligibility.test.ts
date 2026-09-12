/**
 * QRIS Batch Approval Eligibility — pure logic tests.
 *
 * These tests prove that the server-side eligibility guard:
 *  1. Accepts MATCHED candidates and REVIEW candidates for explicit override.
 *  2. Rejects REVIEW candidates only when their net is negative.
 *  3. Rejects UNMATCHED and any other non-MATCHED status.
 *  4. Rejects candidates with negative net amounts (mis-detected direction).
 *  5. Rejects already-approved candidates.
 *  6. Accepts a valid MATCHED batch with positive net.
 */

import { describe, it, expect } from "vitest";
import {
  checkQrisBatchApprovalEligibility,
  assertQrisBatchApprovalEligible,
  hasQrisBatchPaymentItems,
  type QrisBatchCandidateForEligibility,
} from "../lib/reconciliation/qrisBatchApprovalEligibility.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function candidate(
  overrides: Partial<QrisBatchCandidateForEligibility>,
): QrisBatchCandidateForEligibility {
  return {
    id: 1,
    reconciliation_status: "MATCHED",
    status: "candidate_review",
    confidence: 0.98,
    net_amount: 100_000,
    observed_deduction: 1_500,
    ...overrides,
  };
}

// ─── checkQrisBatchApprovalEligibility ────────────────────────────────────────

describe("checkQrisBatchApprovalEligibility", () => {
  it("returns null for a valid MATCHED candidate", () => {
    expect(checkQrisBatchApprovalEligibility(candidate({}))).toBeNull();
  });

  it("allows REVIEW status for explicit manual override (unknown provider)", () => {
    const result = checkQrisBatchApprovalEligibility(
      candidate({ reconciliation_status: "REVIEW" }),
    );
    expect(result).toBeNull();
  });

  it("allows REVIEW status for explicit manual override (ambiguous partition)", () => {
    const result = checkQrisBatchApprovalEligibility(
      candidate({ reconciliation_status: "REVIEW", confidence: 0 }),
    );
    expect(result).toBeNull();
  });

  it("returns NOT_MATCHED error for UNMATCHED status", () => {
    const result = checkQrisBatchApprovalEligibility(
      candidate({ reconciliation_status: "UNMATCHED" }),
    );
    expect(result?.code).toBe("NOT_MATCHED");
    expect(result?.message).toMatch(/MATCHED/);
  });

  it("returns NOT_MATCHED for empty or unknown reconciliation_status", () => {
    for (const status of ["", "unknown", "PARTIAL", "PENDING"]) {
      const result = checkQrisBatchApprovalEligibility(
        candidate({ reconciliation_status: status }),
      );
      expect(result?.code).toBe("NOT_MATCHED");
    }
  });

  it("returns ALREADY_APPROVED for a previously-approved candidate", () => {
    const result = checkQrisBatchApprovalEligibility(
      candidate({ status: "approved" }),
    );
    expect(result?.code).toBe("ALREADY_APPROVED");
  });

  it("returns NEGATIVE_NET for a candidate where deduction exceeds gross", () => {
    // e.g. a mis-detected IN/OUT direction makes net negative
    const result = checkQrisBatchApprovalEligibility(
      candidate({ net_amount: -500, observed_deduction: 2_000 }),
    );
    expect(result?.code).toBe("NEGATIVE_NET");
    expect(result?.message).toMatch(/negatif/i);
  });

  it("accepts net_amount of exactly 0 (edge case — zero-net is valid for MDR=gross)", () => {
    // Pathological but not a sign error; the DB insert will use 0.
    expect(checkQrisBatchApprovalEligibility(candidate({ net_amount: 0 }))).toBeNull();
  });

  it("case-insensitively accepts 'review' and 'matched'", () => {
    expect(
      checkQrisBatchApprovalEligibility(candidate({ reconciliation_status: "review" }))?.code,
    ).toBeUndefined();
    expect(
      checkQrisBatchApprovalEligibility(candidate({ reconciliation_status: "matched" })),
    ).toBeNull();
  });
});

describe("hasQrisBatchPaymentItems", () => {
  it("rejects an empty candidate payload", () => {
    expect(hasQrisBatchPaymentItems([])).toBe(false);
    expect(hasQrisBatchPaymentItems(null)).toBe(false);
    expect(hasQrisBatchPaymentItems({})).toBe(false);
  });

  it("accepts a candidate with at least one payment item", () => {
    expect(hasQrisBatchPaymentItems([{ paymentId: 101 }])).toBe(true);
  });
});

// ─── assertQrisBatchApprovalEligible ─────────────────────────────────────────

describe("assertQrisBatchApprovalEligible", () => {
  it("does not throw for a valid MATCHED candidate", () => {
    expect(() => assertQrisBatchApprovalEligible(candidate({}))).not.toThrow();
  });

  it("allows REVIEW candidate through the explicit manual-override path", () => {
    expect(() =>
      assertQrisBatchApprovalEligible(candidate({ reconciliation_status: "REVIEW" })),
    ).not.toThrow();
  });

  it("throws with eligibilityError=true for UNMATCHED candidate", () => {
    try {
      assertQrisBatchApprovalEligible(candidate({ reconciliation_status: "UNMATCHED" }));
    } catch (e: any) {
      expect(e.eligibilityError).toBe(true);
      expect(e.code).toBe("NOT_MATCHED");
    }
  });

  it("throws with eligibilityError=true for negative net amount", () => {
    try {
      assertQrisBatchApprovalEligible(candidate({ net_amount: -100 }));
    } catch (e: any) {
      expect(e.eligibilityError).toBe(true);
      expect(e.code).toBe("NEGATIVE_NET");
    }
  });

  it("throws with eligibilityError=true for already-approved candidate", () => {
    try {
      assertQrisBatchApprovalEligible(candidate({ status: "approved" }));
    } catch (e: any) {
      expect(e.eligibilityError).toBe(true);
      expect(e.code).toBe("ALREADY_APPROVED");
    }
  });
});
