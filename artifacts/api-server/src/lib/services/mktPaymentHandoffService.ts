import {
  db,
  mktApPreparationsTable,
  paymentRequestsTable,
  paymentRequestItemsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";
import {
  buildPaymentHandoffFingerprint,
  MARKETPLACE_AP_HANDOFF_SOURCE,
} from "../mktPaymentHandoffContract.js";

type ApRow = typeof mktApPreparationsTable.$inferSelect;
type PaymentRequestRow = typeof paymentRequestsTable.$inferSelect;

export type PaymentHandoffFailureCode =
  | "NOT_FOUND"
  | "INVALID_STATUS"
  | "COMPANY_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "CONCURRENT_UPDATE";

export type PaymentHandoffResult =
  | {
      ok: true;
      paymentRequest: PaymentRequestRow;
      alreadyExists: boolean;
      preparation: ApRow;
    }
  | {
      ok: false;
      code: PaymentHandoffFailureCode;
      currentStatus?: ApRow["status"];
      message?: string;
    };

type Actor = { actorId?: string | null; actorName?: string | null };

function payReqNumber(apId: number): string {
  return `MKT-AP-PAY-${apId}`;
}

async function auditHandoff(
  preparation: ApRow,
  actor: Actor,
  action: string,
  paymentRequestId?: number | null,
  description?: string,
): Promise<void> {
  await logActivity({
    mktPurchaseOrderId: preparation.mktPurchaseOrderId,
    actorType: "admin",
    actorId: actor.actorId ?? null,
    actorName: actor.actorName ?? null,
    action,
    description: description ?? `${preparation.preparationNumber}: payment handoff`,
    oldValue: { apPreparationId: preparation.id, status: preparation.status },
    newValue: { apPreparationId: preparation.id, paymentRequestId: paymentRequestId ?? null },
    deduplicationKey: paymentRequestId != null
      ? `mkt_ap_payment_handoff:${preparation.id}:${paymentRequestId}`
      : null,
  });
}

function queueHandoffNotification(preparation: ApRow, paymentRequest: PaymentRequestRow): void {
  void enqueueNotification({
    eventType: "mkt_ap_payment_handoff_created",
    recipientType: "admin",
    purchaseOrderId: preparation.mktPurchaseOrderId,
    payloadJson: {
      apPreparationId: preparation.id,
      preparationNumber: preparation.preparationNumber,
      paymentRequestId: paymentRequest.id,
      payReqNumber: paymentRequest.payReqNumber,
      status: paymentRequest.status,
      sourceType: MARKETPLACE_AP_HANDOFF_SOURCE,
    },
    deduplicationKey: `mkt_ap_payment_handoff:${preparation.id}:${paymentRequest.id}`,
  }).catch(() => {});
}

/**
 * Atomically creates or reuses the one canonical Payment Module record for an
 * AP preparation. This function intentionally stops at payment request
 * creation; no payment provider or accounting code is called here.
 */
export async function handoffApPreparationToPayment(
  preparationId: number,
  idempotencyKey: string,
  actor: Actor,
  expectedCompanyId?: number | null,
): Promise<PaymentHandoffResult> {
  let result: PaymentHandoffResult;
  try {
    result = await db.transaction(async (tx) => {
      const [preparation] = await tx
        .select()
        .from(mktApPreparationsTable)
        .where(eq(mktApPreparationsTable.id, preparationId))
        .for("update")
        .limit(1);
      if (!preparation) return { ok: false as const, code: "NOT_FOUND" as const };
      if (expectedCompanyId != null && preparation.companyId !== expectedCompanyId) {
        return { ok: false as const, code: "COMPANY_MISMATCH" as const };
      }
      if (preparation.status !== "waiting_payment") {
        return {
          ok: false as const,
          code: "INVALID_STATUS" as const,
          currentStatus: preparation.status,
          message: "AP preparation harus berstatus waiting_payment",
        };
      }

      const fingerprint = buildPaymentHandoffFingerprint({
        apPreparationId: preparation.id,
        companyId: preparation.companyId,
        supplierId: preparation.supplierId,
        vendorInvoiceId: preparation.vendorInvoiceId,
        currency: preparation.currencySnapshot,
        grandTotal: preparation.grandTotalSnapshot,
      });

      if (preparation.paymentRequestId != null) {
        const [existing] = await tx
          .select()
          .from(paymentRequestsTable)
          .where(eq(paymentRequestsTable.id, preparation.paymentRequestId))
          .for("update")
          .limit(1);
        if (!existing || existing.idempotencyKey !== idempotencyKey || existing.payloadFingerprint !== fingerprint) {
          return {
            ok: false as const,
            code: "IDEMPOTENCY_CONFLICT" as const,
            message: "AP preparation sudah di-handoff dengan idempotency key atau payload berbeda",
          };
        }
        return { ok: true as const, paymentRequest: existing, alreadyExists: true, preparation };
      }

      const [sameKey] = await tx
        .select()
        .from(paymentRequestsTable)
        .where(eq(paymentRequestsTable.idempotencyKey, idempotencyKey))
        .for("update")
        .limit(1);
      if (sameKey) {
        if (sameKey.mktApPreparationId !== preparation.id || sameKey.payloadFingerprint !== fingerprint) {
          return {
            ok: false as const,
            code: "IDEMPOTENCY_CONFLICT" as const,
            message: "Idempotency key sudah digunakan untuk handoff berbeda",
          };
        }
        const [linked] = await tx
          .update(mktApPreparationsTable)
          .set({
            paymentRequestId: sameKey.id,
            paymentHandoffAt: new Date(),
            paymentHandoffBy: actor.actorId ?? null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(mktApPreparationsTable.id, preparation.id),
            eq(mktApPreparationsTable.status, "waiting_payment"),
          ))
          .returning();
        if (!linked) return { ok: false as const, code: "CONCURRENT_UPDATE" as const };
        return { ok: true as const, paymentRequest: sameKey, alreadyExists: true, preparation: linked };
      }

      const [created] = await tx
        .insert(paymentRequestsTable)
        .values({
          payReqNumber: payReqNumber(preparation.id),
          companyId: preparation.companyId,
          supplierId: preparation.supplierId,
          supplierName: preparation.supplierName,
          status: "submitted",
          requestedBy: actor.actorId ?? null,
          totalAmount: preparation.grandTotalSnapshot,
          paidAmount: "0",
          currency: preparation.currencySnapshot,
          notes: `Marketplace AP handoff ${preparation.preparationNumber}`,
          sourceType: MARKETPLACE_AP_HANDOFF_SOURCE,
          sourceId: preparation.id,
          mktApPreparationId: preparation.id,
          idempotencyKey,
          payloadFingerprint: fingerprint,
        })
        .returning();
      if (!created) return { ok: false as const, code: "CONCURRENT_UPDATE" as const };

      await tx.insert(paymentRequestItemsTable).values({
        paymentRequestId: created.id,
        vendorInvoiceId: preparation.vendorInvoiceId,
        description: `Marketplace invoice ${preparation.invoiceNumberSnapshot}`,
        amount: preparation.grandTotalSnapshot,
      });

      const [linked] = await tx
        .update(mktApPreparationsTable)
        .set({
          paymentRequestId: created.id,
          paymentHandoffAt: new Date(),
          paymentHandoffBy: actor.actorId ?? null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(mktApPreparationsTable.id, preparation.id),
          eq(mktApPreparationsTable.status, "waiting_payment"),
        ))
        .returning();
      if (!linked) return { ok: false as const, code: "CONCURRENT_UPDATE" as const };
      return { ok: true as const, paymentRequest: created, alreadyExists: false, preparation: linked };
    });
  } catch (err: any) {
    const message = String(err?.message ?? err);
    if (/duplicate key|unique constraint|idempotency/i.test(message)) {
      result = {
        ok: false,
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key atau AP preparation sudah digunakan",
      };
    } else {
      throw err;
    }
  }

  if (!result.ok) {
    await logActivity({
      actorType: "admin",
      actorId: actor.actorId ?? null,
      actorName: actor.actorName ?? null,
      action: "mkt_ap_payment_handoff_failed",
      description: `AP preparation ${preparationId}: ${result.code}`,
      newValue: { apPreparationId: preparationId, code: result.code, message: result.message ?? null },
    });
    return result;
  }

  await auditHandoff(
    result.preparation,
    actor,
    result.alreadyExists ? "mkt_ap_payment_handoff_reused" : "mkt_ap_payment_handoff_created",
    result.paymentRequest.id,
  );
  queueHandoffNotification(result.preparation, result.paymentRequest);
  return result;
}