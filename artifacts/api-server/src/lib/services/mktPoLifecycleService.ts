/**
 * mktPoLifecycleService.ts — Phase 2G: PO status lifecycle
 *
 * Two families of transitions:
 *  - ADMIN_TRANSITIONS: issue → production → ready_to_ship → in_transit →
 *    delivered → completed → closed  (admin-driven, requireAdmin on routes)
 *  - VENDOR_TRANSITIONS: issued → vendor_accepted | vendor_rejected |
 *    revision_requested  (vendor-driven via opaque token, no admin session)
 *
 * Guard pattern: every transition re-checks the CURRENT status inside the
 * UPDATE's WHERE clause (not just via a prior SELECT), so two concurrent
 * requests racing on the same PO can never both succeed — the second one's
 * UPDATE affects 0 rows and is reported as INVALID_TRANSITION /
 * CONCURRENT_UPDATE.
 *
 * Never expose commission/margin/target price/ranking to vendor-facing
 * responses — getVendorPoView() is an explicit allow-list, not an
 * exclude-list, of columns.
 */

import {
  db,
  mktPurchaseOrdersTable,
  mktPurchaseOrderLinesTable,
  mktPoShipmentsTable,
  mktPoShipmentEventsTable,
  mktPoGoodsReceiptsTable,
  mktPoGoodsReceiptItemsTable,
} from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";
import { rotateVendorToken, findPoByVendorToken, markVendorTokenUsed, type TokenLookupFailure } from "./mktVendorPoTokenService.js";
import { logger } from "../logger.js";
import { NotificationService } from "./notificationService.js";

type PoRow = typeof mktPurchaseOrdersTable.$inferSelect;
type PoStatus = PoRow["status"];

export interface ActorInfo {
  actorType: "admin" | "vendor" | "system";
  actorId?: string | null;
  actorName?: string | null;
}

export type TransitionFailureCode = "NOT_FOUND" | "INVALID_TRANSITION" | "CONCURRENT_UPDATE" | "FULFILLMENT_EVIDENCE_REQUIRED";

export type TransitionResult<T extends object = object> =
  | ({ ok: true; po: PoRow; previousStatus: PoStatus } & T)
  | { ok: false; code: TransitionFailureCode; currentStatus?: PoStatus };

/**
 * guardedTransition — atomic status change, guarded by an equality check on
 * the CURRENT status re-evaluated inside the UPDATE's own WHERE clause.
 */
async function guardedTransition(
  poId: number,
  from: PoStatus[],
  to: PoStatus,
  extra: Partial<typeof mktPurchaseOrdersTable.$inferInsert> = {},
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(mktPurchaseOrdersTable)
      .where(eq(mktPurchaseOrdersTable.id, poId))
      .limit(1);
    const current = rows[0];
    if (!current) return { ok: false, code: "NOT_FOUND" as const };
    if (!from.includes(current.status)) {
      return { ok: false, code: "INVALID_TRANSITION" as const, currentStatus: current.status };
    }

    const [updated] = await tx
      .update(mktPurchaseOrdersTable)
      .set({ status: to, updatedAt: new Date(), ...extra })
      .where(and(eq(mktPurchaseOrdersTable.id, poId), eq(mktPurchaseOrdersTable.status, current.status)))
      .returning();

    if (!updated) return { ok: false, code: "CONCURRENT_UPDATE" as const };
    return { ok: true as const, po: updated, previousStatus: current.status };
  });
}

async function findCurrentPo(poId: number): Promise<PoRow | null> {
  const [po] = await db
    .select()
    .from(mktPurchaseOrdersTable)
    .where(eq(mktPurchaseOrdersTable.id, poId))
    .limit(1);
  return po ?? null;
}

function logStatusChange(poId: number, action: string, prev: PoStatus, next: PoStatus, actor: ActorInfo, description: string, extra?: Record<string, unknown>) {
  logActivity({
    mktPurchaseOrderId: poId,
    actorType: actor.actorType,
    actorId: actor.actorId ?? null,
    actorName: actor.actorName ?? null,
    action: `mkt_po_${action}`,
    description,
    oldValue: { status: prev },
    newValue: { status: next, ...extra },
  }).catch(() => {});
}

