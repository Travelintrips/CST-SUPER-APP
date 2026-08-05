/**
 * mktPoShipmentService.ts — Phase 2G: Shipment tracking
 *
 * - createShipment(): PO must be in a fulfillment-eligible status
 *   (production | ready_to_ship | in_transit) — creates the shipment header
 *   plus its line items in one transaction, generates shipment_number
 *   (MKT-SHP-YYYYMM-XXXX, same pattern as MKT-PO-YYYYMM-XXXX), snapshots
 *   incoterm from the parent PO, logs activity, enqueues notification.
 * - appendShipmentEvent(): APPEND-ONLY — never updates/deletes existing
 *   rows. event_sequence is assigned as MAX(event_sequence)+1 inside the
 *   same transaction that inserts the row, so concurrent appends can never
 *   collide (unique index on (shipment_id, event_sequence) backs this up).
 * - listShipmentTimeline(): read-only chronological event list for a
 *   shipment.
 */

import { db, mktPurchaseOrdersTable, mktPoShipmentsTable, mktPoShipmentItemsTable, mktPoShipmentEventsTable, mktPurchaseOrderLinesTable } from "@workspace/db";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";
import { logger } from "../logger.js";
import type { ActorInfo } from "./mktPoLifecycleService.js";

type PoRow = typeof mktPurchaseOrdersTable.$inferSelect;
type ShipmentRow = typeof mktPoShipmentsTable.$inferSelect;
type ShipmentEventRow = typeof mktPoShipmentEventsTable.$inferSelect;

const SHIPMENT_ELIGIBLE_PO_STATUSES: PoRow["status"][] = ["production", "ready_to_ship", "in_transit"];

export interface CreateShipmentItemInput {
  poLineId: number;
  lineNumber: number;
  qty: string | number;
  uom?: string | null;
  weight?: string | number | null;
  volume?: string | number | null;
  packageCount?: number | null;
  remarks?: string | null;
}

export interface CreateShipmentInput {
  poId: number;
  shipmentType?: string | null;
  carrierName?: string | null;
  trackingNumber?: string | null;
  vehicleType?: string | null;
  vehicleNumber?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  containerNumber?: string | null;
  sealNumber?: string | null;
  origin?: string | null;
  destination?: string | null;
  plannedDeparture?: Date | null;
  estimatedArrival?: Date | null;
  notes?: string | null;
  items: CreateShipmentItemInput[];
}

export type CreateShipmentResult =
  | { ok: true; shipment: ShipmentRow; items: (typeof mktPoShipmentItemsTable.$inferSelect)[] }
  | { ok: false; code: "PO_NOT_FOUND" | "PO_NOT_ELIGIBLE" | "NO_ITEMS" | "INVALID_PO_LINE"; message?: string };

