import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(): string {
  return readFileSync(
    resolve(process.cwd(), "src/pages/accounting/hub/general-ledger.tsx"),
    "utf8",
  );
}

describe("General Ledger company scope", () => {
  it("inherits the active company unless the URL explicitly chooses a scope", () => {
    const page = source();

    expect(page).toContain('import { useCompany } from "@/contexts/CompanyContext";');
    expect(page).toContain("const urlHasCompanyFilter = urlParams.has(\"company_id\");");
    expect(page).toContain("const contextCompanyId");
    expect(page).toContain("if (!urlHasCompanyFilter && isCompanyLoading) return;");
    expect(page).toContain("appliedFilters.company_id !== contextCompanyId");
  });

  it("renders the selected company instead of a hard-coded multi-company label", () => {
    const page = source();

    expect(page).toContain("const scopeLabel = appliedFilters.company_id");
    expect(page).toContain("{scopeLabel} · {total.toLocaleString(\"id-ID\")} baris");
    expect(page).not.toContain(
      'Multi-perusahaan · {total.toLocaleString("id-ID")} baris',
    );
  });
});