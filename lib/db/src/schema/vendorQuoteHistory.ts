import {
  pgTable, serial, integer, text, numeric, timestamp, index,
} from "drizzle-orm/pg-core";
import { logisticOrdersTable, logisticOrderRfqsTable } from "./logisticOrders";
import { suppliersTable } from "./suppliers";

export const vendorQuoteHistoryTable = pgTable("vendor_quote_history", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  orderNumber: text("order_number"),
  rfqId: integer("rfq_id").references(() => logisticOrderRfqsTable.id, { onDelete: "set null" }),
  rfqNumber: text("rfq_number"),
  vendorId: integer("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  vendorName: text("vendor_name"),
  eventType: text("event_type").notNull(),
  // rfq_blasted | quote_submitted | quote_revised | quote_approved | quote_rejected
  // quote_expired | vendor_selected | vendor_not_selected | vendor_confirmed | vendor_rejected
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  oldPrice: numeric("old_price", { precision: 14, scale: 2 }),
  newPrice: numeric("new_price", { precision: 14, scale: 2 }),
  changedByType: text("changed_by_type").notNull().default("system"),
  changedById: text("changed_by_id"),
  changedByName: text("changed_by_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("vendor_quote_hist_order_idx").on(t.orderId),
  index("vendor_quote_hist_rfq_idx").on(t.rfqId),
  index("vendor_quote_hist_vendor_idx").on(t.vendorId),
  index("vendor_quote_hist_event_idx").on(t.eventType),
  index("vendor_quote_hist_created_idx").on(t.createdAt),
]);

export type VendorQuoteHistory = typeof vendorQuoteHistoryTable.$inferSelect;
export type InsertVendorQuoteHistory = typeof vendorQuoteHistoryTable.$inferInsert;
