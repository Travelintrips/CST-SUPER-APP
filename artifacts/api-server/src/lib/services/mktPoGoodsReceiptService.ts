/**
 * mktPoGoodsReceiptService.ts — Phase 2G: Goods receipt
 *
 * - createGoodsReceipt(): header + item lines in one transaction.
 *   App-layer validation: accepted_qty + rejected_qty = received_qty per
 *   item (not a DB CHECK constraint, per schema comment, to keep manual
 *   admin overrides possible — but the service still rejects it by default;
 *   pass `allowMismatch: true` explicitly to bypass, which is logged).
 * - After insert, recomputes the PO's aggregate fulfillment status by
 *   comparing SUM(accepted_qty) across ALL goods receipts for the PO against
 *   SUM(qty) across all PO lines:
 *     - fully accepted (received >= ordered on every line, 0 rejected)   → delivered
 *     - some accepted, some still outstanding                            → partially_delivered
 *     - all rejected (accepted_qty sums to 0 across a full/rejected type) → rejected_goods
 *   Only applied when the PO is currently in_transit | ready_to_ship |
 *   partially_delivered — never overrides a manually-completed/closed PO.
 */

import { db, mktPurchaseOrdersTable, mktPoGoodsReceiptsTable, mktPoGoodsReceiptItemsTable, mktPoShipmentItemsTable, mktPoShipmentsTable, mktPurchaseOrderLinesTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";
import { logger } from "../logger.js";
import type { ActorInfo } from "./mktPoLifecycleService.js";

type GoodsReceiptRow = typeof mktPoGoodsReceiptsTable.$inferSelect;
type GoodsReceiptItemRow = typeof mktPoGoodsReceiptItemsTable.$inferSelect;

export interface CreateGoodsReceiptItemInput {
  shipmentItemId: number;
  receivedQty: string | number;
  acceptedQty: string | number;
  rejectedQty: string | number;
  condition?: string | null;
  notes?: string | null;
}

export interface CreateGoodsReceiptInput {
  shipmentId: number;
  receiptType: "full" | "partial" | "rejected";
  inspectionStatus?: "pending" | "passed" | "failed";
  receivedBy?: string | null;
  receivedAt?: Date | null;
  notes?: string | null;
  items: CreateGoodsReceiptItemInput[];
  allowMismatch?: boolean;
}

export type CreateGoodsReceiptResult =
  | { ok: true; receipt: GoodsReceiptRow; items: GoodsReceiptItemRow[]; poStatusUpdatedTo: string | null }
  | { ok: false; code: "SHIPMENT_NOT_FOUND" | "NO_ITEMS" | "INVALID_SHIPMENT_ITEM" | "QTY_MISMATCH"; message?: string; details?: unknown };

function toNum(v: string | number): number {
  return typeof v === "number" ? v : parseFloat(v);
}

export async function createGoodsReceipt(input: CreateGoodsReceiptInput, actor: ActorInfo): Promise<CreateGoodsReceiptResult> {
  if (!input.items || input.items.length === 0) {
    return { ok: false, code: "NO_ITEMS", message: "Goods receipt harus punya minimal 1 item" };
  }

  const shipmentRows = await db.select().from(mktPoShipmentsTable).where(eq(mktPoShipmentsTable.id, input.shipmentId)).limit(1);
  const shipment = shipmentRows[0];
  if (!shipment) return { ok: false, code: "SHIPMENT_NOT_FOUND" };

  const shipmentItemIds = input.items.map((i) => i.shipmentItemId);
  const validShipmentItems = await db
    .select({ id: mktPoShipmentItemsTable.id, poLineId: mktPoShipmentItemsTable.poLineId })
    .from(mktPoShipmentItemsTable)
    .where(and(eq(mktPoShipmentItemsTable.shipmentId, input.shipmentId), inArray(mktPoShipmentItemsTable.id, shipmentItemIds)));
  const validIdSet = new Set(validShipmentItems.map((i) => i.id));
  const invalid = shipmentItemIds.find((id) => !validIdSet.has(id));
  if (invalid !== undefined) {
    return { ok: false, code: "INVALID_SHIPMENT_ITEM", message: `shipment_item_id ${invalid} tidak ditemukan pada shipment ini` };
  }

  // Validate accepted + rejected = received per item, unless explicitly bypassed.
  if (!input.allowMismatch) {
    const mismatches = input.items
      .map((item) => {
        const received = toNum(item.receivedQty);
        const accepted = toNum(item.acceptedQty);
        const rejected = toNum(item.rejectedQty);
        const diff = Math.abs(received - (accepted + rejected));
        return diff > 0.005 ? { shipmentItemId: item.shipmentItemId, received, accepted, rejected } : null;
      })
      .filter(Boolean);
    if (mismatches.length > 0) {
      return { ok: false, code: "QTY_MISMATCH", message: "accepted_qty + rejected_qty harus sama dengan received_qty", details: mismatches };
    }
  }

  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const result = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(mktPoGoodsReceiptsTable)
      .values({
        shipmentId: input.shipmentId,
        receiptNumber: `MKT-GR-${yyyymm}-PENDING`,
        receiptType: input.receiptType,
        inspectionStatus: input.inspectionStatus ?? "pending",
        receivedBy: input.receivedBy ?? actor.actorId ?? null,
        receivedAt: input.receivedAt ?? now,
        notes: input.notes ?? null,
      })
      .returning({ id: mktPoGoodsReceiptsTable.id });

    const receiptSeq = String(inserted.id).padStart(4, "0");
    const receiptNumber = `MKT-GR-${yyyymm}-${receiptSeq}`;

    const [receipt] = await tx
      .update(mktPoGoodsReceiptsTable)
      .set({ receiptNumber })
      .where(eq(mktPoGoodsReceiptsTable.id, inserted.id))
      .returning();

    const items = await tx
      .insert(mktPoGoodsReceiptItemsTable)
      .values(
        input.items.map((item) => ({
          goodsReceiptId: inserted.id,
          shipmentItemId: item.shipmentItemId,
          receivedQty: String(item.receivedQty),
          acceptedQty: String(item.acceptedQty),
          rejectedQty: String(item.rejectedQty),
          condition: item.condition ?? "GOOD",
          notes: item.notes ?? null,
        })),
      )
      .returning();

    return { receipt, items };
  });

  logActivity({
    mktPurchaseOrderId: shipment.poId,
    actorType: actor.actorType,
    actorId: actor.actorId ?? null,
    actorName: actor.actorName ?? null,
    action: "mkt_po_goods_receipt_created",
    description: `Goods receipt ${result.receipt.receiptNumber} dibuat untuk shipment ${shipment.shipmentNumber}`,
    newValue: { goodsReceiptId: result.receipt.id, receiptNumber: result.receipt.receiptNumber, receiptType: input.receiptType, itemCount: result.items.length },
  }).catch(() => {});

  void enqueueNotification({
    eventType: "mkt_po_goods_receipt_notification",
    recipientType: "admin",
    purchaseOrderId: shipment.poId,
    payloadJson: { poId: shipment.poId, shipmentNumber: shipment.shipmentNumber, receiptNumber: result.receipt.receiptNumber, receiptType: input.receiptType },
  }).catch(() => {});

  const poStatusUpdatedTo = await updatePoAggregateStatusFromReceipts(shipment.poId, actor);

  return { ok: true, receipt: result.receipt, items: result.items, poStatusUpdatedTo };
}