function notifyPoEvent(eventType: string, po: PoRow, extraPayload: Record<string, unknown> = {}) {
  void enqueueNotification({
    eventType,
    recipientType: "vendor",
    recipientId: po.vendorId,
    purchaseOrderId: po.id,
    payloadJson: {
      poNumber: po.poNumber,
      status: po.status,
      ...extraPayload,
    },
  }).catch(() => {});
}

// ── ADMIN TRANSITIONS ───────────────────────────────────────────────────────

export interface IssuePoResult {
  ok: true;
  po: PoRow;
  previousStatus: PoStatus;
  vendorToken: string;
  vendorTokenExpiresAt: Date;
}

/** issuePo — pending|revision_requested → issued. Rotates the vendor token and enqueues a notification. */
export async function issuePo(poId: number, actor: ActorInfo): Promise<IssuePoResult | { ok: false; code: TransitionFailureCode; currentStatus?: PoStatus }> {
  const guard = await guardedTransition(poId, ["pending", "revision_requested"], "issued");
  if (!guard.ok) return guard;

  const { token, expiresAt } = await rotateVendorToken(poId);

  logStatusChange(poId, "issued", guard.previousStatus, "issued", actor, `PO ${guard.po.poNumber} diterbitkan untuk konfirmasi vendor`);
  notifyPoEvent("mkt_po_issued_notification", guard.po, { vendorTokenExpiresAt: expiresAt.toISOString() });

  return { ok: true, po: guard.po, previousStatus: guard.previousStatus, vendorToken: token, vendorTokenExpiresAt: expiresAt };
}

async function simpleAdminTransition(
  poId: number,
  from: PoStatus[],
  to: PoStatus,
  action: string,
  description: (po: PoRow) => string,
  actor: ActorInfo,
  extra: Partial<typeof mktPurchaseOrdersTable.$inferInsert> = {},
): Promise<TransitionResult> {
  const guard = await guardedTransition(poId, from, to, extra);
  if (!guard.ok) return guard;
  logStatusChange(poId, action, guard.previousStatus, to, actor, description(guard.po));
  notifyPoEvent(`mkt_po_${action}_notification`, guard.po);
  return guard;
}

export const setProduction = (poId: number, actor: ActorInfo) =>
  simpleAdminTransition(poId, ["vendor_accepted"], "production", "production", (po) => `PO ${po.poNumber} memasuki tahap produksi`, actor);

export const setReadyToShip = (poId: number, actor: ActorInfo) =>
  simpleAdminTransition(poId, ["production"], "ready_to_ship", "ready_to_ship", (po) => `PO ${po.poNumber} siap dikirim`, actor);

export const setInTransit = (poId: number, actor: ActorInfo) =>
  simpleAdminTransition(poId, ["ready_to_ship"], "in_transit", "in_transit", (po) => `PO ${po.poNumber} dalam pengiriman`, actor);

type FulfillmentEvidence = { ok: true } | { ok: false; code: "FULFILLMENT_EVIDENCE_REQUIRED" };

async function hasCompletedFulfillmentEvidence(poId: number): Promise<boolean> {
  const [po] = await db
    .select({ id: mktPurchaseOrdersTable.id })
    .from(mktPurchaseOrdersTable)
    .where(eq(mktPurchaseOrdersTable.id, poId))
    .limit(1);
  if (!po) return false;

  const [{ ordered }] = await db
    .select({ ordered: sql<string>`COALESCE(SUM(${mktPurchaseOrderLinesTable.qty}), 0)` })
    .from(mktPurchaseOrderLinesTable)
    .where(eq(mktPurchaseOrderLinesTable.poId, poId));
  const [{ accepted }] = await db
    .select({ accepted: sql<string>`COALESCE(SUM(${mktPoGoodsReceiptItemsTable.acceptedQty}), 0)` })
    .from(mktPoGoodsReceiptItemsTable)
    .innerJoin(mktPoGoodsReceiptsTable, eq(mktPoGoodsReceiptItemsTable.goodsReceiptId, mktPoGoodsReceiptsTable.id))
    .innerJoin(mktPoShipmentsTable, eq(mktPoGoodsReceiptsTable.shipmentId, mktPoShipmentsTable.id))
    .where(eq(mktPoShipmentsTable.poId, poId));
  if (Number(accepted) < Number(ordered) || Number(ordered) <= 0) return false;

  const [notPassed] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(mktPoGoodsReceiptItemsTable)
    .innerJoin(mktPoGoodsReceiptsTable, eq(mktPoGoodsReceiptItemsTable.goodsReceiptId, mktPoGoodsReceiptsTable.id))
    .innerJoin(mktPoShipmentsTable, eq(mktPoGoodsReceiptsTable.shipmentId, mktPoShipmentsTable.id))
    .where(and(
      eq(mktPoShipmentsTable.poId, poId),
      sql`${mktPoGoodsReceiptItemsTable.acceptedQty} > 0`,
      sql`${mktPoGoodsReceiptsTable.inspectionStatus} <> 'passed'`,
    ));
  if (Number(notPassed?.count ?? 0) > 0) return false;

  const [pod] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(mktPoShipmentEventsTable)
    .innerJoin(mktPoShipmentsTable, eq(mktPoShipmentEventsTable.shipmentId, mktPoShipmentsTable.id))
    .where(and(
      eq(mktPoShipmentsTable.poId, poId),
      eq(mktPoShipmentEventsTable.eventType, "pod_uploaded"),
    ));
  return Number(pod?.count ?? 0) > 0;
}

