import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { freightShipmentsTable } from "./freightShipments";

export const freightShipmentAuditLogsTable = pgTable("freight_shipment_audit_logs", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id")
    .notNull()
    .references(() => freightShipmentsTable.id, { onDelete: "cascade" }),
  shipmentNumber: text("shipment_number").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  changedBy: text("changed_by").notNull(),
  changedById: text("changed_by_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type FreightShipmentAuditLog = typeof freightShipmentAuditLogsTable.$inferSelect;
