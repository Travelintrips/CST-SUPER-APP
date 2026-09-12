import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(
  new URL("../routes/portal.ts", import.meta.url),
  "utf8",
);

describe("Customer Portal invoice ownership", () => {
  it("uses canonical originating-order or active-company ownership", () => {
    expect(routeSource).toContain('router.get("/me/invoices", requireCustomerPortalAuth');
    expect(routeSource).toContain("owner_order.portal_customer_id = ${customerId}");
    expect(routeSource).toContain("FROM portal_company_members pcm");
    expect(routeSource).toContain("pcm.is_active = TRUE");
  });

  it("does not authorize invoices by mutable customer display name", () => {
    expect(routeSource).not.toContain("LOWER(customer_name)");
    expect(routeSource).not.toContain("SELECT name FROM portal_customers");
    expect(routeSource).not.toContain("LOWER(customer_name) = LOWER");
  });

  it("returns canonical invoice and payment fields", () => {
    expect(routeSource).toContain('COALESCE(sd.invoice_number, sd.doc_number) AS "invoiceNumber"');
    expect(routeSource).toContain('sd.payment_status AS status');
    expect(routeSource).toContain('sd.amount_paid AS "amountPaid"');
  });
});