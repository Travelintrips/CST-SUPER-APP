import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../routes/accountingHub.ts", import.meta.url),
  "utf8",
);

describe("general ledger account hierarchy scope", () => {
  it("includes selected COA descendants when filtering by account", () => {
    expect(routeSource).toContain("WITH RECURSIVE account_scope(id) AS");
    expect(routeSource).toContain("JOIN account_scope parent ON parent.id = child.parent_id");
    expect(routeSource).toContain("el.account_id IN (");
  });

  it("aggregates opening and running balances for a selected parent scope", () => {
    expect(routeSource).toContain("LEFT JOIN opening_bal ob    ${f.accountId ? sql`ON TRUE` : sql`ON ob.account_id = el.account_id`}");
    expect(routeSource).toContain("${f.accountId ? sql`` : sql`PARTITION BY el.account_id`}");
    expect(routeSource).toContain("${f.accountId ? sql`` : sql`GROUP BY el.account_id`}");
  });
});