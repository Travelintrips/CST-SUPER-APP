import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve(process.cwd(), "src/pages/accounting/bank-reconciliation.tsx"),
  "utf8",
);

describe("cash account mutation view", () => {
  it("requests the selected account together with the active company and date filters", () => {
    expect(pageSource).toContain(
      'queryKey: ["cash-account-mutations", activeCompanyId, accountId, from, to]',
    );
    expect(pageSource).toContain("account_id: accountId");
    expect(pageSource).toContain('if (from) params.set("from", from);');
    expect(pageSource).toContain('if (to) params.set("to", to);');
  });

  it("maps debit to Masuk and credit to Keluar consistently in totals and rows", () => {
    expect(pageSource).toContain(
      "const totalIn = rows.reduce((sum, row) => sum + Number(row.debit ?? 0), 0);",
    );
    expect(pageSource).toContain(
      "const totalOut = rows.reduce((sum, row) => sum + Number(row.credit ?? 0), 0);",
    );
    expect(pageSource).toContain('<TableHead className="text-right">Masuk</TableHead>');
    expect(pageSource).toContain('<TableHead className="text-right">Keluar</TableHead>');
    expect(pageSource).toContain(
      '{Number(row.debit ?? 0) > 0 ? `Rp ${formatAmount(Number(row.debit))}` : "—"}',
    );
    expect(pageSource).toContain(
      '{Number(row.credit ?? 0) > 0 ? `Rp ${formatAmount(Number(row.credit))}` : "—"}',
    );
  });

  it("documents that draft transfers stay out until accounting posting", () => {
    expect(pageSource).toContain(
      "Transfer yang masih berstatus draft akan muncul setelah proses <strong>Post ke Accounting</strong>.",
    );
  });
});