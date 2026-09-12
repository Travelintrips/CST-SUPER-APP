import {
  pgTable, serial, integer, text, timestamp, index,
} from "drizzle-orm/pg-core";
import { logisticOrdersTable } from "./logisticOrders";

export const orderStatusHistoryTable = pgTable("order_status_history", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  orderNumber: text("order_number"),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  changedByType: text("changed_by_type").notNull().default("admin"),
  // admin | vendor | customer | driver | system
  changedById: text("changed_by_id"),
  changedByName: text("changed_by_name"),
  changedByIp: text("changed_by_ip"),
  notes: text("notes"),
  source: text("source"),
  // route path / endpoint yang memicu perubahan
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("order_status_hist_order_idx").on(t.orderId),
  index("order_status_hist_new_status_idx").on(t.newStatus),
  index("order_status_hist_created_idx").on(t.createdAt),
]);

export type OrderStatusHistory = typeof orderStatusHistoryTable.$inferSelect;
export type InsertOrderStatusHistory = typeof orderStatusHistoryTable.$inferInsert;
