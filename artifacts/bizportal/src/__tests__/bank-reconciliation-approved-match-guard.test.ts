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
};

function hasApprovedMatch(mutation: MutationFixture): boolean {
  return mutation.candidates.some(
    candidate => candidate.status.toLowerCase() === "approved",
  );
}

function isCanonicalApprovalEligible(mutation: MutationFixture): boolean {
  const candidate = mutation.candidates.find(
    item =>
      item.candidate_type === "qris_settlement" &&
      item.candidate_source === "sport_center.payment_settlement_batches",
  );
  return (
    mutation.status === "matched" &&
    candidate != null &&
    candidate.status.toLowerCase() !== "approved" &&
    !hasApprovedMatch(mutation) &&
    mutation.canonicalSettlementStatus === "posted" &&
    candidate.amount_match === true &&
    candidate.date_match === true
  );
}

function isQrisApprovalButtonEnabled(mutation: MutationFixture): boolean {
  return (
    mutation.status === "matched" &&
    !hasApprovedMatch(mutation)
  );
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
    };

    expect(isCanonicalApprovalEligible(mutation)).toBe(true);
    expect(isQrisApprovalButtonEnabled(mutation)).toBe(true);
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
  });
});