import { pgTable, serial, text, integer, date, numeric, timestamp, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktRfqsTable } from "./mktRfqs";
import { mktVendorQuotesTable } from "./mktVendorQuotes";
import { companiesTable } from "./companies";
import { suppliersTable } from "./suppliers";
import { salesDocumentsTable } from "./salesDocuments";

// ── SCHEMA — Enterprise Marketplace Blueprint v1.1.1, Section 6.5 ────────────
// MIGRATED — Phase 1C (2026-07-02). Table exists in Supabase production.
// KEPUTUSAN #1 — PO marketplace terpisah dari purchase_documents ERP existing.
//
// Phase 2E additions (additive only):
//   - UNIQUE constraint on rfq_id  (migration 0018 — mkt_po_rfq_unique)
//   - UNIQUE constraint on quote_id (migration 0018 — mkt_po_quote_unique)
//   - 8 snapshot immutable columns (vendor name, address, commercial terms)

// Phase 2G additions (additive only — migration 0022_mkt_po_fulfillment.sql):
//   issued, vendor_accepted, revision_requested, vendor_rejected, production,
//   ready_to_ship, in_transit, partially_delivered, closed, rejected_goods.
// Existing values (pending, confirmed, in_progress, delivered, completed,
// cancelled) are preserved — old rows are not touched or backfilled.
export const mktPoStatusEnum = pgEnum("mkt_po_status", [
  "pending",
  "confirmed",
  "in_progress",
  "delivered",
  "completed",
  "cancelled",
  "issued",
  "vendor_accepted",
  "revision_requested",
  "vendor_rejected",
  "production",
  "ready_to_ship",
  "in_transit",
  "partially_delivered",
  "closed",
  "rejected_goods",
]);

export const mktPurchaseOrdersTable = pgTable("mkt_purchase_orders", {
  id: serial("id").primaryKey(),
  poNumber: text("po_number").notNull().unique(), // format: MKT-PO-YYYYMM-XXXX

  rfqId: integer("rfq_id")
    .notNull()
    .references(() => mktRfqsTable.id, { onDelete: "restrict" }),
  quoteId: integer("quote_id")
    .notNull()
    .references(() => mktVendorQuotesTable.id, { onDelete: "restrict" }),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => suppliersTable.id, { onDelete: "restrict" }),

  status: mktPoStatusEnum("status").notNull().default("pending"),

  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount:   numeric("tax_amount",   { precision: 14, scale: 2 }).notNull().default("0"),
  grandTotal:  numeric("grand_total",  { precision: 14, scale: 2 }).notNull().default("0"),

  // Link ke ERP documents (dibuat setelah PO confirmed)
  salesDocumentId: integer("sales_document_id").references(() => salesDocumentsTable.id, { onDelete: "set null" }),

  // ── Phase 2E — Snapshot immutable (di-isi saat INSERT, TIDAK boleh diubah) ──
  // Melindungi PO dari perubahan data supplier/quote di kemudian hari.
  vendorNameSnapshot:      text("vendor_name_snapshot"),
  vendorAddressSnapshot:   text("vendor_address_snapshot"),
  paymentTermsSnapshot:    text("payment_terms_snapshot"),
  incotermSnapshot:        text("incoterm_snapshot"),
  quotationNumberSnapshot: text("quotation_number_snapshot"),
  quotationDateSnapshot:   date("quotation_date_snapshot"),
  currencySnapshot:        text("currency_snapshot"),
  leadTimeDaysSnapshot:    integer("lead_time_days_snapshot"),

  confirmedAt:    timestamp("confirmed_at"),
  cancelledAt:    timestamp("cancelled_at"),
  cancelReason:   text("cancel_reason"),
  journalPostedAt: timestamp("journal_posted_at"),

  // ── Phase 2G — Vendor confirmation token + KPI dates (migration 0022) ──────
  // vendor_token: opaque 64-hex, nullable (NULL for pre-Phase-2G PO rows).
  // vendor_token_version increments on regenerate — old token strings become
  // unmatchable (lookup is always by exact token string), no separate
  // token-history table needed for Phase 2G.
  vendorToken:            text("vendor_token").unique(),
  vendorTokenVersion:     integer("vendor_token_version").notNull().default(1),
  vendorTokenExpiresAt:   timestamp("vendor_token_expires_at"),
  vendorTokenUsedAt:      timestamp("vendor_token_used_at"),
  lastTokenGeneratedAt:   timestamp("last_token_generated_at"),
  revisionNotes:          text("revision_notes"),
  closedAt:               timestamp("closed_at"),
  expectedCompletionDate: date("expected_completion_date"),
  actualCompletionDate:   date("actual_completion_date"),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // Phase 2E — unique constraints (also in migration 0018)
  uniqueIndex("mkt_po_rfq_unique").on(t.rfqId),
  uniqueIndex("mkt_po_quote_unique").on(t.quoteId),
  // Lookup indexes
  index("mkt_purchase_orders_company_idx").on(t.companyId),
  index("mkt_purchase_orders_vendor_idx").on(t.vendorId),
  index("mkt_purchase_orders_status_idx").on(t.status),
]);

export const insertMktPurchaseOrderSchema = createInsertSchema(mktPurchaseOrdersTable).omit({
  id: true,
  poNumber: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMktPurchaseOrder = z.infer<typeof insertMktPurchaseOrderSchema>;
export type MktPurchaseOrder = typeof mktPurchaseOrdersTable.$inferSelect;
