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
    expect(routeSource).toContain(
      "EXISTS (\n" +
        "        SELECT 1\n" +
        "        FROM bank_reconciliation_matches approved_mutation_match\n" +
        "        WHERE approved_mutation_match.mutation_id = bm.id\n" +
        "          AND approved_mutation_match.status = 'approved'\n" +
        "      ) AS has_approved_match",
    );
    expect(routeSource).toContain("FALSE AS has_approved_match");
  });
});