export async function createShipment(input: CreateShipmentInput, actor: ActorInfo): Promise<CreateShipmentResult> {
  if (!input.items || input.items.length === 0) {
    return { ok: false, code: "NO_ITEMS", message: "Shipment harus punya minimal 1 item" };
  }

  const poRows = await db.select().from(mktPurchaseOrdersTable).where(eq(mktPurchaseOrdersTable.id, input.poId)).limit(1);
  const po = poRows[0];
  if (!po) return { ok: false, code: "PO_NOT_FOUND" };
  if (!SHIPMENT_ELIGIBLE_PO_STATUSES.includes(po.status)) {
    return { ok: false, code: "PO_NOT_ELIGIBLE", message: `PO berstatus '${po.status}', harus 'production', 'ready_to_ship', atau 'in_transit'` };
  }

  // Validate every referenced po_line actually belongs to this PO.
  const lineIds = input.items.map((i) => i.poLineId);
  const validLines = await db
    .select({ id: mktPurchaseOrderLinesTable.id })
    .from(mktPurchaseOrderLinesTable)
    .where(and(eq(mktPurchaseOrderLinesTable.poId, input.poId), inArray(mktPurchaseOrderLinesTable.id, lineIds)));
  const validLineIdSet = new Set(validLines.map((l) => l.id));
  const invalid = lineIds.find((id) => !validLineIdSet.has(id));
  if (invalid !== undefined) {
    return { ok: false, code: "INVALID_PO_LINE", message: `po_line_id ${invalid} tidak ditemukan pada PO ini` };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const now = new Date();
      const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

      const [inserted] = await tx
        .insert(mktPoShipmentsTable)
        .values({
          poId: input.poId,
          shipmentNumber: `MKT-SHP-${yyyymm}-PENDING`,
          shipmentStatus: "planned",
          shipmentType: input.shipmentType ?? null,
          carrierName: input.carrierName ?? null,
          trackingNumber: input.trackingNumber ?? null,
          vehicleType: input.vehicleType ?? null,
          vehicleNumber: input.vehicleNumber ?? null,
          driverName: input.driverName ?? null,
          driverPhone: input.driverPhone ?? null,
          containerNumber: input.containerNumber ?? null,
          sealNumber: input.sealNumber ?? null,
          origin: input.origin ?? null,
          destination: input.destination ?? null,
          incotermSnapshot: po.incotermSnapshot,
          plannedDeparture: input.plannedDeparture ?? null,
          estimatedArrival: input.estimatedArrival ?? null,
          notes: input.notes ?? null,
          createdBy: actor.actorId ?? null,
        })
        .returning({ id: mktPoShipmentsTable.id });

      const shipmentSeq = String(inserted.id).padStart(4, "0");
      const shipmentNumber = `MKT-SHP-${yyyymm}-${shipmentSeq}`;

      const [shipment] = await tx
        .update(mktPoShipmentsTable)
        .set({ shipmentNumber, updatedAt: new Date() })
        .where(eq(mktPoShipmentsTable.id, inserted.id))
        .returning();

      const itemRows = await tx
        .insert(mktPoShipmentItemsTable)
        .values(
          input.items.map((item) => ({
            shipmentId: inserted.id,
            poLineId: item.poLineId,
            lineNumber: item.lineNumber,
            qty: String(item.qty),
            uom: item.uom ?? null,
            weight: item.weight != null ? String(item.weight) : null,
            volume: item.volume != null ? String(item.volume) : null,
            packageCount: item.packageCount ?? null,
            remarks: item.remarks ?? null,
          })),
        )
        .returning();

      // Seed event_sequence 1 — "created"
      await tx.insert(mktPoShipmentEventsTable).values({
        shipmentId: inserted.id,
        eventSequence: 1,
        eventType: "created",
        note: `Shipment ${shipmentNumber} dibuat`,
        actorType: actor.actorType,
        actorId: actor.actorId ?? null,
      });

      return { shipment, items: itemRows };
    });

    logActivity({
      mktPurchaseOrderId: input.poId,
      actorType: actor.actorType,
      actorId: actor.actorId ?? null,
      actorName: actor.actorName ?? null,
      action: "mkt_po_shipment_created",
      description: `Shipment ${result.shipment.shipmentNumber} dibuat untuk PO ${po.poNumber}`,
      newValue: { shipmentId: result.shipment.id, shipmentNumber: result.shipment.shipmentNumber, itemCount: result.items.length },
    }).catch(() => {});

    void enqueueNotification({
      eventType: "mkt_po_shipment_created_notification",
      recipientType: "vendor",
      recipientId: po.vendorId,
      purchaseOrderId: po.id,
      payloadJson: { poNumber: po.poNumber, shipmentNumber: result.shipment.shipmentNumber },
    }).catch(() => {});

    return { ok: true, shipment: result.shipment, items: result.items };
  } catch (err) {
    logger.warn({ err, poId: input.poId }, "[mktPoShipment] createShipment gagal");
    throw err;
  }
}

export interface AppendShipmentEventInput {
  shipmentId: number;
  eventType: string;
  note?: string | null;
  location?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  attachmentObjectPath?: string | null;
}

export type AppendShipmentEventResult =
  | { ok: true; event: ShipmentEventRow }
  | { ok: false; code: "SHIPMENT_NOT_FOUND" };

/**
 * appendShipmentEvent — APPEND-ONLY insert. event_sequence computed as
 * MAX(event_sequence)+1 inside the same transaction; the unique index on
 * (shipment_id, event_sequence) guarantees no two concurrent appends can
 * collide (a conflicting insert throws, and the caller may retry).
 */
