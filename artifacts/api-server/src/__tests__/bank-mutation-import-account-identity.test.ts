import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/bankMutationImport.ts"),
  "utf8",
);

describe("bank mutation import account identity", () => {
  it("resolves source evidence against active company accounts and persists the resolved ID", () => {
    expect(routeSource).toContain("resolveActiveBankAccountId");
    expect(routeSource).toContain("FROM company_bank_accounts");
    expect(routeSource).toContain("AND is_active = TRUE");
    expect(routeSource).toContain("bank_account_id, source_account");
    expect(routeSource).toContain("resolvedBankAccountId === null");
  });

  it("carries import-row account identity into every bank mutation insertion path", () => {
    const insertions = routeSource.match(/INSERT INTO bank_mutations/g) ?? [];
    expect(insertions).toHaveLength(3);
    expect(routeSource).toContain("ne.bank_account_id ?? 'NULL'");
    expect(routeSource).toContain("row.bank_account_id ?? \"NULL\"");
  });
});