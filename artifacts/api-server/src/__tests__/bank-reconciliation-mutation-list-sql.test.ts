import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../routes/bankReconciliation.ts", import.meta.url),
  "utf8",
);

describe("bank reconciliation mutation list SQL", () => {
  it("normalizes the text bank account identity before joining the integer account id", () => {
    expect(routeSource).toContain(
      "cba.id::text = BTRIM(bm.bank_account_id::text)",
    );
    expect(routeSource).not.toContain(
      "company_bank_accounts cba ON cba.id = bm.bank_account_id",
    );
  });

  it("projects approved-match ownership independently of visible candidates", () => {
    expect(routeSource).toContain("FROM bank_reconciliation_matches approved_mutation_match");
    expect(routeSource).toContain("approved_mutation_match.mutation_id = bm.id");
    expect(routeSource).toContain("approved_mutation_match.status = 'approved'");
    expect(routeSource).toContain("AS has_approved_match");
    expect(routeSource).toContain("FALSE AS has_approved_match");
  });

  it("projects a posted journal as posted even if the bank mutation status is stale", () => {
    expect(routeSource).toContain(
      "FROM accounting_entries posted_journal",
    );
    expect(routeSource).toContain(
      "posted_journal.status = 'posted'",
    );
    expect(routeSource).toContain("THEN 'posted'");
  });

  it("projects a voided or reversed journal as void instead of draft", () => {
    expect(routeSource).toContain(
      "FROM accounting_entries voided_journal",
    );
    expect(routeSource).toContain(
      "voided_journal.status IN ('voided', 'reversed')",
    );
    expect(routeSource).toContain("THEN 'void'");
  });
});