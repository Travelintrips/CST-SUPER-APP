import {
  pgTable, serial, integer, text, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { logisticOrdersTable } from "./logisticOrders";

export const orderAuditLogsTable = pgTable("order_audit_logs", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  orderNumber: text("order_number"),
  rfqId: integer("rfq_id"),
  actorType: text("actor_type").notNull().default("admin"),
  // admin | vendor | customer | driver | system
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  action: text("action").notNull(),
  // order_created | status_changed | rfq_sent | vendor_confirmed | vendor_rejected
  // vendor_selected | customer_quoted | customer_approved | customer_rejected
  // customer_revision_requested | so_created | driver_assigned | pod_submitted
  // note_added | details_updated | cancelled | completed
  description: text("description"),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("order_audit_logs_order_idx").on(t.orderId),
  index("order_audit_logs_rfq_idx").on(t.rfqId),
  index("order_audit_logs_action_idx").on(t.action),
  index("order_audit_logs_created_idx").on(t.createdAt),
]);

export type OrderAuditLog = typeof orderAuditLogsTable.$inferSelect;
export type InsertOrderAuditLog = typeof orderAuditLogsTable.$inferInsert;
