import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { mktRfqsTable } from "./mktRfqs";
import { mktVendorQuotesTable } from "./mktVendorQuotes";
import { mktPurchaseOrdersTable } from "./mktPurchaseOrders";

export const activityLogsTable = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id"),
  orderId: integer("order_id"),
  actorType: text("actor_type").notNull().default("admin"),
  // admin | vendor | customer | driver | system
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  action: text("action").notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  description: text("description"),
  ipAddress: text("ip_address"),
  // Marketplace audit trail — Added Phase 1C (2026-07-02), Group D migration
  mktRfqId: integer("mkt_rfq_id").references(() => mktRfqsTable.id, { onDelete: "set null" }),
  mktVendorQuoteId: integer("mkt_vendor_quote_id").references(() => mktVendorQuotesTable.id, { onDelete: "set null" }),
  mktPurchaseOrderId: integer("mkt_purchase_order_id").references(() => mktPurchaseOrdersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ActivityLog = typeof activityLogsTable.$inferSelect;
export type InsertActivityLog = typeof activityLogsTable.$inferInsert;
