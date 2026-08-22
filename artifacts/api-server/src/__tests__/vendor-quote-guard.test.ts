/**
 * Focused vendor quote route regression.
 *
 * This is intentionally a source/route contract test: TEST_DATABASE_URL is not
 * required, and the test must never fall back to DEV or PROD databases.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const routeSource = readFileSync(
  new URL("../routes/portal.ts", import.meta.url),
  "utf8",
);
const authSource = readFileSync(
  new URL("../lib/supabaseAuth.ts", import.meta.url),
  "utf8",
);
const quoteServiceSource = readFileSync(
  new URL("../lib/services/portalLogisticOrderService.ts", import.meta.url),
  "utf8",
);

describe("POST /api/portal/vendor/quotes guard contract", () => {
  it("requires portal authentication, then an active vendor", () => {
    expect(routeSource).toMatch(
      /router\.post\("\/vendor\/quotes",\s*requirePortalAuth,\s*requireActiveVendor,/,
    );
  });

  it("blocks unauthenticated users before the handler", () => {
    expect(routeSource).toMatch(
      /router\.post\("\/vendor\/quotes",\s*requirePortalAuth,/,
    );
  });

  it("blocks authenticated non-vendor accounts", () => {
    expect(authSource).toMatch(
      /portalRole !== "vendor"[\s\S]*?res\.status\(403\)\.json\(\{\s*message: "Akses vendor diperlukan"/,
    );
  });

  it("blocks inactive vendors and allows active vendors through", () => {
    expect(authSource).toMatch(
      /up\?\.status !== "active"[\s\S]*?res\.status\(403\)/,
    );
    expect(authSource).toMatch(/up\?\.status !== "active"[\s\S]*?next\(\);/);
  });

  it("preserves supplier ownership, open-RFQ validation, and quote upsert behavior", () => {
    expect(quoteServiceSource).toMatch(/if \(!linkedSupplier\)/);
    expect(quoteServiceSource).toMatch(
      /rfq\.vendorIds as number\[\]\)\.includes\(linkedSupplier\.id\)/,
    );
    expect(quoteServiceSource).toMatch(/if \(rfq\.status !== "open"\)/);
    expect(quoteServiceSource).toMatch(/if \(existing\)/);
    expect(quoteServiceSource).toMatch(/quoteStatus: "pending"/);
  });
});