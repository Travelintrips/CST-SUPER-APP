import { createHash } from "node:crypto";

export const MARKETPLACE_ACCOUNTING_HANDOFF_SOURCE = "marketplace_accounting_handoff";
export const MARKETPLACE_ACCOUNTING_HANDOFF_STATUS = "accepted" as const;

export function validateAccountingHandoffKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key.length >= 8 && key.length <= 128 ? key : null;
}

export function buildAccountingHandoffFingerprint(input: {
  apPreparationId: number;
  vendorInvoiceId: number;
  mktPurchaseOrderId: number;
  mktGoodsReceiptId: number;
  paymentRequestId: number;
  companyId: number;
  supplierId: number;
  currency: string;
  amount: string;
  approvalState: string;
  paymentLifecycleState: string;
}): string {
  const canonical = [
    input.apPreparationId,
    input.vendorInvoiceId,
    input.mktPurchaseOrderId,
    input.mktGoodsReceiptId,
    input.paymentRequestId,
    input.companyId,
    input.supplierId,
    input.currency.trim().toUpperCase(),
    input.amount,
    input.approvalState,
    input.paymentLifecycleState,
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}