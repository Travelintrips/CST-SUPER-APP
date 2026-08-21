export type CustomerPortalTaxMapping = {
  productScope: string | null;
  taxRuleId: number;
  mappingId: number;
  active: boolean;
};

/**
 * Resolve only an exact product scope. No display-name or global fallback is
 * allowed because Customer Portal has independent product tax families.
 */
export function resolveCustomerPortalTaxMapping(
  productScope: string | null | undefined,
  mappings: CustomerPortalTaxMapping[],
): CustomerPortalTaxMapping {
  if (!productScope || productScope.trim() === "") {
    throw new Error("CUSTOMER_PORTAL_PRODUCT_SCOPE_REQUIRED");
  }
  const matches = mappings.filter((mapping) =>
    mapping.active && mapping.productScope === productScope,
  );
  if (matches.length === 0) {
    throw new Error(`CUSTOMER_PORTAL_TAX_MAPPING_MISSING: ${productScope}`);
  }
  if (matches.length > 1) {
    throw new Error(`CUSTOMER_PORTAL_TAX_MAPPING_AMBIGUOUS: ${productScope}`);
  }
  return matches[0];
}