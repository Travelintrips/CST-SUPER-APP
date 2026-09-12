import {
  pgTable, serial, integer, text, boolean, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { portalCustomersTable } from "./portalCustomers";

/**
 * vendor_notifications
 * Per-vendor in-app notification store.
 * Written by VendorNotificationService; read by GET /api/portal/vendor/notifications.
 */
export const vendorNotificationsTable = pgTable("vendor_notifications", {
  id:         serial("id").primaryKey(),
  /** portal_customers.id of the vendor whose notification this is */
  vendorId:   integer("vendor_id")
                .references(() => portalCustomersTable.id, { onDelete: "cascade" })
                .notNull(),
  /** Discriminator: vendor_approved | product_approved | product_rejected */
  type:       text("type").notNull(),
  title:      text("title").notNull(),
  message:    text("message").notNull(),
  payload:    jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  isRead:     boolean("is_read").notNull().default(false),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
  readAt:     timestamp("read_at"),
}, (t) => [
  index("vn_vendor_idx").on(t.vendorId),
  index("vn_is_read_idx").on(t.isRead),
  index("vn_created_idx").on(t.createdAt),
]);

export type VendorNotification       = typeof vendorNotificationsTable.$inferSelect;
export type InsertVendorNotification = typeof vendorNotificationsTable.$inferInsert;
