import { pgTable, serial, text, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktPoShipmentsTable } from "./mktPoShipments";
import { mktPurchaseOrderLinesTable } from "./mktPurchaseOrderLines";

// ── SCHEMA — Phase 2G: PO Fulfillment (Migration 0022) ───────────────────────
// Links a shipment to the portion of a PO line it carries. One shipment can
// carry a partial quantity of one or more PO lines.

export const mktPoShipmentItemsTable = pgTable("mkt_po_shipment_items", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id")
    .notNull()
    .references(() => mktPoShipmentsTable.id, { onDelete: "cascade" }),
  poLineId: integer("po_line_id")
    .notNull()
    .references(() => mktPurchaseOrderLinesTable.id, { onDelete: "restrict" }),

  lineNumber:   integer("line_number").notNull(), // consistent display order within the shipment
  qty:          numeric("qty", { precision: 14, scale: 2 }).notNull(),
  uom:          text("uom"), // snapshot from PO line's unit
  weight:       numeric("weight", { precision: 12, scale: 3 }),
  volume:       numeric("volume", { precision: 12, scale: 3 }),
  packageCount: integer("package_count"),
  remarks:      text("remarks"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("mkt_po_shipment_items_shipment_idx").on(t.shipmentId),
  index("mkt_po_shipment_items_po_line_idx").on(t.poLineId),
]);

export const insertMktPoShipmentItemSchema = createInsertSchema(mktPoShipmentItemsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMktPoShipmentItem = z.infer<typeof insertMktPoShipmentItemSchema>;
export type MktPoShipmentItem = typeof mktPoShipmentItemsTable.$inferSelect;
