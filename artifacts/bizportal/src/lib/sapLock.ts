/**
 * SAP INVOICE LOCK — Frontend Financial Guard
 *
 * Enforces SAP-grade rule: ALL financial values must originate from the
 * backend invoice header. Frontend MUST NOT perform arithmetic on invoice data.
 *
 * Rules:
 *  - allowCalculation = false → no reduce(), sum(), calculateTotal() on invoice items
 *  - sourceOfTruth = "backend" → always use invoice.header.{net, vat, gross}
 *
 * Usage:
 *  import { SAP_LOCK, assertSapLock } from "@/lib/sapLock";
 *
 *  if (SAP_LOCK.allowCalculation) {
 *    // This block must NEVER be reached in production
 *  }
 *
 *  // Use in guards before any financial display:
 *  assertSapLock("subtotal"); // throws in dev if called improperly
 */

export const SAP_LOCK = {
  /** Frontend financial calculation is ALWAYS disabled. */
  allowCalculation: false,

  /** The canonical source for all invoice financial values. */
  sourceOfTruth: "backend" as const,

  /** Human-readable label for log/UI messages. */
  label: "SAP LOCK ACTIVE - FRONTEND CALCULATION DISABLED",
} as const;

/**
 * Log a SAP Lock warning to the console.
 * Call this whenever a computed value would have been used but was blocked.
 */
export function sapLockWarn(context: string, detail?: Record<string, unknown>): void {
  console.warn(`[${SAP_LOCK.label}] ${context}`, detail ?? "");
}

/**
 * Assert that a value was NOT derived by frontend calculation.
 * In development, throws if `value` is undefined/null AND no backend value was provided.
 *
 * @param field  - Field name for the error message (e.g. "grandTotal")
 * @param value  - The backend-provided value (null/undefined triggers the warning)
 */
export function assertSapSource(field: string, value: number | null | undefined): void {
  if (value == null) {
    sapLockWarn(`${field} is null/undefined — backend did not provide this value. Display "—", do NOT compute.`);
  }
}
