import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktPoShipmentsTable } from "./mktPoShipments";

// ── SCHEMA — Phase 2G: PO Fulfillment (Migration 0022) ───────────────────────
// Goods receipt header — one per receiving action against a shipment (a
// shipment can be received in multiple passes, e.g. partial receive).
// Detail lines (per shipment item, with condition/accepted/rejected qty)
// live in mkt_po_goods_receipt_items.

export const mktPoGoodsReceiptsTable = pgTable("mkt_po_goods_receipts", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id")
    .notNull()
    .references(() => mktPoShipmentsTable.id, { onDelete: "restrict" }),

  receiptNumber: text("receipt_number").notNull().unique(), // format: MKT-GR-YYYYMM-XXXX
  receiptType:   text("receipt_type").notNull(), // full | partial | rejected

  // Quality inspection status, kept separate from physical `condition` on
  // the item rows so QC workflow isn't conflated with physical condition.
  inspectionStatus: text("inspection_status").notNull().default("pending"), // pending | passed | failed

  receivedBy: text("received_by"),
  receivedAt: timestamp("received_at"), // physical receive time, separate from createdAt (system input time)
  notes:      text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("mkt_po_goods_receipts_shipment_idx").on(t.shipmentId),
]);

export const insertMktPoGoodsReceiptSchema = createInsertSchema(mktPoGoodsReceiptsTable).omit({
  id: true,
  receiptNumber: true,
  createdAt: true,
});

export type InsertMktPoGoodsReceipt = z.infer<typeof insertMktPoGoodsReceiptSchema>;
export type MktPoGoodsReceipt = typeof mktPoGoodsReceiptsTable.$inferSelect;
