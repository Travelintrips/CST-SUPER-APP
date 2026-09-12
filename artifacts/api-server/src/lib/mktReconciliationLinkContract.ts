import { createHash } from "node:crypto";

export const MARKETPLACE_RECONCILIATION_LINK_SOURCE = "marketplace_reconciliation_link";
export const MARKETPLACE_RECONCILIATION_LINK_STATUS = "created" as const;

export function validateReconciliationLinkKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key.length >= 8 && key.length <= 128 ? key : null;
}

/**
 * Fingerprint contains only server-authoritative references and financial
 * values. A client cannot change the linked payment by replaying a key.
 */
export function buildReconciliationLinkFingerprint(input: {
  accountingHandoffId: number;
  apPreparationId: number;
  paymentRequestId: number;
  companyId: number;
  supplierId: number;
  currency: string;
  amount: string;
  paymentReference: string;
  accountingReference: string;
  marketplaceReference: string;
}): string {
  const canonical = [
    input.accountingHandoffId,
    input.apPreparationId,
    input.paymentRequestId,
    input.companyId,
    input.supplierId,
    input.currency.trim().toUpperCase(),
    input.amount,
    input.paymentReference.trim(),
    input.accountingReference.trim(),
    input.marketplaceReference.trim(),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildReconciliationCorrelationReference(
  paymentRequestId: number,
  payloadFingerprint: string,
): string {
  return `MKT-RECON-${paymentRequestId}-${payloadFingerprint.slice(0, 16)}`;
}