/**
 * updatePoAggregateStatusFromReceipts — recompute and (if eligible) apply
 * the PO's aggregate fulfillment status from the sum of all goods receipt
 * items across all shipments belonging to the PO.
 *
 * Only auto-transitions a PO currently in ready_to_ship | in_transit |
 * partially_delivered — never overrides completed/closed/cancelled POs.
 */
export async function updatePoAggregateStatusFromReceipts(poId: number, actor: ActorInfo): Promise<string | null> {
  const poRows = await db.select().from(mktPurchaseOrdersTable).where(eq(mktPurchaseOrdersTable.id, poId)).limit(1);
  const po = poRows[0];
  if (!po) return null;

  const ELIGIBLE: (typeof po.status)[] = ["ready_to_ship", "in_transit", "partially_delivered"];
  if (!ELIGIBLE.includes(po.status)) return null;

  const [{ orderedTotal }] = await db
    .select({ orderedTotal: sql<string>`COALESCE(SUM(${mktPurchaseOrderLinesTable.qty}), 0)` })
    .from(mktPurchaseOrderLinesTable)
    .where(eq(mktPurchaseOrderLinesTable.poId, poId));

  const [{ acceptedTotal, rejectedTotal }] = await db
    .select({
      acceptedTotal: sql<string>`COALESCE(SUM(${mktPoGoodsReceiptItemsTable.acceptedQty}), 0)`,
      rejectedTotal: sql<string>`COALESCE(SUM(${mktPoGoodsReceiptItemsTable.rejectedQty}), 0)`,
    })
    .from(mktPoGoodsReceiptItemsTable)
    .innerJoin(mktPoGoodsReceiptsTable, eq(mktPoGoodsReceiptItemsTable.goodsReceiptId, mktPoGoodsReceiptsTable.id))
    .innerJoin(mktPoShipmentsTable, eq(mktPoGoodsReceiptsTable.shipmentId, mktPoShipmentsTable.id))
    .where(eq(mktPoShipmentsTable.poId, poId));

  const ordered = parseFloat(orderedTotal) || 0;
  const accepted = parseFloat(acceptedTotal) || 0;
  const rejected = parseFloat(rejectedTotal) || 0;

  let nextStatus: string | null = null;
  if (ordered > 0 && accepted <= 0 && rejected > 0) {
    nextStatus = "rejected_goods";
  } else if (ordered > 0 && accepted >= ordered) {
    nextStatus = "delivered";
  } else if (accepted > 0 || rejected > 0) {
    nextStatus = "partially_delivered";
  }

  if (!nextStatus || nextStatus === po.status) return null;

  const [updated] = await db
    .update(mktPurchaseOrdersTable)
    .set({ status: nextStatus as typeof po.status, updatedAt: new Date() })
    .where(and(eq(mktPurchaseOrdersTable.id, poId), eq(mktPurchaseOrdersTable.status, po.status)))
    .returning({ id: mktPurchaseOrdersTable.id });

  if (!updated) return null;

  logActivity({
    mktPurchaseOrderId: poId,
    actorType: actor.actorType,
    actorId: actor.actorId ?? null,
    actorName: actor.actorName ?? null,
    action: "mkt_po_status_auto_updated",
    description: `Status PO ${po.poNumber} diperbarui otomatis dari agregat goods receipt`,
    oldValue: { status: po.status },
    newValue: { status: nextStatus, orderedQty: ordered, acceptedQty: accepted, rejectedQty: rejected },
  }).catch(() => {});

  return nextStatus;
}

export async function getGoodsReceiptById(id: number): Promise<GoodsReceiptRow | undefined> {
  const rows = await db.select().from(mktPoGoodsReceiptsTable).where(eq(mktPoGoodsReceiptsTable.id, id)).limit(1);
  return rows[0];
}

export async function listGoodsReceiptItems(goodsReceiptId: number): Promise<GoodsReceiptItemRow[]> {
  return db.select().from(mktPoGoodsReceiptItemsTable).where(eq(mktPoGoodsReceiptItemsTable.goodsReceiptId, goodsReceiptId));
}

export async function listGoodsReceiptsForShipment(shipmentId: number): Promise<GoodsReceiptRow[]> {
  return db.select().from(mktPoGoodsReceiptsTable).where(eq(mktPoGoodsReceiptsTable.shipmentId, shipmentId));
}
