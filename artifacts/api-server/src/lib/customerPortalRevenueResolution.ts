export type CustomerPortalRevenueMapping = {
  productScope: string | null;
  serviceScope?: string | null;
  coaId: number;
  accountCode: string;
  accountName: string;
  active: boolean;
};

/**
 * Product revenue must be selected by the stable product family discriminator.
 * There is deliberately no generic revenue fallback.
 */
export function resolveCustomerPortalRevenueMapping(
  productScope: string | null | undefined,
  mappings: CustomerPortalRevenueMapping[],
  serviceScope?: string | null,
): CustomerPortalRevenueMapping {
  if (!productScope || productScope.trim() === "") {
    throw new Error("CUSTOMER_PORTAL_PRODUCT_SCOPE_REQUIRED");
  }
  const scopedMappings = mappings.filter((mapping) =>
    mapping.active && mapping.productScope === productScope,
  );
  if (scopedMappings.length === 0) {
    throw new Error(`CUSTOMER_PORTAL_REVENUE_MAPPING_MISSING: ${productScope}`);
  }
  if (productScope === "jasa" && !String(serviceScope ?? "").trim()) {
    throw new Error("CUSTOMER_PORTAL_SERVICE_SCOPE_REQUIRED");
  }
  const matches = scopedMappings.filter((mapping) =>
    productScope !== "jasa" ||
    mapping.serviceScope === String(serviceScope ?? "").trim().toLowerCase(),
  );
  if (matches.length === 0) {
    throw new Error(`CUSTOMER_PORTAL_REVENUE_MAPPING_MISSING: ${productScope}:${serviceScope}`);
  }
  if (matches.length > 1) {
    throw new Error(`CUSTOMER_PORTAL_REVENUE_MAPPING_AMBIGUOUS: ${productScope}`);
  }
  return matches[0];
}