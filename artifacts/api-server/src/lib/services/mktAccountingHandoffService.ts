import {
  db,
  mktAccountingHandoffsTable,
  mktApPreparationsTable,
  mktPoGoodsReceiptsTable,
  mktPurchaseOrdersTable,
  paymentRequestsTable,
  suppliersTable,
  vendorInvoicesTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";
import {
  buildAccountingHandoffFingerprint,
  MARKETPLACE_ACCOUNTING_HANDOFF_SOURCE,
  MARKETPLACE_ACCOUNTING_HANDOFF_STATUS,
  validateAccountingHandoffKey,
} from "../mktAccountingHandoffContract.js";

type Actor = { actorId?: string | null; actorName?: string | null };
type HandoffRow = typeof mktAccountingHandoffsTable.$inferSelect;

export type AccountingHandoffFailureCode =
  | "NOT_FOUND"
  | "INVALID_KEY"
  | "INVALID_SOURCE"
  | "INVALID_STATUS"
  | "INVALID_REFERENCE"
  | "COMPANY_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "CONCURRENT_UPDATE";

export type AccountingHandoffResult =
  | {
      ok: true;
      handoff: HandoffRow;
      alreadyExists: boolean;
    }
  | {
      ok: false;
      code: AccountingHandoffFailureCode;
      message?: string;
      currentStatus?: string | null;
    };

function isDuplicateError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "23505";
}

function failureMessage(code: AccountingHandoffFailureCode): string {
  switch (code) {
    case "INVALID_SOURCE": return "Payment bukan berasal dari Marketplace AP";
    case "INVALID_STATUS": return "Payment Marketplace harus berstatus paid dan lifecycle completed";
    case "INVALID_REFERENCE": return "Referensi AP, invoice, PO, GR, supplier, atau payment tidak konsisten";
    case "COMPANY_MISMATCH": return "Company context tidak sesuai dengan AP Marketplace";
    case "AMOUNT_MISMATCH": return "Amount payment berbeda dari AP authoritative amount";
    case "CURRENCY_MISMATCH": return "Currency payment berbeda dari AP authoritative currency";
    case "IDEMPOTENCY_CONFLICT": return "Idempotency key sudah dipakai untuk handoff berbeda";
    default: return "Accounting handoff tidak dapat diproses";
  }
}

function queueHandoffNotification(
  handoff: HandoffRow | null,
  eventType: "marketplace_accounting_handoff_accepted" | "marketplace_accounting_handoff_failed" | "marketplace_accounting_handoff_retry_required",
  payload: Record<string, unknown>,
  deduplicationKey: string,
): void {
  void enqueueNotification({
    eventType,
    recipientType: "admin",
    purchaseOrderId: handoff?.mktPurchaseOrderId ?? Number(payload.mktPurchaseOrderId),
    payloadJson: {
      source: MARKETPLACE_ACCOUNTING_HANDOFF_SOURCE,
      ...payload,
    },
    deduplicationKey,
  }).catch(() => {});
}

async function auditFailure(
  apPreparationId: number,
  mktPurchaseOrderId: number | null,
  actor: Actor,
  handoffKey: string | null,
  code: AccountingHandoffFailureCode,
  message: string,
): Promise<void> {
  await logActivity({
    mktPurchaseOrderId,
    actorType: "admin",
    actorId: actor.actorId ?? null,
    actorName: actor.actorName ?? null,
    action: "marketplace_accounting_handoff_failed",
    description: `AP preparation ${apPreparationId}: ${message}`,
    newValue: { apPreparationId, code, message },
    deduplicationKey: handoffKey
      ? `mkt_accounting_handoff_failed:${apPreparationId}:${handoffKey}:${code}`
      : null,
  });
}

export async function getMarketplaceAccountingHandoff(
  apPreparationId: number,
): Promise<HandoffRow | null> {
  const [row] = await db
    .select()
    .from(mktAccountingHandoffsTable)
    .where(eq(mktAccountingHandoffsTable.apPreparationId, apPreparationId))
    .orderBy(desc(mktAccountingHandoffsTable.id))
    .limit(1);
  return row ?? null;
}

/**
 * Creates or reuses the Marketplace -> Accounting boundary record.
 *
 * This function deliberately never imports or calls a posting engine and never
 * writes accounting_payments, accounting_entries, journal lines, or COA data.
 */