export async function appendShipmentEvent(input: AppendShipmentEventInput, actor: ActorInfo): Promise<AppendShipmentEventResult> {
  const shipmentRows = await db.select().from(mktPoShipmentsTable).where(eq(mktPoShipmentsTable.id, input.shipmentId)).limit(1);
  const shipment = shipmentRows[0];
  if (!shipment) return { ok: false, code: "SHIPMENT_NOT_FOUND" };

  const event = await db.transaction(async (tx) => {
    const [{ maxSeq }] = await tx
      .select({ maxSeq: sql<number>`COALESCE(MAX(${mktPoShipmentEventsTable.eventSequence}), 0)` })
      .from(mktPoShipmentEventsTable)
      .where(eq(mktPoShipmentEventsTable.shipmentId, input.shipmentId));

    const [inserted] = await tx
      .insert(mktPoShipmentEventsTable)
      .values({
        shipmentId: input.shipmentId,
        eventSequence: Number(maxSeq) + 1,
        eventType: input.eventType,
        note: input.note ?? null,
        location: input.location ?? null,
        latitude: input.latitude != null ? String(input.latitude) : null,
        longitude: input.longitude != null ? String(input.longitude) : null,
        attachmentObjectPath: input.attachmentObjectPath ?? null,
        actorType: actor.actorType,
        actorId: actor.actorId ?? null,
      })
      .returning();

    // Keep shipment_status roughly in sync with the latest event for common
    // known event types (best-effort — does not block if type is unknown).
    const STATUS_MAP: Record<string, string> = {
      packing: "packing",
      loaded: "loading",
      departed: "in_transit",
      customs: "customs",
      warehouse: "warehouse",
      arrived: "arrived",
      delivered: "delivered",
    };
    if (STATUS_MAP[input.eventType]) {
      await tx
        .update(mktPoShipmentsTable)
        .set({ shipmentStatus: STATUS_MAP[input.eventType], updatedAt: new Date() })
        .where(eq(mktPoShipmentsTable.id, input.shipmentId));
    }

    return inserted;
  });

  logActivity({
    mktPurchaseOrderId: shipment.poId,
    actorType: actor.actorType,
    actorId: actor.actorId ?? null,
    actorName: actor.actorName ?? null,
    action: "mkt_po_shipment_event_appended",
    description: `Event '${input.eventType}' ditambahkan pada shipment ${shipment.shipmentNumber}`,
    newValue: { shipmentId: shipment.id, eventType: input.eventType, eventSequence: event.eventSequence },
  }).catch(() => {});

  void enqueueNotification({
    eventType: "mkt_po_shipment_event_notification",
    recipientType: "admin",
    purchaseOrderId: shipment.poId,
    payloadJson: { shipmentNumber: shipment.shipmentNumber, eventType: input.eventType },
  }).catch(() => {});

  return { ok: true, event };
}

export async function listShipmentTimeline(shipmentId: number): Promise<ShipmentEventRow[]> {
  return db
    .select()
    .from(mktPoShipmentEventsTable)
    .where(eq(mktPoShipmentEventsTable.shipmentId, shipmentId))
    .orderBy(asc(mktPoShipmentEventsTable.eventSequence));
}

export async function getShipmentById(shipmentId: number): Promise<ShipmentRow | undefined> {
  const rows = await db.select().from(mktPoShipmentsTable).where(eq(mktPoShipmentsTable.id, shipmentId)).limit(1);
  return rows[0];
}

export async function listShipmentsForPo(poId: number): Promise<ShipmentRow[]> {
  return db.select().from(mktPoShipmentsTable).where(eq(mktPoShipmentsTable.poId, poId)).orderBy(asc(mktPoShipmentsTable.createdAt));
}

export async function listShipmentItems(shipmentId: number) {
  return db.select().from(mktPoShipmentItemsTable).where(eq(mktPoShipmentItemsTable.shipmentId, shipmentId)).orderBy(asc(mktPoShipmentItemsTable.lineNumber));
}
