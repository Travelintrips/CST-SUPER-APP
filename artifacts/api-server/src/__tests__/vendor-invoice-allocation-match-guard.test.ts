import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../routes/bankReconciliation.ts", import.meta.url),
  "utf8",
);

describe("vendor invoice allocation match guard", () => {
  it("does not treat an unapproved Rule AI candidate as an active settlement", () => {
    const nonBlockingRulePredicate =
      "OR (status = 'candidate' AND candidate_type <> 'recon_rule')";

    expect(routeSource.split(nonBlockingRulePredicate)).toHaveLength(3);
  });

  it("supersedes the Rule AI candidate in the same allocation transaction", () => {
    const supersedePredicate = "AND candidate_type = 'recon_rule'";

    expect(routeSource.split(supersedePredicate).length).toBeGreaterThanOrEqual(3);
    expect(routeSource).toContain("SET status = 'superseded'");
  });
});