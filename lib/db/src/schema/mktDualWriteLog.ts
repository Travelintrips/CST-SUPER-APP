/**
 * mktDualWriteLog.ts — Phase 2A.2: Drizzle schema untuk dual write reliability log
 *
 * ENUM: mkt_dual_write_status
 *   pending   → entri baru dibuat, belum ada hasil
 *   success   → mkt_ write berhasil, menunggu portal order backlink
 *   linked    → fully reconciled (mkt_ + portal order keduanya tercatat)
 *   failed    → mkt_ write gagal, masuk retry queue
 *   retrying  → sedang diproses oleh retry worker
 *   exhausted → gagal setelah MAX_RETRY kali — butuh manual recovery
 *
 * RETENTION POLICY (dokumentasi — belum di-enforce via DB):
 *   success/linked  → archive setelah 90 hari
 *   failed          → simpan minimum 1 tahun
 *   exhausted       → simpan sampai diselesaikan manual (resolution IS NOT NULL)
 *
 * TABLE: mkt_dual_write_log
 *   Kolom terstruktur (buyer_name, buyer_email, buyer_company, qty, unit, shipping_address)
 *   dipisahkan dari payload JSONB untuk efisiensi query dashboard.
 *   payload JSONB menyimpan snapshot lengkap CreateMktRfqOptions untuk kebutuhan retry.
 *   retry_started_at dan retry_completed_at dipakai untuk menghitung average_retry_duration.
 *
 * MIGRATION: lib/db/drizzle/0014_mkt_dual_write_log.sql
 */

import {
  pgTable,
  bigserial,
  integer,
  text,
  numeric,
  jsonb,
  boolean,
  timestamp,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Enum ──────────────────────────────────────────────────────────────────────

export const mktDualWriteStatusEnum = pgEnum("mkt_dual_write_status", [
  "pending",
  "success",
  "linked",
  "failed",
  "retrying",
  "exhausted",
]);

export type MktDualWriteStatus = (typeof mktDualWriteStatusEnum.enumValues)[number];

// ── Table ─────────────────────────────────────────────────────────────────────

export const mktDualWriteLogTable = pgTable(
  "mkt_dual_write_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    // ── Structured fields (fast dashboard queries, diambil dari opts saat log dibuat)
    catalogItemId:   integer("catalog_item_id").notNull(),
    buyerName:       text("buyer_name").notNull().default(""),
    buyerEmail:      text("buyer_email").notNull(),
    buyerCompany:    text("buyer_company"),
    qty:             numeric("qty", { precision: 10, scale: 2 }).notNull().default("1"),
    unit:            text("unit").notNull().default("unit"),
    shippingAddress: text("shipping_address"),

    // ── Full snapshot for retry (tidak re-fetch catalog saat retry)
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    // Stable logical-request identity. NULL is retained for legacy rows.
    idempotencyKey: text("idempotency_key"),

    // ── State machine
    status:    mktDualWriteStatusEnum("status").notNull().default("pending"),
    attempt:   integer("attempt").notNull().default(0),
    lastError: text("last_error"),

    // ── New pipeline result (set saat success)
    mktRfqId:     integer("mkt_rfq_id"),
    mktRfqNumber: text("mkt_rfq_number"),

    // ── Legacy backlink (set oleh linkLegacyOrder)
    portalOrderId:     integer("portal_order_id"),
    portalOrderNumber: text("portal_order_number"),

    // ── Timestamps
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastRetryAt: timestamp("last_retry_at", { withTimezone: true }),
    resolvedAt:  timestamp("resolved_at", { withTimezone: true }),

    // ── Retry timing (untuk average_retry_duration metric)
    retryStartedAt:   timestamp("retry_started_at", { withTimezone: true }),
    retryCompletedAt: timestamp("retry_completed_at", { withTimezone: true }),

    // ── Resolution label
    resolution: text("resolution"), // AUTO_SUCCESS | AUTO_RETRIED | MANUAL_RECOVERY | EXHAUSTED
  },
  (t) => [
    index("mdwl_status_idx").on(t.status),
    index("mdwl_mkt_rfq_id_idx").on(t.mktRfqId),
    index("mdwl_created_at_idx").on(t.createdAt),
    index("mdwl_portal_order_id_idx").on(t.portalOrderId),
    index("mdwl_buyer_email_idx").on(t.buyerEmail),
    index("mdwl_idempotency_key_idx").on(t.idempotencyKey),
  ],
);

// ── Zod schema ────────────────────────────────────────────────────────────────

export const insertMktDualWriteLogSchema = createInsertSchema(mktDualWriteLogTable, {
  qty: z.union([z.string(), z.number()]).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMktDualWriteLog = z.infer<typeof insertMktDualWriteLogSchema>;
export type MktDualWriteLog = typeof mktDualWriteLogTable.$inferSelect;
