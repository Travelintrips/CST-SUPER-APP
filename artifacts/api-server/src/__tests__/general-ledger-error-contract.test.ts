import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/routes/accountingHub.ts"),
  "utf8",
);
const route = source.slice(
  source.indexOf('router.get("/hub/general-ledger"'),
  source.indexOf('// ── GET /api/accounting/hub/trial-balance'),
);

describe("General Ledger database failure contract", () => {
  it("retries a transient pool checkout timeout once", () => {
    expect(source).toContain("async function executeGeneralLedgerQuery");
    expect(source).toContain("isDatabaseCheckoutTimeout(error)");
    expect(source).toContain("retrying once");
    expect(source).toContain("return db.execute<T>(query)");
  });

  it("does not expose raw SQL errors to the browser", () => {
    expect(route).toContain('res.status(poolBusy ? 503 : 500).json({');
    expect(route).toContain('"Database sedang sibuk. Silakan coba lagi."');
    expect(route).toContain('"Gagal memuat Buku Besar."');
    expect(route).not.toContain('res.status(500).json({ error: err?.message });');
  });

  it("uses the guarded executor for every General Ledger query", () => {
    expect(route.match(/executeGeneralLedgerQuery<any>/g)).toHaveLength(5);
    expect(route).not.toContain("await db.execute<any>");
  });
});