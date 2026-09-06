import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), "src", relativePath), "utf8");
}

function reversalRequest(page: string): string {
  const endpoint = page.indexOf("/api/accounting/entries/");
  const reverse = page.indexOf("/reverse", endpoint);
  expect(endpoint).toBeGreaterThanOrEqual(0);
  expect(reverse).toBeGreaterThan(endpoint);
  return page.slice(endpoint, reverse + "/reverse".length + 700);
}

describe("journal reversal callers preserve company context", () => {
  it("Journal Entries sends the active company for a non-consolidated reversal", () => {
    const page = source("pages/accounting/entries.tsx");
    expect(reversalRequest(page)).toContain("companyId");
    expect(page).toContain("companyId={isConsolidated ? null : activeCompanyId}");
  });

  it("General Ledger sends the company belonging to the selected row", () => {
    const page = source("pages/accounting/hub/general-ledger.tsx");
    expect(reversalRequest(page)).toContain("companyId: voidDialog.companyId");
    expect(page).toContain("companyId: row.company_id");
  });

  it("Closing Wizard sends its active company context", () => {
    const page = source("pages/accounting/closing-wizard.tsx");
    expect(reversalRequest(page)).toContain("companyId: activeCompanyId");
  });
});