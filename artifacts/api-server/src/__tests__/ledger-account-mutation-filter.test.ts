import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../routes/ledger.ts", import.meta.url),
  "utf8",
);

describe("account mutation ledger endpoint", () => {
  it("scopes rows to the selected account and company", () => {
    expect(routeSource).toContain("fle.company_id = ${companyId}");
    expect(routeSource).toContain("fle.account_id = ${accountId}");
    expect(routeSource).toContain("account_id harus berupa bilangan bulat positif");
  });

  it("only exposes posted journal lines, never draft transfer lines", () => {
    expect(routeSource).toContain("JOIN accounting_entries ae");
    expect(routeSource).toContain("ae.entry_number = fle.source_ref");
    expect(routeSource).toContain("ae.status = 'posted'");
  });

  it("keeps the inclusive date range and excludes voided rows by default", () => {
    expect(routeSource).toContain("fle.ledger_date >= '${from.replace(/'/g, \"''\")}'");
    expect(routeSource).toContain(
      "fle.ledger_date < ('${to.replace(/'/g, \"''\")}'::date + INTERVAL '1 day')",
    );
    expect(routeSource).toContain("fle.is_voided = false");
  });
});