async function requireFulfillmentEvidence(poId: number): Promise<FulfillmentEvidence> {
  return (await hasCompletedFulfillmentEvidence(poId))
    ? { ok: true }
    : { ok: false, code: "FULFILLMENT_EVIDENCE_REQUIRED" };
}

export async function markDelivered(poId: number, actor: ActorInfo): Promise<TransitionResult> {
  const evidence = await requireFulfillmentEvidence(poId);
  if (!evidence.ok) return evidence;
  return simpleAdminTransition(poId, ["in_transit"], "delivered", "delivered", (po) => `PO ${po.poNumber} telah diterima`, actor, {
    actualCompletionDate: new Date().toISOString().slice(0, 10) as unknown as string,
  });
}

export async function completePo(poId: number, actor: ActorInfo): Promise<TransitionResult> {
  const evidence = await requireFulfillmentEvidence(poId);
  if (!evidence.ok) return evidence;
  return simpleAdminTransition(poId, ["delivered"], "completed", "completed", (po) => `PO ${po.poNumber} selesai`, actor);
}

export async function closePo(poId: number, actor: ActorInfo): Promise<TransitionResult> {
  const current = await findCurrentPo(poId);
  if (!current) return { ok: false, code: "NOT_FOUND" };
  if (current.status === "completed") {
    const evidence = await requireFulfillmentEvidence(poId);
    if (!evidence.ok) return evidence;
  }
  return simpleAdminTransition(poId, ["completed", "rejected_goods"], "closed", "closed", (po) => `PO ${po.poNumber} ditutup`, actor, {
    closedAt: new Date(),
  });
}

// ── VENDOR TRANSITIONS (via opaque token) ───────────────────────────────────

export type VendorActionFailure =
  | { ok: false; code: TokenLookupFailure }
  | { ok: false; code: TransitionFailureCode; currentStatus?: PoStatus };

export async function vendorAcceptPo(token: string): Promise<{ ok: true; po: PoRow; alreadyAccepted?: boolean } | VendorActionFailure> {
  const lookup = await findPoByVendorToken(token);
  if (!lookup.ok) return lookup;
  if (lookup.po.status === "vendor_accepted") {
    return { ok: true, po: lookup.po, alreadyAccepted: true };
  }

  const guard = await guardedTransition(lookup.po.id, ["issued"], "vendor_accepted", {
    confirmedAt: new Date(),
  });
  if (!guard.ok) {
    const current = await findCurrentPo(lookup.po.id);
    if (current?.status === "vendor_accepted") {
      return { ok: true, po: current, alreadyAccepted: true };
    }
    return guard;
  }

  await markVendorTokenUsed(guard.po.id);
  logStatusChange(guard.po.id, "vendor_accepted", guard.previousStatus, "vendor_accepted", { actorType: "vendor", actorId: `vendor:${guard.po.vendorId}`, actorName: guard.po.vendorNameSnapshot }, `Vendor ${guard.po.vendorNameSnapshot ?? ""} menerima PO ${guard.po.poNumber}`);
  void enqueueNotification({
    eventType: "mkt_po_vendor_accepted_notification",
    recipientType: "admin",
    purchaseOrderId: guard.po.id,
    payloadJson: { poNumber: guard.po.poNumber, vendorId: guard.po.vendorId },
    deduplicationKey: `mkt_po_vendor_accepted:${guard.po.id}`,
  }).catch(() => {});
  await notifyAdminVendorPoAction(guard.po, "accepted");

  return { ok: true, po: guard.po };
}

