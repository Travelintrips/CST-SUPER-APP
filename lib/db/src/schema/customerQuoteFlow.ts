import {
  pgTable, serial, integer, text, numeric, timestamp, boolean, jsonb,
} from "drizzle-orm/pg-core";
import { logisticOrdersTable, logisticOrderRfqsTable } from "./logisticOrders";
import { suppliersTable } from "./suppliers";

export const customerQuoteLinksTable = pgTable("customer_quote_links", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id").references(() => logisticOrderRfqsTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("pending"),
  // pending | approved | revision_requested | rejected | expired
  etaFinal: text("eta_final"),
  termsConditions: text("terms_conditions"),
  quoteNotes: text("quote_notes"),
  finalCustomerPrice: numeric("final_customer_price", { precision: 14, scale: 2 }),
  vendorCost: numeric("vendor_cost", { precision: 14, scale: 2 }),
  margin: numeric("margin", { precision: 14, scale: 2 }),
  validUntil: timestamp("valid_until"),
  openedAt: timestamp("opened_at"),
  respondedAt: timestamp("responded_at"),
  sentAt: timestamp("sent_at").defaultNow(),
  quotationPdfUrl: text("quotation_pdf_url"),
  quotationNumber: text("quotation_number"),
  categoryKey: text("category_key"),
  templateId: text("template_id"),
  templateVersion: text("template_version"),
  templateSnapshot: jsonb("template_snapshot").$type<Record<string, unknown> | null>(),
  // ── Media Foundation ──────────────────────────────────────────────────────
  mediaAssets: jsonb("media_assets").$type<Record<string, unknown>[]>().notNull().default([]),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customerQuoteResponsesTable = pgTable("customer_quote_responses", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id"),
  orderId: integer("order_id").references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  response: text("response").notNull(), // approve | revise | reject
  revisionNotes: text("revision_notes"),
  rejectionReason: text("rejection_reason"),
  respondedAt: timestamp("responded_at").defaultNow().notNull(),
});

export const orderTaskLinksTable = pgTable("order_task_links", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  driverId: integer("driver_id"),
  token: text("token").notNull().unique(),
  roleType: text("role_type").notNull().default("vendor"), // vendor | driver | staff
  label: text("label"),
  status: text("status").notNull().default("active"),
  expiredAt: timestamp("expired_at"),
  revokedAt: timestamp("revoked_at"),
  openedAt: timestamp("opened_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orderUpdatesTable = pgTable("order_updates", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  actorType: text("actor_type").notNull().default("admin"), // admin | vendor | driver | system | customer
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  status: text("status"),
  notes: text("notes"),
  attachmentUrl: text("attachment_url"),
  isPublic: boolean("is_public").notNull().default(false), // visible to customer tracking
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customerOrderLinksTable = pgTable("customer_order_links", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CustomerQuoteLink = typeof customerQuoteLinksTable.$inferSelect;
export type OrderTaskLink = typeof orderTaskLinksTable.$inferSelect;
export type OrderUpdate = typeof orderUpdatesTable.$inferSelect;
export type CustomerOrderLink = typeof customerOrderLinksTable.$inferSelect;
