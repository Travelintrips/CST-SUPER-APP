export type CustomerPortalProductScope = "goods" | "jasa";

export type CustomerPortalTaxSnapshot = {
  taxRuleId: number;
  rate: number;
  treatment: "exclusive";
  productScope: CustomerPortalProductScope;
};

export function normalizeCustomerPortalProductScope(value: unknown): CustomerPortalProductScope {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "barang" || normalized === "product" || normalized === "goods") return "goods";
  if (normalized === "jasa" || normalized === "service") return "jasa";
  throw new Error("CUSTOMER_PORTAL_PRODUCT_SCOPE_INVALID");
}

export function calculateCustomerPortalExclusiveTax(
  subtotal: number,
  snapshot: Pick<CustomerPortalTaxSnapshot, "rate">,
): { taxAmount: number; grandTotal: number } {
  if (!Number.isFinite(subtotal) || subtotal < 0) throw new Error("CUSTOMER_PORTAL_SUBTOTAL_INVALID");
  if (!Number.isFinite(snapshot.rate) || snapshot.rate < 0) throw new Error("CUSTOMER_PORTAL_TAX_RATE_INVALID");
  const taxAmount = Math.round(subtotal * snapshot.rate * 100) / 100;
  return { taxAmount, grandTotal: Math.round((subtotal + taxAmount) * 100) / 100 };
}

export function assertCustomerPortalServiceScope(
  productScope: CustomerPortalProductScope,
  serviceScope: string | null | undefined,
): string | null {
  if (productScope === "goods") return null;
  const value = String(serviceScope ?? "").trim().toLowerCase();
  if (!value) throw new Error("CUSTOMER_PORTAL_SERVICE_SCOPE_REQUIRED");
  return value;
}