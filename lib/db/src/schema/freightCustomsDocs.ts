import { pgTable, serial, integer, text, date, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { freightShipmentsTable } from "./freightShipments";

export const freightCustomsDocsTable = pgTable("freight_customs_docs", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id")
    .references(() => freightShipmentsTable.id, { onDelete: "cascade" }),
  sourceModule: text("source_module"),
  sourceOrderId: integer("source_order_id"),
  docType: text("doc_type").notNull(),
  nomorAju: text("nomor_aju"),
  nomorDokumen: text("nomor_dokumen"),
  tanggalDokumen: date("tanggal_dokumen"),
  customsStatus: text("customs_status"),
  data: jsonb("data").default({}).$type<Record<string, unknown>>(),
  scanSource: text("scan_source").default("manual"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  shipmentIdx: index("fcd_shipment_idx").on(t.shipmentId),
  sourceIdx: index("fcd_source_idx").on(t.sourceModule, t.sourceOrderId),
}));

export type FreightCustomsDoc = typeof freightCustomsDocsTable.$inferSelect;
export type InsertFreightCustomsDoc = typeof freightCustomsDocsTable.$inferInsert;
