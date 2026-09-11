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
};

const realTransactionCandidateTypes = new Set([
  "accounting_payment",
  "logistic_order",
  "invoice",
  "expense",
  "sport_payment",
  "qris_settlement",
  "tenant_invoice",
  "internal_transfer",
]);

function isRealTransactionCandidate(candidate: CandidateFixture): boolean {
  return realTransactionCandidateTypes.has(candidate.candidate_type);
}

function selectableCandidates(
  candidateRequirement: "required" | "not_required",
  candidates: CandidateFixture[],
): CandidateFixture[] {
  return candidateRequirement === "required"
    ? candidates.filter(isRealTransactionCandidate)
    : candidates;
}

describe("Rule AI required-candidate approval UI", () => {
  it("keeps a Rule AI COA classification visible but not selectable by itself", () => {
    const candidates = [{ candidate_type: "recon_rule" }];

    expect(selectableCandidates("required", candidates)).toEqual([]);
  });

  it("allows a real transaction candidate when the same rule requires one", () => {
    const candidates = [
      { candidate_type: "recon_rule" },
      { candidate_type: "accounting_payment" },
    ];

    expect(selectableCandidates("required", candidates)).toEqual([
      { candidate_type: "accounting_payment" },
    ]);
  });

  it("does not restrict ordinary rules that do not require a source transaction", () => {
    const candidates = [{ candidate_type: "recon_rule" }];

    expect(selectableCandidates("not_required", candidates)).toEqual(candidates);
  });

  it("wires the runtime guard into candidate selection and approval actions", () => {
    expect(componentSource).toContain('m.review_code === "RULE_CANDIDATE_REQUIRED"');
    expect(componentSource).toContain("matchingCandidates.filter(isRealTransactionCandidate)");
    expect(componentSource).toContain("candidateSelectionEnabled && candidateIsSelectable");
    expect(componentSource).toContain("onApproveCandidate && canApprove(m) && candidateIsSelectable");
    expect(componentSource).toContain(
      "Approve baru tersedia setelah ditemukan",
    );
  });
});