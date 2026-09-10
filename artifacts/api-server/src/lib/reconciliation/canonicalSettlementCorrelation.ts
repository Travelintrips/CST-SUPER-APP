/**
 * Canonical settlement batches may have a late-arrival supplemental suffix,
 * but that suffix must not create a second reconciliation identity.
 *
 * This helper is deliberately fail-closed: an unknown `:supp:` shape is not
 * normalized because guessing could merge two unrelated settlement groups.
 */
export function normalizeCanonicalSettlementCorrelationRoot(
  correlationId: unknown,
): string | null {
  if (typeof correlationId !== "string") return null;
  const value = correlationId.trim();
  if (!value) return null;

  const supplementalMarker = value.indexOf(":supp:");
  if (supplementalMarker >= 0) {
    if ((value.match(/:supp:/gi) ?? []).length !== 1) return null;
    if (!/:supp:[0-9]+$/i.test(value)) return null;
    const root = value.slice(0, supplementalMarker).trim();
    return root && !root.includes(":supp:") ? root : null;
  }

  return value.includes(":") && value.endsWith(":supp")
    ? null
    : value;
}