export async function vendorRejectPo(token: string, reason?: string | null): Promise<{ ok: true; po: PoRow; alreadyRejected?: boolean } | VendorActionFailure> {
  const lookup = await findPoByVendorToken(token);
  if (!lookup.ok) return lookup;
  if (lookup.po.status === "vendor_rejected") {
    return { ok: true, po: lookup.po, alreadyRejected: true };
  }

  const guard = await guardedTransition(lookup.po.id, ["issued"], "vendor_rejected", {
    cancelReason: reason ?? null,
  });
  if (!guard.ok) {
    const current = await findCurrentPo(lookup.po.id);
    if (current?.status === "vendor_rejected") {
      return { ok: true, po: current, alreadyRejected: true };
    }
    return guard;
  }

  await markVendorTokenUsed(guard.po.id);
  logStatusChange(guard.po.id, "vendor_rejected", guard.previousStatus, "vendor_rejected", { actorType: "vendor", actorId: `vendor:${guard.po.vendorId}`, actorName: guard.po.vendorNameSnapshot }, `Vendor ${guard.po.vendorNameSnapshot ?? ""} menolak PO ${guard.po.poNumber}`, { reason: reason ?? null });
  void enqueueNotification({
    eventType: "mkt_po_vendor_rejected_notification",
    recipientType: "admin",
    purchaseOrderId: guard.po.id,
    payloadJson: { poNumber: guard.po.poNumber, vendorId: guard.po.vendorId, reason: reason ?? null },
    deduplicationKey: `mkt_po_vendor_rejected:${guard.po.id}`,
  }).catch(() => {});
  await notifyAdminVendorPoAction(guard.po, "rejected", { reason: reason ?? null });

  return { ok: true, po: guard.po };
}

export async function vendorRequestRevision(token: string, notes: string): Promise<{ ok: true; po: PoRow } | VendorActionFailure> {
  const lookup = await findPoByVendorToken(token);
  if (!lookup.ok) return lookup;

  const guard = await guardedTransition(lookup.po.id, ["issued"], "revision_requested", {
    revisionNotes: notes,
  });
  if (!guard.ok) return guard;

  await markVendorTokenUsed(guard.po.id);
  logStatusChange(guard.po.id, "revision_requested", guard.previousStatus, "revision_requested", { actorType: "vendor", actorId: `vendor:${guard.po.vendorId}`, actorName: guard.po.vendorNameSnapshot }, `Vendor ${guard.po.vendorNameSnapshot ?? ""} meminta revisi PO ${guard.po.poNumber}`, { notes });
  void enqueueNotification({
    eventType: "mkt_po_revision_requested_notification",
    recipientType: "admin",
    purchaseOrderId: guard.po.id,
    payloadJson: { poNumber: guard.po.poNumber, vendorId: guard.po.vendorId, notes },
  }).catch(() => {});
  await notifyAdminVendorPoAction(guard.po, "revision_requested", { notes });

  return { ok: true, po: guard.po };
}

async function notifyAdminVendorPoAction(
  po: PoRow,
  action: "accepted" | "rejected" | "revision_requested",
  extra: Record<string, unknown> = {},
): Promise<void> {
  const labels = {
    accepted: {
      type: "mkt_po_vendor_accepted",
      title: "PO Marketplace dikonfirmasi vendor",
      verb: "menerima",
    },
    rejected: {
      type: "mkt_po_vendor_rejected",
      title: "PO Marketplace ditolak vendor",
      verb: "menolak",
    },
    revision_requested: {
      type: "mkt_po_vendor_revision_requested",
      title: "Revisi PO Marketplace diminta vendor",
      verb: "meminta revisi",
    },
  }[action];

  await NotificationService.saveAndBroadcast("admin_notification", {
    type: labels.type,
    orderId: po.id,
    orderNumber: po.poNumber,
    customerName: po.vendorNameSnapshot ?? `Vendor #${po.vendorId}`,
    title: labels.title,
    body: `${po.vendorNameSnapshot ?? `Vendor #${po.vendorId}`} ${labels.verb} PO ${po.poNumber}.`,
    targetRole: "admin",
    dedupeKey: `mkt_po_vendor_action:${po.id}:${action}`,
    rfqId: po.rfqId,
    purchaseOrderId: po.id,
    vendorId: po.vendorId,
    ...extra,
  });
}

