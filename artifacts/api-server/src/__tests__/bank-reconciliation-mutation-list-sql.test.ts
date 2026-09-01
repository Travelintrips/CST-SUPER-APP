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
});