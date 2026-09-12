/**
 * Pure company-scope utilities shared by portal payment and reconciliation
 * guards. Keep this module free of database imports so it can be unit-tested
 * in safe mode without a test database.
 */

export function normalizeCompanyId(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

export function companyScopesMatch(left: unknown, right: unknown): boolean {
  const leftId = normalizeCompanyId(left);
  const rightId = normalizeCompanyId(right);
  return leftId != null && rightId != null && leftId === rightId;
}