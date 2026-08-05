/**
 * mktNotificationQueue.ts — Phase 2E.1: Marketplace Notification Reliability Queue
 *
 * Tabel ini digunakan oleh marketplaceNotificationQueueService + marketplaceNotificationWorker
 * untuk menggantikan fire-and-forget WA langsung di vendorSelectionService dan
 * mengaktifkan WA invite yang sebelumnya hanya disiapkan tapi tidak pernah dikirim.
 *
 * Status: pending → sending → sent | failed → retrying → exhausted
 * Migration: 0021_mkt_notification_queue.sql
 */

import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

export const mktNotificationQueueTable = pgTable("mkt_notification_queue", {
  id:               serial("id").primaryKey(),
  eventType:        text("event_type").notNull(),
  channel:          text("channel").notNull().default("whatsapp"),
  recipientType:    text("recipient_type").notNull(),
  recipientId:      integer("recipient_id"),
  recipientPhone:   text("recipient_phone"),
  rfqId:            integer("rfq_id"),
  vendorQuoteId:    integer("vendor_quote_id"),
  purchaseOrderId:  integer("purchase_order_id"),
  payloadJson:      jsonb("payload_json").notNull().default({}),
  status:           text("status").notNull().default("pending"),
  attemptCount:     integer("attempt_count").notNull().default(0),
  maxAttempts:      integer("max_attempts").notNull().default(3),
  lastError:        text("last_error"),
  nextRetryAt:      timestamp("next_retry_at", { withTimezone: true }),
  sentAt:           timestamp("sent_at",        { withTimezone: true }),
  deduplicationKey: text("deduplication_key"),
  createdAt:        timestamp("created_at",     { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at",     { withTimezone: true }).notNull().defaultNow(),
});

export type MktNotificationQueueRow = typeof mktNotificationQueueTable.$inferSelect;
export type MktNotificationQueueInsert = typeof mktNotificationQueueTable.$inferInsert;
