import { pgTable, serial, text, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktPoGoodsReceiptsTable } from "./mktPoGoodsReceipts";
import { mktPoShipmentItemsTable } from "./mktPoShipmentItems";

// ── SCHEMA — Phase 2G: PO Fulfillment (Migration 0022) ───────────────────────
// Goods receipt detail — per shipment item, with quality condition and
// accepted/rejected quantity breakdown (received goods are not necessarily
// all quality-accepted).
//
// App-layer validation (not a DB CHECK constraint, to keep manual admin
// overrides possible): accepted_qty + rejected_qty = received_qty.

export const mktPoGoodsReceiptItemsTable = pgTable("mkt_po_goods_receipt_items", {
  id: serial("id").primaryKey(),
  goodsReceiptId: integer("goods_receipt_id")
    .notNull()
    .references(() => mktPoGoodsReceiptsTable.id, { onDelete: "cascade" }),
  shipmentItemId: integer("shipment_item_id")
    .notNull()
    .references(() => mktPoShipmentItemsTable.id, { onDelete: "restrict" }),

  receivedQty: numeric("received_qty", { precision: 14, scale: 2 }).notNull(),
  acceptedQty: numeric("accepted_qty", { precision: 14, scale: 2 }).notNull().default("0"),
  rejectedQty: numeric("rejected_qty", { precision: 14, scale: 2 }).notNull().default("0"),
  condition:   text("condition").notNull().default("GOOD"), // GOOD | DAMAGED | SHORTAGE | REJECTED
  notes:       text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("mkt_po_goods_receipt_items_receipt_idx").on(t.goodsReceiptId),
  index("mkt_po_goods_receipt_items_shipment_item_idx").on(t.shipmentItemId),
]);

export const insertMktPoGoodsReceiptItemSchema = createInsertSchema(mktPoGoodsReceiptItemsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMktPoGoodsReceiptItem = z.infer<typeof insertMktPoGoodsReceiptItemSchema>;
export type MktPoGoodsReceiptItem = typeof mktPoGoodsReceiptItemsTable.$inferSelect;
