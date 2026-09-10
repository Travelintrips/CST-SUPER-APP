import { describe, expect, it } from "vitest";
import {
  requiredCandidateApprovalError,
  resolveRequiredCandidateStatus,
} from "../lib/reconciliation/candidateRequirementStatus.js";

describe("Rule AI required-candidate status", () => {
  it("keeps a mutation unmatched while no transaction candidate exists", () => {
    expect(resolveRequiredCandidateStatus({
      best: undefined,
      status: "unmatched",
    })).toBe("unmatched");
  });

  it("does not downgrade a real candidate result", () => {
    expect(resolveRequiredCandidateStatus({
      best: { candidate: { id: 42 } },
      status: "manual_review",
    })).toBe("manual_review");

    expect(resolveRequiredCandidateStatus({
      best: { candidate: { id: 42 } },
      status: "auto_matched",
    })).toBe("auto_matched");
  });

  it("blocks approval without a real transaction candidate", () => {
    expect(requiredCandidateApprovalError({
      candidateRequirement: "required",
      candidateType: null,
      candidateId: null,
    })).toMatchObject({ code: "RULE_CANDIDATE_REQUIRED" });

    expect(requiredCandidateApprovalError({
      candidateRequirement: "required",
      candidateType: "recon_rule",
      candidateId: 7,
    })).toMatchObject({ code: "RULE_CANDIDATE_REQUIRED" });
  });

  it("allows approval when a required rule has a real candidate", () => {
    expect(requiredCandidateApprovalError({
      candidateRequirement: "required",
      candidateType: "invoice",
      candidateId: 42,
    })).toBeNull();
  });
});