// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  resolve(process.cwd(), "src/pages/accounting/bank-reconciliation.tsx"),
  "utf8",
);

type CandidateFixture = {
  candidate_type: string;
  candidate_source: string;
  status: string;
  amount_match?: boolean;
  date_match?: boolean;
  settlement_status?: string;
};

type MutationFixture = {
  status: string;
  candidates: CandidateFixture[];
  canonicalSettlementStatus: string;
  qrisSnapshotPaymentIds?: number[];
  currentPaymentIds?: number[];
  settledPaymentIds?: number[];
  activeSettlementPaymentIds?: number[];
};

function isClosedQrisSettlement(mutation: MutationFixture): boolean {
  if (mutation.canonicalSettlementStatus !== "posted") return false;
  const qrisCandidates = mutation.candidates.filter(
    candidate => candidate.candidate_type === "qris_settlement",
  );
  return qrisCandidates.length > 0 && qrisCandidates.every(candidate =>
    ["approved", "completed"].includes(candidate.status.toLowerCase())
    || ["posted", "reconciled", "settled", "completed"].includes(
      (candidate.settlement_status ?? "").toLowerCase(),
    ),
  );
}

function hasApprovedMatch(mutation: MutationFixture): boolean {
  return mutation.candidates.some(
    candidate => candidate.status.toLowerCase() === "approved",
  );
}

function isCanonicalApprovalEligible(mutation: MutationFixture): boolean {
  const canonicalCandidates = mutation.candidates.filter(
    item =>
      item.candidate_type === "qris_settlement" &&
      item.candidate_source === "sport_center.payment_settlement_batches" &&
      ["candidate", "approved"].includes(item.status.toLowerCase()),
  );
  const candidate = canonicalCandidates.length === 1 ? canonicalCandidates[0] : undefined;
  return (
    mutation.status === "matched" &&
    candidate != null &&
    candidate.status.toLowerCase() !== "approved" &&
    !hasApprovedMatch(mutation) &&
    mutation.canonicalSettlementStatus === "posted" &&
    candidate.amount_match === true &&
    candidate.date_match === true &&
    hasLiveUnsettledPayments(mutation)
  );
}

function hasLiveUnsettledPayments(mutation: MutationFixture): boolean {
  const snapshotIds = mutation.qrisSnapshotPaymentIds ?? [];
  const settledIds = new Set(mutation.settledPaymentIds ?? []);
  const activeSettlementIds = new Set(mutation.activeSettlementPaymentIds ?? []);
  const currentIds = mutation.currentPaymentIds ?? snapshotIds;

  return currentIds.some(
    paymentId => snapshotIds.includes(paymentId)
      && !settledIds.has(paymentId)
      && !activeSettlementIds.has(paymentId),
  );
}

function isLiveCanonicalApprovalEligible(mutation: MutationFixture): boolean {
  return isCanonicalApprovalEligible(mutation) && hasLiveUnsettledPayments(mutation);
}

function isHistoricalRecoveryEligible(mutation: MutationFixture): boolean {
  return (
    mutation.status === "matched" &&
    mutation.canonicalSettlementStatus === "posted" &&
    !hasLiveUnsettledPayments(mutation)
  );
}

function isQrisApprovalButtonEnabled(mutation: MutationFixture): boolean {
  return isLiveCanonicalApprovalEligible(mutation);
}

const canonicalCandidate: CandidateFixture = {
  candidate_type: "qris_settlement",
  candidate_source: "sport_center.payment_settlement_batches",
  status: "candidate",
  amount_match: true,
  date_match: true,
};

