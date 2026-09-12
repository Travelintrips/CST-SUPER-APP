import { pgTable, serial, text, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktPurchaseOrdersTable } from "./mktPurchaseOrders";

// ── SCHEMA — Phase 2G: PO Fulfillment (Migration 0022) ───────────────────────
// Immutable snapshot of the winning quote's lines at the moment the PO is
// created. NOT editable after insert — mirrors the snapshot pattern already
// used for vendor/commercial terms on mkt_purchase_orders itself.

export const mktPurchaseOrderLinesTable = pgTable("mkt_purchase_order_lines", {
  id: serial("id").primaryKey(),
  poId: integer("po_id")
    .notNull()
    .references(() => mktPurchaseOrdersTable.id, { onDelete: "restrict" }),

  itemName:  text("item_name").notNull(),
  qty:       numeric("qty", { precision: 14, scale: 2 }).notNull(),
  unit:      text("unit"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  subtotal:  numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
  notes:     text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("mkt_po_lines_po_idx").on(t.poId),
]);

export const insertMktPurchaseOrderLineSchema = createInsertSchema(mktPurchaseOrderLinesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMktPurchaseOrderLine = z.infer<typeof insertMktPurchaseOrderLineSchema>;
export type MktPurchaseOrderLine = typeof mktPurchaseOrderLinesTable.$inferSelect;
