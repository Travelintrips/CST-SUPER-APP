import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/modules/sport-center/routes.ts"),
  "utf8",
);
const migrationSource = readFileSync(
  resolve(process.cwd(), "src/modules/sport-center/migration.ts"),
  "utf8",
);
const invoicePageSource = readFileSync(
  resolve(process.cwd(), "../bizportal/src/pages/sport-center/company-invoices.tsx"),
  "utf8",
);

describe("Sport Center company PPh withholding", () => {
  it("stores PPh configuration on the corporate client and snapshots it on invoices", () => {
    expect(migrationSource).toContain("pph_withholding_enabled BOOLEAN NOT NULL DEFAULT FALSE");
    expect(migrationSource).toContain("pph_rate NUMERIC(5,2) NOT NULL DEFAULT 10");
    expect(migrationSource).toContain("pph_amount NUMERIC(14,2) NOT NULL DEFAULT 0");
    expect(migrationSource).toContain("amount_due NUMERIC(14,2) NOT NULL DEFAULT 0");
  });

  it("applies withholding only when the company flag is enabled", () => {
    const start = routeSource.indexOf('router.post("/company-invoices/generate"');
    const end = routeSource.indexOf('router.post("/company-invoices/:id/mark-paid"', start);
    const route = routeSource.slice(start, end);

    expect(route).toContain("Boolean(client.pph_withholding_enabled)");
    expect(route).toContain("const pphRate = pphEnabled ? Number(client.pph_rate ?? 10) : 0");
    expect(route).toContain("Math.round(subtotal * pphRate / 100)");
    expect(route).toContain("grandTotal - pphAmount");
    expect(route).toContain("pph_rate, pph_amount, amount_due");
  });

  it("exposes the PPh toggle and net payable amount in BizPortal", () => {
    expect(invoicePageSource).toContain("Aktifkan potongan PPh");
    expect(invoicePageSource).toContain("Potongan PPh");
    expect(invoicePageSource).toContain("Jumlah Dibayar");
    expect(invoicePageSource).toContain("amount_due");
  });
});
