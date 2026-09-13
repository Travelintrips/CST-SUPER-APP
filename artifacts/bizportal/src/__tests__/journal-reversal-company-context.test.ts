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

  it("COA correction creates the draft before reversal and keeps it when reversal fails", () => {
    const page = source("pages/accounting/entries.tsx");
    const draft = page.indexOf('fetch("/api/accounting/entries"');
    const reverse = page.indexOf("/reverse", draft);

    expect(draft).toBeGreaterThanOrEqual(0);
    expect(reverse).toBeGreaterThan(draft);
    expect(page.slice(draft, reverse)).toContain("draftResponse");
    expect(page.slice(draft, reverse)).toContain("companyId");
    expect(page.slice(reverse)).toContain("Draft koreksi sudah dibuat, tetapi reversal gagal");
    expect(page.slice(draft, reverse + 2000)).not.toContain("deleteEntry");
    expect(page.slice(reverse, reverse + 900)).toContain("companyId");
  });

  it("COA correction reports a successful reversal while leaving the correction draft for review", () => {
    const page = source("pages/accounting/entries.tsx");
    const correction = page.slice(
      page.indexOf("if (mode === \"edit\")"),
      page.indexOf("onOpenChange(false)"),
    );

    expect(correction).toContain("draftResponse.ok");
    expect(correction).toContain("reversalResponse.ok");
    expect(correction).toContain("Reversal dibuat dan draft koreksi siap");
    expect(correction).toContain("Periksa kembali COA lalu klik Post");
  });
});