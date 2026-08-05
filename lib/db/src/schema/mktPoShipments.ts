import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktPurchaseOrdersTable } from "./mktPurchaseOrders";

// ── SCHEMA — Phase 2G: PO Fulfillment (Migration 0022) ───────────────────────
// Shipment is a standalone entity, parent of mkt_po_shipment_items and
// mkt_po_shipment_events. One PO can have multiple shipments (partial
// shipment, multi-container, multi-truck, multi-AWB/BL).
//
// shipment_status lifecycle (app-validated, not a pg enum — kept as free text
// like mkt_notification_queue.eventType so new statuses don't require
// ALTER TYPE later):
//   planned → packing → loading → ready_to_ship → in_transit → customs →
//   warehouse → arrived → delivered   (or → cancelled from any pre-delivered state)

export const mktPoShipmentsTable = pgTable("mkt_po_shipments", {
  id: serial("id").primaryKey(),
  poId: integer("po_id")
    .notNull()
    .references(() => mktPurchaseOrdersTable.id, { onDelete: "restrict" }),

  shipmentNumber: text("shipment_number").notNull().unique(), // format: MKT-SHP-YYYYMM-XXXX
  shipmentStatus: text("shipment_status").notNull().default("planned"),
  shipmentType:   text("shipment_type"), // trucking | sea_freight | air_freight | other

  carrierName:     text("carrier_name"),
  trackingNumber:  text("tracking_number"),
  vehicleType:     text("vehicle_type"),
  vehicleNumber:   text("vehicle_number"),
  driverName:      text("driver_name"),
  driverPhone:     text("driver_phone"),
  containerNumber: text("container_number"),
  sealNumber:      text("seal_number"),
  origin:          text("origin"),
  destination:     text("destination"),

  // Snapshot from mkt_purchase_orders.incotermSnapshot at shipment creation
  // time — NOT re-queried from vendor/quote later.
  incotermSnapshot: text("incoterm_snapshot"),

  plannedDeparture:  timestamp("planned_departure"),
  actualDeparture:   timestamp("actual_departure"),
  estimatedArrival:  timestamp("estimated_arrival"),
  actualArrival:     timestamp("actual_arrival"),

  notes:     text("notes"),
  createdBy: text("created_by"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("mkt_po_shipments_po_idx").on(t.poId),
  index("mkt_po_shipments_po_status_idx").on(t.poId, t.shipmentStatus),
]);

export const insertMktPoShipmentSchema = createInsertSchema(mktPoShipmentsTable).omit({
  id: true,
  shipmentNumber: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMktPoShipment = z.infer<typeof insertMktPoShipmentSchema>;
export type MktPoShipment = typeof mktPoShipmentsTable.$inferSelect;
