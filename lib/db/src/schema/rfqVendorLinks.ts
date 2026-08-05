import {
  pgTable, serial, integer, text, numeric, boolean, timestamp,
} from "drizzle-orm/pg-core";
import { logisticOrderRfqsTable } from "./logisticOrders";
import { suppliersTable } from "./suppliers";

export const rfqVendorLinksTable = pgTable("rfq_vendor_links", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id").notNull().references(() => logisticOrderRfqsTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  tokenHash: text("token_hash"),            // P0.1 — HMAC-SHA256 of raw token
  status: text("status").notNull().default("waiting_response"),
  // waiting_response | accepted_basic_price | counter_offer | rejected
  // expired | selected | not_selected | late_response
  basicPrice: numeric("basic_price", { precision: 14, scale: 2 }),
  offeredPrice: numeric("offered_price", { precision: 14, scale: 2 }),
  eta: text("eta"),
  notes: text("notes"),
  attachmentUrl: text("attachment_url"),
  leadTimeDays: integer("lead_time_days"),
  stockAvailability: text("stock_availability").default("unknown"),
  isNewUpdate: boolean("is_new_update").notNull().default(false),
  openedAt: timestamp("opened_at"),
  submittedAt: timestamp("submitted_at"),
  lastUpdatedAt: timestamp("last_updated_at"),
  expiredAt: timestamp("expired_at"),
  // ── Phase 2A: Product-First Flow ──────────────────────────────────────────
  rfqType: text("rfq_type"),
  pickupAddress: text("pickup_address"),
  readyDate: text("ready_date"),
  qtyConfirmed: numeric("qty_confirmed", { precision: 12, scale: 3 }),
  qtyUnit: text("qty_unit"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const rfqActivityLogsTable = pgTable("rfq_activity_logs", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  action: text("action").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RfqVendorLink = typeof rfqVendorLinksTable.$inferSelect;
export type InsertRfqVendorLink = typeof rfqVendorLinksTable.$inferInsert;
export type RfqActivityLog = typeof rfqActivityLogsTable.$inferSelect;
