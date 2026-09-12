import {
  db,
  mktApPreparationsTable,
  mktPoGoodsReceiptsTable,
  mktPurchaseOrdersTable,
  vendorInvoicesTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";

type ApRow = typeof mktApPreparationsTable.$inferSelect;
type InvoiceRow = typeof vendorInvoicesTable.$inferSelect;

export type ApPreparationFailureCode =
  | "NOT_FOUND"
  | "INVALID_STATUS"
  | "MISSING_REFERENCE"
  | "MATCH_NOT_PASSED"
  | "CONCURRENT_UPDATE";

export type ApPreparationResult =
  | { ok: true; preparation: ApRow; alreadyExists: boolean }
  | { ok: false; code: ApPreparationFailureCode; currentStatus?: ApRow["status"]; message?: string };

function preparationNumber(id: number): string {
  return `MKT-AP-${new Date().getFullYear()}-${String(id).padStart(6, "0")}`;
}

function safeApView(row: ApRow) {
  return {
    id: row.id,
    preparationNumber: row.preparationNumber,
    vendorInvoiceId: row.vendorInvoiceId,
    mktPurchaseOrderId: row.mktPurchaseOrderId,
    mktGoodsReceiptId: row.mktGoodsReceiptId,
    companyId: row.companyId,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    invoiceNumber: row.invoiceNumberSnapshot,
    vendorInvoiceRef: row.vendorInvoiceRefSnapshot,
    currency: row.currencySnapshot,
    totalAmount: row.totalAmountSnapshot,
    taxAmount: row.taxAmountSnapshot,
    grandTotal: row.grandTotalSnapshot,
    status: row.status,
    notes: row.notes,
    financeReviewedBy: row.financeReviewedBy,
    financeReviewedAt: row.financeReviewedAt,
    waitingPaymentAt: row.waitingPaymentAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export { safeApView };

async function getPreparation(id: number, tx: any = db): Promise<ApRow | null> {
  const [row] = await tx
    .select()
    .from(mktApPreparationsTable)
    .where(eq(mktApPreparationsTable.id, id))
    .limit(1);
  return row ?? null;
}

function isAtOrBeyond(status: ApRow["status"], target: "finance_review" | "waiting_payment"): boolean {
  return target === "finance_review"
    ? status === "finance_review" || status === "waiting_payment"
    : status === "waiting_payment";
}

async function auditApTransition(
  preparation: ApRow,
  actor: { actorId?: string | null; actorName?: string | null },
  action: string,
  previousStatus: string,
): Promise<void> {
  await logActivity({
    mktPurchaseOrderId: preparation.mktPurchaseOrderId,
    actorType: "admin",
    actorId: actor.actorId ?? null,
    actorName: actor.actorName ?? null,
    action,
    description: `${preparation.preparationNumber}: ${previousStatus} → ${preparation.status}`,
    oldValue: { status: previousStatus },
    newValue: { status: preparation.status, preparationId: preparation.id },
  });
}

function queueApNotification(preparation: ApRow, eventType: string): void {
  void enqueueNotification({
    eventType,
    recipientType: "admin",
    purchaseOrderId: preparation.mktPurchaseOrderId,
    payloadJson: {
      preparationId: preparation.id,
      preparationNumber: preparation.preparationNumber,
      vendorInvoiceId: preparation.vendorInvoiceId,
      status: preparation.status,
    },
    deduplicationKey: `mkt_ap_preparation:${preparation.id}:${preparation.status}`,
  }).catch(() => {});
}

/**
 * Creates the AP handoff from the authoritative, already matched vendor
 * invoice. Client-supplied vendor/company/amount/currency values are not
 * accepted; every snapshot is read from the invoice and its linked records.
 */
export async function createApPreparation(
  invoiceId: number,
  actor: { actorId?: string | null; actorName?: string | null },
): Promise<ApPreparationResult> {
  const result = await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(vendorInvoicesTable)
      .where(eq(vendorInvoicesTable.id, invoiceId))
      .for("update")
      .limit(1);
    if (!invoice) return { ok: false as const, code: "NOT_FOUND" as const };

    const existing = await tx
      .select()
      .from(mktApPreparationsTable)
      .where(eq(mktApPreparationsTable.vendorInvoiceId, invoice.id))
      .for("update")
      .limit(1);
    if (existing[0]) {
      return { ok: true as const, preparation: existing[0], alreadyExists: true };
    }

    if (invoice.status !== "ready_for_ap") {
      return {
        ok: false as const,
        code: "INVALID_STATUS" as const,
        message: "Vendor invoice harus berstatus ready_for_ap",
      };
    }
    if (invoice.threeWayMatchStatus !== "passed") {
      return {
        ok: false as const,
        code: "MATCH_NOT_PASSED" as const,
        message: "Vendor invoice belum lulus 3-Way Match",
      };
    }
    if (!invoice.mktPurchaseOrderId || !invoice.mktGoodsReceiptId || !invoice.supplierId) {
      return { ok: false as const, code: "MISSING_REFERENCE" as const };
    }

    const [po] = await tx
      .select()
      .from(mktPurchaseOrdersTable)
      .where(eq(mktPurchaseOrdersTable.id, invoice.mktPurchaseOrderId))
      .limit(1);
    const [gr] = await tx
      .select()
      .from(mktPoGoodsReceiptsTable)
      .where(eq(mktPoGoodsReceiptsTable.id, invoice.mktGoodsReceiptId))
      .limit(1);
    if (!po || !gr || gr.shipmentId == null) {
      return { ok: false as const, code: "MISSING_REFERENCE" as const };
    }
    if (po.vendorId !== invoice.supplierId || po.companyId !== invoice.companyId) {
      return { ok: false as const, code: "MISSING_REFERENCE" as const, message: "Referensi invoice tidak konsisten dengan PO" };
    }

    const [inserted] = await tx
      .insert(mktApPreparationsTable)
      .values({
        preparationNumber: `MKT-AP-PENDING-${Date.now()}`,
        vendorInvoiceId: invoice.id,
        mktPurchaseOrderId: po.id,
        mktGoodsReceiptId: gr.id,
        companyId: po.companyId,
        supplierId: po.vendorId,
        supplierName: invoice.supplierName,
        invoiceNumberSnapshot: invoice.invoiceNumber,
        vendorInvoiceRefSnapshot: invoice.vendorInvoiceRef,
        currencySnapshot: invoice.currency,
        totalAmountSnapshot: invoice.totalAmount,
        taxAmountSnapshot: invoice.taxAmount,
        grandTotalSnapshot: invoice.grandTotal,
        status: "ap_preparation",
        createdBy: actor.actorId ?? null,
      })
      .returning();
    if (!inserted) return { ok: false as const, code: "CONCURRENT_UPDATE" as const };

    const [numbered] = await tx
      .update(mktApPreparationsTable)
      .set({ preparationNumber: preparationNumber(inserted.id), updatedAt: new Date() })
      .where(eq(mktApPreparationsTable.id, inserted.id))
      .returning();
    return { ok: true as const, preparation: numbered ?? inserted, alreadyExists: false };
  });

  if (result.ok && !result.alreadyExists) {
    await auditApTransition(result.preparation, actor, "mkt_ap_preparation_created", "ready_for_ap");
    queueApNotification(result.preparation, "mkt_ap_preparation_created");
  }
  return result;
}

async function transitionAp(
  id: number,
  target: "finance_review" | "waiting_payment",
  actor: { actorId?: string | null; actorName?: string | null },
): Promise<ApPreparationResult> {
  const result = await db.transaction(async (tx) => {
    const current = await getPreparation(id, tx);
    if (!current) return { ok: false as const, code: "NOT_FOUND" as const };
    if (isAtOrBeyond(current.status, target)) {
      return { ok: true as const, preparation: current, alreadyExists: true };
    }
    const expected = target === "finance_review" ? "ap_preparation" : "finance_review";
    if (current.status !== expected) {
      return {
        ok: false as const,
        code: "INVALID_STATUS" as const,
        currentStatus: current.status,
        message: `AP preparation harus berstatus ${expected}`,
      };
    }
    const [updated] = await tx
      .update(mktApPreparationsTable)
      .set({
        status: target,
        financeReviewedBy: target === "finance_review" ? actor.actorId ?? null : current.financeReviewedBy,
        financeReviewedAt: target === "finance_review" ? new Date() : current.financeReviewedAt,
        waitingPaymentAt: target === "waiting_payment" ? new Date() : current.waitingPaymentAt,
        updatedAt: new Date(),
      })
      .where(and(eq(mktApPreparationsTable.id, id), eq(mktApPreparationsTable.status, expected)))
      .returning();
    if (!updated) return { ok: false as const, code: "CONCURRENT_UPDATE" as const };
    return { ok: true as const, preparation: updated, alreadyExists: false };
  });

  if (result.ok && !result.alreadyExists) {
    await auditApTransition(
      result.preparation,
      actor,
      target === "finance_review" ? "mkt_ap_finance_reviewed" : "mkt_ap_waiting_payment",
      target === "finance_review" ? "ap_preparation" : "finance_review",
    );
    queueApNotification(
      result.preparation,
      target === "finance_review" ? "mkt_ap_finance_reviewed" : "mkt_ap_waiting_payment",
    );
  }
  return result;
}

export function reviewApPreparation(
  id: number,
  actor: { actorId?: string | null; actorName?: string | null },
): Promise<ApPreparationResult> {
  return transitionAp(id, "finance_review", actor);
}

export function markApPreparationWaitingPayment(
  id: number,
  actor: { actorId?: string | null; actorName?: string | null },
): Promise<ApPreparationResult> {
  return transitionAp(id, "waiting_payment", actor);
}

export async function getApPreparation(id: number): Promise<ApRow | null> {
  return getPreparation(id);
}

export async function listApPreparations(companyId?: number | null): Promise<ApRow[]> {
  return db
    .select()
    .from(mktApPreparationsTable)
    .where(companyId == null ? undefined : eq(mktApPreparationsTable.companyId, companyId))
    .orderBy(asc(mktApPreparationsTable.id));
}