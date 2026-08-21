import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { toCustomerPortalFinanceIntake } from "../lib/customerPortalFinanceAdapter.js";
import { resolveCustomerPortalTaxMapping } from "../lib/customerPortalTaxResolution.js";

const migrationSource = readFileSync(
  new URL("../lib/customerPortalProductTaxMigration.ts", import.meta.url),
  "utf8",
);
const adapterSource = readFileSync(
  new URL("../lib/customerPortalFinanceAdapter.ts", import.meta.url),
  "utf8",
);

const event = {
  source_project: "customer_portal",
  source_payment_id: 42,
  event_type: "payment_confirmed",
  correlation_id: "customer_portal:payment:42:payment_confirmed",
  company_id: 1,
  sales_document_id: 7,
  order_id: null,
  amount: "100.00",
  currency: "idr",
  payment_method: "qris",
  payment_provider: "paylabs",
  provider_reference: "sandbox-ref",
  paid_at: "2026-08-21T00:00:00.000Z",
  confirmed_at: "2026-08-21T00:00:01.000Z",
  schema_version: 1,
} as const;

describe("CF-CP-4A product tax and event contract", () => {
  it("adds a nullable product discriminator without seeding mappings", () => {
    expect(migrationSource).toContain("ADD COLUMN IF NOT EXISTS product_scope TEXT");
    expect(migrationSource).toContain("product_scope IS NOT NULL");
    expect(migrationSource).not.toContain("INSERT INTO finance_project_tax_mappings");
  });

  it("translates a valid event without finance side effects", () => {
    expect(toCustomerPortalFinanceIntake(event)).toMatchObject({
      sourceProject: "customer_portal",
      sourcePaymentId: 42,
      eventType: "payment_confirmed",
      companyId: 1,
      currency: "IDR",
    });
    expect(adapterSource).not.toContain("INSERT");
    expect(adapterSource).not.toContain("UPDATE");
    expect(adapterSource).not.toContain("from \"@workspace/db\"");
    expect(adapterSource).not.toContain("processCentralFinance");
  });

  it("fails closed for foreign source, wrong event, and invalid company", () => {
    expect(() => toCustomerPortalFinanceIntake({ ...event, source_project: "sport_center" })).toThrow("SOURCE_MISMATCH");
    expect(() => toCustomerPortalFinanceIntake({ ...event, event_type: "refund" })).toThrow("TYPE_UNSUPPORTED");
    expect(() => toCustomerPortalFinanceIntake({ ...event, company_id: 0 })).toThrow("COMPANY_INVALID");
  });

  it("fails closed for unknown, missing, and ambiguous product tax scopes", () => {
    const mapping = [{ productScope: "barang", taxRuleId: 1, mappingId: 10, active: true }];
    expect(() => resolveCustomerPortalTaxMapping(null, mapping)).toThrow("PRODUCT_SCOPE_REQUIRED");
    expect(() => resolveCustomerPortalTaxMapping("jasa", mapping)).toThrow("TAX_MAPPING_MISSING");
    expect(() => resolveCustomerPortalTaxMapping("barang", [
      ...mapping,
      { productScope: "barang", taxRuleId: 7, mappingId: 11, active: true },
    ])).toThrow("TAX_MAPPING_AMBIGUOUS");
    expect(resolveCustomerPortalTaxMapping("barang", mapping).taxRuleId).toBe(1);
  });
});