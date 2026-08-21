import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveCustomerPortalRevenueMapping } from "../lib/customerPortalRevenueResolution.js";

const migrationSource = readFileSync(
  new URL("../lib/customerPortalProductCoaMigration.ts", import.meta.url),
  "utf8",
);

describe("CF-CP-4B product revenue COA contract", () => {
  it("adds a nullable product discriminator and adopts only proven goods COA", () => {
    expect(migrationSource).toContain("ADD COLUMN IF NOT EXISTS product_scope TEXT");
    expect(migrationSource).toContain("49121");
    expect(migrationSource).toContain("'goods'");
    expect(migrationSource).toContain("NOT EXISTS");
    expect(migrationSource).not.toContain("Paylabs");
    expect(migrationSource).not.toContain("settlement");
  });

  it("fails closed for unknown, missing, and ambiguous revenue scopes", () => {
    const goods = [{
      productScope: "goods",
      coaId: 49121,
      accountCode: "4-1015-CST",
      accountName: "Pendapatan Penjualan Barang CST",
      active: true,
    }];
    expect(() => resolveCustomerPortalRevenueMapping(null, goods))
      .toThrow("PRODUCT_SCOPE_REQUIRED");
    expect(() => resolveCustomerPortalRevenueMapping("jasa", goods))
      .toThrow("REVENUE_MAPPING_MISSING");
    expect(() => resolveCustomerPortalRevenueMapping("goods", [
      ...goods,
      { ...goods[0], coaId: 49116 },
    ])).toThrow("REVENUE_MAPPING_AMBIGUOUS");
    expect(resolveCustomerPortalRevenueMapping("goods", goods).coaId).toBe(49121);
  });
});