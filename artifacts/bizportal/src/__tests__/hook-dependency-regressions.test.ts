import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), "src", relativePath), "utf8");
}

describe("hook dependency request boundaries", () => {
  it("keeps the route distance callback stable across unrelated editor renders", () => {
    const editor = source("pages/logistics-freight-editor.tsx");
    const preview = source("components/ui/route-map-preview.tsx");

    expect(editor).toMatch(/const handleDistanceFetched = useCallback\(/);
    expect(editor).toMatch(/onDistanceFetched=\{handleDistanceFetched\}/);
    expect(preview).toMatch(/\[origin, destination, isReady, onDistanceFetched\]/);
  });

  it("uses submitted search state instead of fetching on every keystroke", () => {
    const serviceRequests = source("pages/service-requests.tsx");

    expect(serviceRequests).toMatch(/const \[submittedSearch, setSubmittedSearch\]/);
    expect(serviceRequests).toMatch(/params\.set\("search", searchTerm\)/);
    expect(serviceRequests).toMatch(/setSubmittedSearch\(search\)/);
  });

  it("keeps bank reconciliation filters applied until Tampilkan is pressed", () => {
    const bankRecon = source("pages/accounting/bank-recon.tsx");

    expect(bankRecon).toMatch(/const \[appliedFilters, setAppliedFilters\]/);
    expect(bankRecon).toMatch(/appliedFilters\.dateFrom/);
    expect(bankRecon).toMatch(/setAppliedFilters\(\{ dateFrom, dateTo, statusFilter \}\)/);
    expect(bankRecon).toMatch(/setRefreshKey\(key => key \+ 1\)/);
  });

  it("cleans up route distance requests after the debounce fires", () => {
    const preview = source("components/ui/route-map-preview.tsx");

    expect(preview).toMatch(/controller\?\.abort\(\)/);
    expect(preview).toMatch(/let active = true/);
    expect(preview).toMatch(/if \(!active\) return/);
  });

  it.each([
    ["balance sheet", "pages/accounting/hub/balance-sheet.tsx", "appliedFilters"],
    ["profit and loss", "pages/accounting/hub/profit-loss.tsx", "appliedFilters"],
    ["hub dashboard", "pages/accounting/hub/index.tsx", "appliedDateRange"],
    ["general ledger", "pages/accounting/hub/general-ledger.tsx", "appliedFilters"],
    ["payments", "pages/accounting/hub/payments.tsx", "appliedFilters"],
    ["posting errors", "pages/accounting/hub/posting-errors.tsx", "appliedFilters"],
    ["COA mapping", "pages/accounting/hub/coa-mapping.tsx", "appliedCompanyId"],
  ])("keeps %s requests bound to applied filters", (_label, path, appliedState) => {
    const page = source(path);

    expect(page).toContain(appliedState);
    expect(page).toMatch(/Terapkan/);
  });
});