export async function handoffMarketplacePaymentToAccounting(
  paymentRequestId: number,
  idempotencyKeyInput: unknown,
  actor: Actor,
  expectedCompanyId?: number | null,
): Promise<AccountingHandoffResult> {
  const idempotencyKey = validateAccountingHandoffKey(idempotencyKeyInput);
  if (!idempotencyKey) {
    return { ok: false, code: "INVALID_KEY", message: "Idempotency-Key wajib 8-128 karakter" };
  }

  let result: AccountingHandoffResult;
  let failureContext: { apPreparationId: number; mktPurchaseOrderId: number | null } | null = null;
  try {
    result = await db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(paymentRequestsTable)
        .where(eq(paymentRequestsTable.id, paymentRequestId))
        .for("update")
        .limit(1);
      if (!payment) return { ok: false as const, code: "NOT_FOUND" as const };

      const apId = payment.mktApPreparationId;
      if (apId == null) {
        return { ok: false as const, code: "INVALID_SOURCE" as const };
      }

      const [preparation] = await tx
        .select()
        .from(mktApPreparationsTable)
        .where(eq(mktApPreparationsTable.id, apId))
        .for("update")
        .limit(1);
      failureContext = {
        apPreparationId: apId,
        mktPurchaseOrderId: preparation?.mktPurchaseOrderId ?? null,
      };
      if (!preparation) return { ok: false as const, code: "INVALID_REFERENCE" as const };

      if (expectedCompanyId != null && preparation.companyId !== expectedCompanyId) {
        return { ok: false as const, code: "COMPANY_MISMATCH" as const };
      }
      if (preparation.companyId == null || payment.companyId !== preparation.companyId) {
        return { ok: false as const, code: "COMPANY_MISMATCH" as const };
      }
      if (payment.sourceType !== "marketplace_ap_preparation"
        || payment.sourceId !== preparation.id
        || payment.mktApPreparationId !== preparation.id
        || payment.idempotencyKey !== idempotencyKey) {
        return { ok: false as const, code: "INVALID_SOURCE" as const };
      }
      if (preparation.status !== "waiting_payment") {
        return {
          ok: false as const,
          code: "INVALID_STATUS" as const,
          currentStatus: preparation.status,
        };
      }
      if (payment.status === "cancelled" || payment.mktLifecycleStatus !== "completed" || payment.status !== "paid") {
        return {
          ok: false as const,
          code: "INVALID_STATUS" as const,
          currentStatus: payment.mktLifecycleStatus,
        };
      }

      const [invoice] = await tx
        .select()
        .from(vendorInvoicesTable)
        .where(eq(vendorInvoicesTable.id, preparation.vendorInvoiceId))
        .limit(1);
      const [po] = await tx
        .select()
        .from(mktPurchaseOrdersTable)
        .where(eq(mktPurchaseOrdersTable.id, preparation.mktPurchaseOrderId))
        .limit(1);
      const [gr] = await tx
        .select()
        .from(mktPoGoodsReceiptsTable)
        .where(eq(mktPoGoodsReceiptsTable.id, preparation.mktGoodsReceiptId))
        .limit(1);
      const [supplier] = await tx
        .select()
        .from(suppliersTable)
        .where(eq(suppliersTable.id, preparation.supplierId))
        .limit(1);

      if (!invoice || !po || !gr || !supplier
        || invoice.id !== preparation.vendorInvoiceId
        || invoice.mktPurchaseOrderId !== preparation.mktPurchaseOrderId
        || invoice.mktGoodsReceiptId !== preparation.mktGoodsReceiptId
        || invoice.supplierId !== preparation.supplierId
        || invoice.companyId !== preparation.companyId
        || po.vendorId !== preparation.supplierId
        || po.companyId !== preparation.companyId
        || !supplier.isActive
        || supplier.status === "suspended"
        || supplier.status === "blacklisted") {
        return { ok: false as const, code: "INVALID_REFERENCE" as const };
      }
      if (String(payment.totalAmount) !== String(preparation.grandTotalSnapshot)) {
        return { ok: false as const, code: "AMOUNT_MISMATCH" as const };
      }
      if (String(payment.currency).trim().toUpperCase() !== String(preparation.currencySnapshot).trim().toUpperCase()) {
        return { ok: false as const, code: "CURRENCY_MISMATCH" as const };
      }

      const approvalState = payment.mktApprovedAt != null ? "approved" : "not_approved";
      const paymentLifecycleState = String(payment.mktLifecycleStatus);
      const payload = {
        source: MARKETPLACE_ACCOUNTING_HANDOFF_SOURCE,
        apPreparationId: preparation.id,
        preparationNumber: preparation.preparationNumber,
        vendorInvoiceId: invoice.id,
        vendorInvoiceNumber: invoice.invoiceNumber,
        mktPurchaseOrderId: po.id,
        poNumber: po.poNumber,
        mktGoodsReceiptId: gr.id,
        receiptNumber: gr.receiptNumber,
        paymentRequestId: payment.id,
        payReqNumber: payment.payReqNumber,
        companyId: preparation.companyId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        currency: preparation.currencySnapshot,
        amount: preparation.grandTotalSnapshot,
        approvalState,
        paymentLifecycleState,
        businessIdempotencyKey: idempotencyKey,
      };
      const payloadFingerprint = buildAccountingHandoffFingerprint({
        apPreparationId: preparation.id,
        vendorInvoiceId: invoice.id,
        mktPurchaseOrderId: po.id,
        mktGoodsReceiptId: gr.id,
        paymentRequestId: payment.id,
        companyId: preparation.companyId,
        supplierId: supplier.id,
        currency: preparation.currencySnapshot,
        amount: preparation.grandTotalSnapshot,
        approvalState,
        paymentLifecycleState,
      });
      const correlationReference = `MKT-ACC-${payment.id}-${payloadFingerprint.slice(0, 16)}`;

      const [existing] = await tx
        .select()
        .from(mktAccountingHandoffsTable)
        .where(eq(mktAccountingHandoffsTable.apPreparationId, preparation.id))
        .for("update")
        .limit(1);
      if (existing) {
        if (existing.handoffKey !== idempotencyKey || existing.payloadFingerprint !== payloadFingerprint) {
          return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const };
        }
        return { ok: true as const, handoff: existing, alreadyExists: true };
      }

      const [sameKey] = await tx
        .select()
        .from(mktAccountingHandoffsTable)
        .where(eq(mktAccountingHandoffsTable.handoffKey, idempotencyKey))
        .limit(1);
      if (sameKey) {
        return {
          ok: false as const,
          code: "IDEMPOTENCY_CONFLICT" as const,
        };
      }

      const [created] = await tx
        .insert(mktAccountingHandoffsTable)
        .values({
          handoffKey: idempotencyKey,
          correlationReference,
          payloadFingerprint,
          apPreparationId: preparation.id,
          vendorInvoiceId: invoice.id,
          mktPurchaseOrderId: po.id,
          mktGoodsReceiptId: gr.id,
          paymentRequestId: payment.id,
          companyId: preparation.companyId,
          supplierId: supplier.id,
          currency: preparation.currencySnapshot,
          amount: preparation.grandTotalSnapshot,
          approvalState,
          paymentLifecycleState,
          status: MARKETPLACE_ACCOUNTING_HANDOFF_STATUS,
          accountingStatus: "handoff_accepted",
          payload,
          requestedBy: actor.actorId ?? null,
          acceptedAt: new Date(),
          lastResponseAt: new Date(),
        })
        .returning();
      if (!created) return { ok: false as const, code: "CONCURRENT_UPDATE" as const };
      return { ok: true as const, handoff: created, alreadyExists: false };
    });
  } catch (error) {
    if (isDuplicateError(error)) {
      result = { ok: false, code: "IDEMPOTENCY_CONFLICT", message: failureMessage("IDEMPOTENCY_CONFLICT") };
    } else {
      throw error;
    }
  }

  if (!result.ok) {
    const context = failureContext as { apPreparationId: number; mktPurchaseOrderId: number | null } | null;
    const message = result.message ?? failureMessage(result.code);
    if (context) {
      await auditFailure(
        context.apPreparationId,
        context.mktPurchaseOrderId,
        actor,
        idempotencyKey,
        result.code,
        message,
      );
      queueHandoffNotification(
        null,
        "marketplace_accounting_handoff_failed",
        {
          apPreparationId: context.apPreparationId,
          paymentRequestId,
          code: result.code,
          message,
        },
        `mkt_accounting_handoff_failed:${context.apPreparationId}:${idempotencyKey}:${result.code}`,
      );
    }
    return { ...result, message };
  }

  if (!result.alreadyExists) {
    await logActivity({
      mktPurchaseOrderId: result.handoff.mktPurchaseOrderId,
      actorType: "admin",
      actorId: actor.actorId ?? null,
      actorName: actor.actorName ?? null,
      action: "marketplace_accounting_handoff_created",
      description: `Accounting handoff ${result.handoff.correlationReference} created`,
      newValue: {
        handoffId: result.handoff.id,
        apPreparationId: result.handoff.apPreparationId,
        paymentRequestId: result.handoff.paymentRequestId,
      },
      deduplicationKey: `mkt_accounting_handoff_created:${result.handoff.id}`,
    });
    await logActivity({
      mktPurchaseOrderId: result.handoff.mktPurchaseOrderId,
      actorType: "system",
      action: "marketplace_accounting_handoff_accepted",
      description: `Accounting accepted handoff ${result.handoff.correlationReference}`,
      newValue: {
        handoffId: result.handoff.id,
        accountingStatus: result.handoff.accountingStatus,
        correlationReference: result.handoff.correlationReference,
      },
      deduplicationKey: `mkt_accounting_handoff_accepted:${result.handoff.id}`,
    });
    queueHandoffNotification(
      result.handoff,
      "marketplace_accounting_handoff_accepted",
      {
        handoffId: result.handoff.id,
        apPreparationId: result.handoff.apPreparationId,
        paymentRequestId: result.handoff.paymentRequestId,
        correlationReference: result.handoff.correlationReference,
        accountingStatus: result.handoff.accountingStatus,
      },
      `mkt_accounting_handoff_accepted:${result.handoff.id}`,
    );
  } else {
    await logActivity({
      mktPurchaseOrderId: result.handoff.mktPurchaseOrderId,
      actorType: "admin",
      actorId: actor.actorId ?? null,
      actorName: actor.actorName ?? null,
      action: "marketplace_accounting_handoff_reused",
      description: `Accounting handoff ${result.handoff.correlationReference} reused`,
      newValue: { handoffId: result.handoff.id, correlationReference: result.handoff.correlationReference },
      deduplicationKey: `mkt_accounting_handoff_reused:${result.handoff.id}:${idempotencyKey}`,
    });
  }
  return result;
}