// ── Vendor-facing sanitized view ────────────────────────────────────────────
// Explicit allow-list — never include commission/margin/target price/ranking
// or internal FKs (rfqId/quoteId/companyId/createdBy).

export interface VendorPoLineView {
  lineNumber: number;
  itemName: string;
  qty: string;
  unit: string | null;
  unitPrice: string;
  subtotal: string;
  notes: string | null;
}

export interface VendorPoView {
  poNumber: string;
  status: PoStatus;
  vendorNameSnapshot: string | null;
  vendorAddressSnapshot: string | null;
  paymentTermsSnapshot: string | null;
  incotermSnapshot: string | null;
  quotationNumberSnapshot: string | null;
  quotationDateSnapshot: string | null;
  currencySnapshot: string | null;
  leadTimeDaysSnapshot: number | null;
  totalAmount: string;
  taxAmount: string;
  grandTotal: string;
  expectedCompletionDate: string | null;
  actualCompletionDate: string | null;
  revisionNotes: string | null;
  createdAt: Date;
  vendorTokenExpiresAt: Date | null;
  lines: VendorPoLineView[];
}

export async function getVendorPoView(token: string): Promise<{ ok: true; view: VendorPoView } | { ok: false; code: TokenLookupFailure }> {
  const lookup = await findPoByVendorToken(token);
  if (!lookup.ok) return lookup;
  const po = lookup.po;

  const lineRows = await db
    .select({
      itemName: mktPurchaseOrderLinesTable.itemName,
      qty: mktPurchaseOrderLinesTable.qty,
      unit: mktPurchaseOrderLinesTable.unit,
      unitPrice: mktPurchaseOrderLinesTable.unitPrice,
      subtotal: mktPurchaseOrderLinesTable.subtotal,
      notes: mktPurchaseOrderLinesTable.notes,
    })
    .from(mktPurchaseOrderLinesTable)
    .where(eq(mktPurchaseOrderLinesTable.poId, po.id))
    .orderBy(asc(mktPurchaseOrderLinesTable.id));
  const lines = lineRows.map((line, index) => ({ lineNumber: index + 1, ...line }));

  void logActivity({
    mktPurchaseOrderId: po.id,
    mktRfqId: po.rfqId,
    mktVendorQuoteId: po.quoteId,
    actorType: "vendor",
    actorId: `vendor:${po.vendorId}`,
    actorName: po.vendorNameSnapshot,
    action: "mkt_po_viewed_by_vendor",
    description: `Vendor melihat PO ${po.poNumber}`,
    newValue: { status: po.status },
  });

  return {
    ok: true,
    view: {
      poNumber: po.poNumber,
      status: po.status,
      vendorNameSnapshot: po.vendorNameSnapshot,
      vendorAddressSnapshot: po.vendorAddressSnapshot,
      paymentTermsSnapshot: po.paymentTermsSnapshot,
      incotermSnapshot: po.incotermSnapshot,
      quotationNumberSnapshot: po.quotationNumberSnapshot,
      quotationDateSnapshot: po.quotationDateSnapshot,
      currencySnapshot: po.currencySnapshot,
      leadTimeDaysSnapshot: po.leadTimeDaysSnapshot,
      totalAmount: po.totalAmount,
      taxAmount: po.taxAmount,
      grandTotal: po.grandTotal,
      expectedCompletionDate: po.expectedCompletionDate,
      actualCompletionDate: po.actualCompletionDate,
      revisionNotes: po.revisionNotes,
      createdAt: po.createdAt,
      vendorTokenExpiresAt: po.vendorTokenExpiresAt,
      lines,
    },
  };
}
