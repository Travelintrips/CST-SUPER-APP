import { describe, expect, it } from "vitest";
import { resolveRequiredCandidateStatus } from "../lib/reconciliation/candidateRequirementStatus.js";

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
});