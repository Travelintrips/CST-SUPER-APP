import {
  pgTable, serial, integer, text, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";

/**
 * admin_notifications
 * Drizzle schema for the table that adminNotificationsMigration.ts creates via raw SQL.
 * Both co-exist safely: the boot migration uses CREATE TABLE IF NOT EXISTS so
 * re-running after a Drizzle push is a no-op.
 */
export const adminNotificationsTable = pgTable("admin_notifications", {
  id:           serial("id").primaryKey(),
  type:         text("type").notNull(),
  orderId:      integer("order_id"),
  orderNumber:  text("order_number").notNull(),
  customerName: text("customer_name").notNull(),
  companyName:  text("company_name"),
  payload:      jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  title:        text("title").notNull().default(""),
  body:         text("body").notNull().default(""),
  dedupeKey:    text("dedupe_key"),
  readAt:       timestamp("read_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("admin_notif_type_idx").on(t.type),
  index("admin_notif_read_idx").on(t.readAt),
  index("admin_notif_created_idx").on(t.createdAt),
]);

export type AdminNotification       = typeof adminNotificationsTable.$inferSelect;
export type InsertAdminNotification = typeof adminNotificationsTable.$inferInsert;
