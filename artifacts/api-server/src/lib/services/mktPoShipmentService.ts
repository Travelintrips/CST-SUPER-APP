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
import { eq, and, asc, desc, sql, inArray } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";
import { logger } from "../logger.js";
import type { ActorInfo } from "./mktPoLifecycleService.js";
import { findPoByVendorToken, type TokenLookupFailure } from "./mktVendorPoTokenService.js";

type PoRow = typeof mktPurchaseOrdersTable.$inferSelect;
type ShipmentRow = typeof mktPoShipmentsTable.$inferSelect;
type ShipmentEventRow = typeof mktPoShipmentEventsTable.$inferSelect;

const SHIPMENT_ELIGIBLE_PO_STATUSES: PoRow["status"][] = ["production", "ready_to_ship", "in_transit"];
const VENDOR_SHIPMENT_ELIGIBLE_PO_STATUSES: PoRow["status"][] = [
  "vendor_accepted",
  "production",
  "ready_to_ship",
  "in_transit",
];

const SHIPMENT_STATUS_MAP: Record<string, string> = {
  packing: "packing",
  loaded: "loading",
  departed: "in_transit",
  customs: "customs",
  warehouse: "warehouse",
  arrived: "arrived",
  delivered: "delivered",
};

const SHIPMENT_EVENT_ALLOWED_FROM: Record<string, string[]> = {
  packing: ["planned"],
  loaded: ["packing"],
  // Existing admin flow historically allowed packing → departed directly;
  // keep that path while also supporting the explicit pickup/loaded step.
  departed: ["packing", "loading", "ready_to_ship"],
  customs: ["in_transit"],
  warehouse: ["customs"],
  arrived: ["warehouse", "customs", "in_transit"],
  delivered: ["in_transit", "arrived", "warehouse"],
  completed: ["delivered"],
  cancelled: ["planned", "packing", "loading", "ready_to_ship", "in_transit", "customs", "warehouse", "arrived"],
};

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
  | {
      ok: true;
      shipment: ShipmentRow;
      items: (typeof mktPoShipmentItemsTable.$inferSelect)[];
      alreadyExists?: boolean;
    }
  | {
      ok: false;
      code: "PO_NOT_FOUND" | "PO_NOT_ELIGIBLE" | "NO_ITEMS" | "INVALID_PO_LINE" | "DUPLICATE_PO_LINE";
      message?: string;
    };

interface CreateShipmentOptions {
  eligiblePoStatuses?: PoRow["status"][];
  vendorId?: number;
  reuseExisting?: boolean;
}

