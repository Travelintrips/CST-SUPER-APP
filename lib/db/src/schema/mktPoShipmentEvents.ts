import { pgTable, serial, text, integer, numeric, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktPoShipmentsTable } from "./mktPoShipments";

// ── SCHEMA — Phase 2G: PO Fulfillment (Migration 0022) ───────────────────────
// APPEND-ONLY timeline of shipment events (packing, loaded, departed, arrived,
// delivered, completed). The application layer MUST only ever INSERT into
// this table — never UPDATE or DELETE. event_sequence is assigned atomically
// by the service layer (MAX(event_sequence)+1 within a transaction) so the
// timeline stays consistent even if two events share the same timestamp.
//
// attachment_object_path stores a private ObjectStorageService path (reusing
// the existing storage mechanism), never a public URL.

export const mktPoShipmentEventsTable = pgTable("mkt_po_shipment_events", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id")
    .notNull()
    .references(() => mktPoShipmentsTable.id, { onDelete: "cascade" }),

  eventSequence: integer("event_sequence").notNull(),
  eventType:     text("event_type").notNull(), // packing | loaded | departed | arrived | delivered | completed
  note:          text("note"),
  location:      text("location"),
  latitude:      numeric("latitude", { precision: 10, scale: 7 }),
  longitude:     numeric("longitude", { precision: 10, scale: 7 }),
  attachmentObjectPath: text("attachment_object_path"),

  actorType: text("actor_type").notNull().default("vendor"), // vendor | admin | system
  actorId:   text("actor_id"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("mkt_po_shipment_events_shipment_idx").on(t.shipmentId),
  index("mkt_po_shipment_events_shipment_created_idx").on(t.shipmentId, t.createdAt),
  uniqueIndex("mkt_po_shipment_events_shipment_seq_unique").on(t.shipmentId, t.eventSequence),
]);

export const insertMktPoShipmentEventSchema = createInsertSchema(mktPoShipmentEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMktPoShipmentEvent = z.infer<typeof insertMktPoShipmentEventSchema>;
export type MktPoShipmentEvent = typeof mktPoShipmentEventsTable.$inferSelect;
