/**
 * Browser JSON serializes Date values to milliseconds, while PostgreSQL
 * timestamps can retain microseconds. Use the serialized millisecond as a
 * half-open database range so an unchanged legacy row can still be updated.
 */
export function getVendorProfileVersionBounds(serializedVersion: string): {
  start: Date;
  end: Date;
} | null {
  const start = new Date(serializedVersion);
  if (Number.isNaN(start.getTime())) return null;

  return {
    start,
    end: new Date(start.getTime() + 1),
  };
}

export function isCurrentVendorProfileVersion(
  actualVersion: Date | null | undefined,
  expectedBounds: { start: Date; end: Date } | null,
): boolean {
  if (!actualVersion || !expectedBounds) return false;
  return actualVersion.getTime() === expectedBounds.start.getTime();
}