async function createShipmentInternal(
  input: CreateShipmentInput,
  actor: ActorInfo,
  options: CreateShipmentOptions = {},
): Promise<CreateShipmentResult> {
  if (!input.items || input.items.length === 0) {
    return { ok: false, code: "NO_ITEMS", message: "Shipment harus punya minimal 1 item" };
  }

  const lineIds = input.items.map((i) => i.poLineId);
  if (new Set(lineIds).size !== lineIds.length) {
    return { ok: false, code: "DUPLICATE_PO_LINE", message: "Satu PO line tidak boleh dicantumkan dua kali dalam shipment" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Lock the PO for the complete validation + insert sequence. This makes
      // vendor retries and concurrent shipment creation deterministic.
      const [po] = await tx
        .select()
        .from(mktPurchaseOrdersTable)
        .where(eq(mktPurchaseOrdersTable.id, input.poId))
        .for("update")
        .limit(1);
      if (!po) return { kind: "failure" as const, result: { ok: false as const, code: "PO_NOT_FOUND" as const } };

      const eligibleStatuses = options.eligiblePoStatuses ?? SHIPMENT_ELIGIBLE_PO_STATUSES;
      if (!eligibleStatuses.includes(po.status)) {
        return {
          kind: "failure" as const,
          result: {
            ok: false as const,
            code: "PO_NOT_ELIGIBLE" as const,
            message: `PO berstatus '${po.status}', tidak eligible untuk shipment`,
          },
        };
      }
      if (options.vendorId !== undefined && po.vendorId !== options.vendorId) {
        // Do not reveal whether a PO belonging to another vendor exists.
        return { kind: "failure" as const, result: { ok: false as const, code: "PO_NOT_FOUND" as const } };
      }

      if (options.reuseExisting) {
        const [existing] = await tx
          .select()
          .from(mktPoShipmentsTable)
          .where(and(
            eq(mktPoShipmentsTable.poId, input.poId),
            sql`${mktPoShipmentsTable.shipmentStatus} <> 'cancelled'`,
          ))
          .orderBy(desc(mktPoShipmentsTable.createdAt))
          .limit(1);
        if (existing) {
          const existingItems = await tx
            .select()
            .from(mktPoShipmentItemsTable)
            .where(eq(mktPoShipmentItemsTable.shipmentId, existing.id))
            .orderBy(asc(mktPoShipmentItemsTable.lineNumber));
          return {
            kind: "success" as const,
            po,
            shipment: existing,
            items: existingItems,
            alreadyExists: true,
          };
        }
      }

      // Validate every referenced po_line actually belongs to this PO while
      // the parent PO lock is held.
      const validLines = await tx
        .select({ id: mktPurchaseOrderLinesTable.id })
        .from(mktPurchaseOrderLinesTable)
        .where(and(eq(mktPurchaseOrderLinesTable.poId, input.poId), inArray(mktPurchaseOrderLinesTable.id, lineIds)));
      const validLineIdSet = new Set(validLines.map((l) => l.id));
      const invalid = lineIds.find((id) => !validLineIdSet.has(id));
      if (invalid !== undefined) {
        return {
          kind: "failure" as const,
          result: {
            ok: false as const,
            code: "INVALID_PO_LINE" as const,
            message: `po_line_id ${invalid} tidak ditemukan pada PO ini`,
          },
        };
      }

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

      return { kind: "success" as const, po, shipment, items: itemRows, alreadyExists: false };
    });

    if (result.kind === "failure") return result.result;

    logActivity({
      mktPurchaseOrderId: input.poId,
      actorType: actor.actorType,
      actorId: actor.actorId ?? null,
      actorName: actor.actorName ?? null,
      action: "mkt_po_shipment_created",
      description: `Shipment ${result.shipment.shipmentNumber} dibuat untuk PO ${result.po.poNumber}`,
      newValue: { shipmentId: result.shipment.id, shipmentNumber: result.shipment.shipmentNumber, itemCount: result.items.length, alreadyExists: result.alreadyExists },
    }).catch(() => {});

    if (!result.alreadyExists) {
      void enqueueNotification({
        eventType: "mkt_po_shipment_created_notification",
        recipientType: "vendor",
        recipientId: result.po.vendorId,
        purchaseOrderId: result.po.id,
        payloadJson: { poNumber: result.po.poNumber, shipmentNumber: result.shipment.shipmentNumber },
        deduplicationKey: `mkt_po_shipment_created:${result.shipment.id}`,
      }).catch(() => {});
    }

    return { ok: true, shipment: result.shipment, items: result.items, alreadyExists: result.alreadyExists };
  } catch (err) {
    logger.warn({ err, poId: input.poId }, "[mktPoShipment] createShipment gagal");
    throw err;
  }
}

export async function createShipment(input: CreateShipmentInput, actor: ActorInfo): Promise<CreateShipmentResult> {
  return createShipmentInternal(input, actor);
}

export type VendorCreateShipmentResult =
  | ({ ok: true; shipment: ShipmentRow; items: (typeof mktPoShipmentItemsTable.$inferSelect)[]; alreadyExists?: boolean })
  | ({ ok: false; code: TokenLookupFailure } & Partial<Pick<Extract<CreateShipmentResult, { ok: false }>, "message">>)
  | Extract<CreateShipmentResult, { ok: false }>;

