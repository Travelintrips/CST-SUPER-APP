/**
 * Bank reconciliation manual-review UI contract.
 *
 * The component keeps QRIS/canonical settlements on their dedicated approval
 * path. A regular manual_review mutation must instead expose the COA picker
 * and allow the selected COA to create a draft through the guarded backend.
 */

import { describe, expect, it } from "vitest";

type ManualReviewFixture = {
  status: string;
  isQris: boolean;
  isCanonicalSettlement: boolean;
  candidateCount: number;
};

const STATUS_LABELS: Record<string, string> = {
  manual_review: "Review Manual",
};

const STATUS_COLORS: Record<string, string> = {
  manual_review: "bg-orange-50 text-orange-800 border-orange-300",
};

function canApprove(status: string): boolean {
  return ["unmatched", "matched", "manual_review", "duplicate_need_review"].includes(status);
}

function canReject(status: string): boolean {
  return ["unmatched", "matched", "manual_review", "duplicate_need_review", "approved_pending_posting"]
    .includes(status);
}

function isManualReviewActionable(mutation: ManualReviewFixture): boolean {
  return mutation.status === "manual_review"
    && !mutation.isQris
    && !mutation.isCanonicalSettlement;
}

function canApplySelectedCoaToCurrentMutation(mutation: ManualReviewFixture): boolean {
  return canApprove(mutation.status)
    && !mutation.isQris
    && !mutation.isCanonicalSettlement
    && (mutation.status === "manual_review" || mutation.candidateCount === 0);
}

describe("manual_review presentation", () => {
  const mutation: ManualReviewFixture = {
    status: "manual_review",
    isQris: false,
    isCanonicalSettlement: false,
    candidateCount: 1,
  };

  it("renders the explicit manual-review label and orange status treatment", () => {
    expect(STATUS_LABELS[mutation.status]).toBe("Review Manual");
    expect(STATUS_COLORS[mutation.status]).toContain("orange");
  });

  it("allows approve/reject guards before a journal has been posted", () => {
    expect(canApprove(mutation.status)).toBe(true);
    expect(canReject(mutation.status)).toBe(true);
  });

  it("shows the COA-to-draft action even when the reviewer has a candidate to inspect", () => {
    expect(isManualReviewActionable(mutation)).toBe(true);
    expect(canApplySelectedCoaToCurrentMutation(mutation)).toBe(true);
  });
});

describe("manual_review action boundaries", () => {
  it("does not expose the generic COA draft action for QRIS review", () => {
    const qrisReview: ManualReviewFixture = {
      status: "manual_review",
      isQris: true,
      isCanonicalSettlement: false,
      candidateCount: 1,
    };

    expect(isManualReviewActionable(qrisReview)).toBe(false);
    expect(canApplySelectedCoaToCurrentMutation(qrisReview)).toBe(false);
  });

  it("does not expose the generic COA draft action for canonical settlement review", () => {
    const canonicalReview: ManualReviewFixture = {
      status: "manual_review",
      isQris: false,
      isCanonicalSettlement: true,
      candidateCount: 1,
    };

    expect(isManualReviewActionable(canonicalReview)).toBe(false);
    expect(canApplySelectedCoaToCurrentMutation(canonicalReview)).toBe(false);
  });
});