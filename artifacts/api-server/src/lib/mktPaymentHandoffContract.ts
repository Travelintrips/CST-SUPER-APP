import { createHash } from "node:crypto";

export const MARKETPLACE_AP_HANDOFF_SOURCE = "marketplace_ap_preparation";

export function validatePaymentHandoffIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key.length >= 8 && key.length <= 128 ? key : null;
}

/**
 * The fingerprint is built only from server-authoritative AP values. A client
 * cannot change the amount, currency, company, supplier, or invoice by
 * replaying an idempotency key.
 */
export function buildPaymentHandoffFingerprint(input: {
  apPreparationId: number;
  companyId: number | null;
  supplierId: number;
  vendorInvoiceId: number;
  currency: string;
  grandTotal: string;
}): string {
  const canonical = [
    input.apPreparationId,
    input.companyId ?? "",
    input.supplierId,
    input.vendorInvoiceId,
    input.currency.trim().toUpperCase(),
    input.grandTotal,
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}