import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/bankReconciliation.ts"),
  "utf8",
);

function reopenRoute(): string {
  const start = routeSource.indexOf('router.post("/:mutationId/reopen"');
  const end = routeSource.indexOf('router.post("/:mutationId/reject"', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return routeSource.slice(start, end);
}

describe("posted bank unmatch lifecycle contract", () => {
  it("releases the old approved match and clears legacy mutation ownership atomically", () => {
    const route = reopenRoute();

    expect(route).toContain("await db.transaction(async (tx) =>");
    expect(route).toContain("SET status = 'candidate'");
    expect(route).toContain("WHERE mutation_id = ${mutId} AND status = 'approved'");
    expect(route).toContain("matched_payment_id = NULL");
    expect(route).toContain("matched_order_id = NULL");
    expect(route).toContain("linked_transaction_type = NULL");
    expect(route).toContain("linked_transaction_id = NULL");
    expect(route).toContain("reconciliation_status = 'unmatched'");
    expect(route).toContain("'REOPENED'");
  });

  it("returns the released match IDs so the caller can verify the old approval was reopened", () => {
    const route = reopenRoute();
    expect(route).toContain("released_approved_match_ids");
    expect(route).toContain("released_match_ids: releasedMatchIds");
  });
});