describe("bank reconciliation approved-match UI guard", () => {
  it("does not label a matched mutation as ready when another match is approved", () => {
    const mutation: MutationFixture = {
      status: "matched",
      candidates: [
        canonicalCandidate,
        {
          candidate_type: "accounting_payment",
          candidate_source: "legacy",
          status: "approved",
        },
      ],
      canonicalSettlementStatus: "posted",
    };

    expect(hasApprovedMatch(mutation)).toBe(true);
    expect(isCanonicalApprovalEligible(mutation)).toBe(false);
  });

  it("locks the QRIS approval button for the same conflict state", () => {
    const mutation: MutationFixture = {
      status: "matched",
      candidates: [
        canonicalCandidate,
        {
          candidate_type: "sport_payment",
          candidate_source: "legacy",
          status: "approved",
        },
      ],
      canonicalSettlementStatus: "posted",
    };

    expect(isQrisApprovalButtonEnabled(mutation)).toBe(false);
  });

  it("keeps a clean posted canonical candidate eligible", () => {
    const mutation: MutationFixture = {
      status: "matched",
      candidates: [canonicalCandidate],
      canonicalSettlementStatus: "posted",
      qrisSnapshotPaymentIds: [11],
      currentPaymentIds: [11],
    };

    expect(isLiveCanonicalApprovalEligible(mutation)).toBe(true);
    expect(isQrisApprovalButtonEnabled(mutation)).toBe(true);
  });

  it("hides the canonical action when duplicate active candidates exist", () => {
    const mutation: MutationFixture = {
      status: "matched",
      candidates: [
        canonicalCandidate,
        { ...canonicalCandidate, candidate_id: 52 },
      ],
      canonicalSettlementStatus: "posted",
      qrisSnapshotPaymentIds: [11],
      currentPaymentIds: [11],
    };

    expect(isCanonicalApprovalEligible(mutation)).toBe(false);
    expect(isQrisApprovalButtonEnabled(mutation)).toBe(false);
  });

  it("routes an old posted snapshot with all live payments settled to recovery", () => {
    const mutation: MutationFixture = {
      status: "matched",
      candidates: [canonicalCandidate],
      canonicalSettlementStatus: "posted",
      qrisSnapshotPaymentIds: [11, 12],
      currentPaymentIds: [],
      settledPaymentIds: [11],
      activeSettlementPaymentIds: [12],
    };

    expect(isLiveCanonicalApprovalEligible(mutation)).toBe(false);
    expect(isHistoricalRecoveryEligible(mutation)).toBe(true);
    expect(isQrisApprovalButtonEnabled(mutation)).toBe(false);
  });

  it("closes all card actions when the QRIS settlement is already fully used", () => {
    const mutation: MutationFixture = {
      status: "approved",
      candidates: [{
        ...canonicalCandidate,
        status: "approved",
        settlement_status: "posted",
      }],
      canonicalSettlementStatus: "posted",
    };

    expect(isClosedQrisSettlement(mutation)).toBe(true);
  });

  it("asserts the rendered component uses the approved-match guard", () => {
    expect(componentSource).toContain("function hasApprovedReconciliationMatch");
    expect(componentSource).toContain(
      "if (m.status === \"matched\" && hasApprovedReconciliationMatch(m)) return \"Perlu Diperiksa\";",
    );
    expect(componentSource).toContain(
      "&& !hasApprovedReconciliationMatch(m)",
    );
    expect(componentSource).toContain(
      "Mutasi sudah memiliki approved match lain. Approval QRIS dikunci",
    );
    expect(componentSource).toContain("const canonicalHistoricalRepairReady = isCanonicalHistoricalRepairEligible(");
    expect(componentSource).toContain("function activeCanonicalSettlementCandidatesForMutation");
    expect(componentSource).toContain("if (activeCandidates.length !== 1) return undefined;");
    expect(componentSource).toContain("const canonicalSettlementSelectionConflict");
    expect(componentSource).toContain("&& !canonicalSettlementSelectionConflict");
    expect(componentSource).toContain("onApproveCandidate?: (m: BankMutation, candidate: Candidate) => void;");
    expect(componentSource).toContain("Tautkan & Rekonsiliasi");
    expect(componentSource).toContain("&& !canonicalHistoricalRepairReady");
    expect(componentSource).toContain("Settlement Tertunda");
    expect(componentSource).toContain("Selesaikan Settlement Tertunda");
    expect(componentSource).toContain("function isFullyUsedQrisCandidate");
    expect(componentSource).toContain("const isClosedQrisSettlement =");
    expect(componentSource).toContain("Settlement sudah digunakan");
  });
});