/** Vendor-token shipment initiation. The token, not request-body vendorId, is the authority. */
export async function createShipmentForVendor(token: string, input: Omit<CreateShipmentInput, "poId">): Promise<VendorCreateShipmentResult> {
  const lookup = await findPoByVendorToken(token);
  if (!lookup.ok) return lookup;

  return createShipmentInternal(
    { ...input, poId: lookup.po.id },
    {
      actorType: "vendor",
      actorId: `vendor:${lookup.po.vendorId}`,
      actorName: lookup.po.vendorNameSnapshot,
    },
    {
      eligiblePoStatuses: VENDOR_SHIPMENT_ELIGIBLE_PO_STATUSES,
      vendorId: lookup.po.vendorId,
      reuseExisting: true,
    },
  );
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
  | { ok: true; event: ShipmentEventRow; alreadyAppended?: boolean }
  | { ok: false; code: "SHIPMENT_NOT_FOUND" | "INVALID_TRANSITION"; currentStatus?: string };

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

  const result = await db.transaction(async (tx) => {
    // Serialize event appends per shipment. MAX(sequence)+1 alone is not
    // sufficient when two requests arrive at the same time.
    const [lockedShipment] = await tx
      .select()
      .from(mktPoShipmentsTable)
      .where(eq(mktPoShipmentsTable.id, input.shipmentId))
      .for("update")
      .limit(1);
    if (!lockedShipment) return { kind: "failure" as const, result: { ok: false as const, code: "SHIPMENT_NOT_FOUND" as const } };

    const [latest] = await tx
      .select()
      .from(mktPoShipmentEventsTable)
      .where(eq(mktPoShipmentEventsTable.shipmentId, input.shipmentId))
      .orderBy(desc(mktPoShipmentEventsTable.eventSequence))
      .limit(1);
    if (latest?.eventType === input.eventType) {
      return { kind: "success" as const, event: latest, alreadyAppended: true };
    }

    const allowedFrom = SHIPMENT_EVENT_ALLOWED_FROM[input.eventType];
    if (allowedFrom && !allowedFrom.includes(lockedShipment.shipmentStatus)) {
      return {
        kind: "failure" as const,
        result: { ok: false as const, code: "INVALID_TRANSITION" as const, currentStatus: lockedShipment.shipmentStatus },
      };
    }

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

    if (SHIPMENT_STATUS_MAP[input.eventType]) {
      const timestampFields: Partial<typeof mktPoShipmentsTable.$inferInsert> =
        input.eventType === "departed"
          ? { actualDeparture: new Date() }
          : (input.eventType === "arrived" || input.eventType === "delivered")
            ? { actualArrival: new Date() }
            : {};
      await tx
        .update(mktPoShipmentsTable)
        .set({ shipmentStatus: SHIPMENT_STATUS_MAP[input.eventType], updatedAt: new Date(), ...timestampFields })
        .where(eq(mktPoShipmentsTable.id, input.shipmentId));
    }

    return { kind: "success" as const, event: inserted, alreadyAppended: false };
  });

  if (result.kind === "failure") return result.result;
  const event = result.event;

  logActivity({
    mktPurchaseOrderId: shipment.poId,
    actorType: actor.actorType,
    actorId: actor.actorId ?? null,
    actorName: actor.actorName ?? null,
    action: "mkt_po_shipment_event_appended",
    description: `Event '${input.eventType}' ditambahkan pada shipment ${shipment.shipmentNumber}`,
    newValue: { shipmentId: shipment.id, eventType: input.eventType, eventSequence: event.eventSequence },
  }).catch(() => {});

  if (!result.alreadyAppended) {
    void enqueueNotification({
      eventType: "mkt_po_shipment_event_notification",
      recipientType: "admin",
      purchaseOrderId: shipment.poId,
      payloadJson: { shipmentNumber: shipment.shipmentNumber, eventType: input.eventType },
      deduplicationKey: `mkt_po_shipment_event:${shipment.id}:${event.eventSequence}`,
    }).catch(() => {});
  }

  return { ok: true, event, alreadyAppended: result.alreadyAppended };
}

export type VendorShipmentEventResult =
  | AppendShipmentEventResult
  | { ok: false; code: TokenLookupFailure };

/** Append only the shipment belonging to the PO resolved by the vendor token. */
export async function appendShipmentEventForVendor(
  token: string,
  input: AppendShipmentEventInput,
): Promise<VendorShipmentEventResult> {
  const lookup = await findPoByVendorToken(token);
  if (!lookup.ok) return lookup;

  const [shipment] = await db
    .select({ id: mktPoShipmentsTable.id, poId: mktPoShipmentsTable.poId })
    .from(mktPoShipmentsTable)
    .where(eq(mktPoShipmentsTable.id, input.shipmentId))
    .limit(1);
  if (!shipment || shipment.poId !== lookup.po.id) {
    return { ok: false, code: "SHIPMENT_NOT_FOUND" };
  }

  return appendShipmentEvent(input, {
    actorType: "vendor",
    actorId: `vendor:${lookup.po.vendorId}`,
    actorName: lookup.po.vendorNameSnapshot,
  });
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
