import {
  pgTable, serial, integer, text, timestamp, index,
} from "drizzle-orm/pg-core";
import { logisticOrdersTable } from "./logisticOrders";

export const customerApprovalHistoryTable = pgTable("customer_approval_history", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  orderNumber: text("order_number"),
  rfqId: integer("rfq_id"),
  eventType: text("event_type").notNull(),
  // quotation_sent | quotation_opened | quotation_approved | quotation_revision_requested
  // quotation_rejected | order_confirmed | order_cancelled | quote_link_created
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  tokenUsed: text("token_used"),
  response: text("response"),
  // approve | revise | reject
  revisionNotes: text("revision_notes"),
  rejectionReason: text("rejection_reason"),
  actorType: text("actor_type").notNull().default("customer"),
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("customer_approval_hist_order_idx").on(t.orderId),
  index("customer_approval_hist_event_idx").on(t.eventType),
  index("customer_approval_hist_created_idx").on(t.createdAt),
]);

export type CustomerApprovalHistory = typeof customerApprovalHistoryTable.$inferSelect;
export type InsertCustomerApprovalHistory = typeof customerApprovalHistoryTable.$inferInsert;
