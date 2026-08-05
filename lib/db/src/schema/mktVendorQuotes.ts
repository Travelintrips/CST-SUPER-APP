import { pgTable, serial, text, integer, numeric, jsonb, date, timestamp, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktRfqsTable } from "./mktRfqs";
import { suppliersTable } from "./suppliers";
import { accountingTaxesTable } from "./accounting";

// ── SCHEMA — Enterprise Marketplace Blueprint v1.1.1, Section 6.3 ────────────
// MIGRATED — Phase 1C (2026-07-02). Table exists in Supabase production.

export const mktQuoteStatusEnum = pgEnum("mkt_quote_status", [
  "invited",
  "opened",
  "submitted",
  "selected",
  "rejected",
  "expired",
  "withdrawn",
  // Phase 2F — Requote Flow: admin meminta vendor merevisi quotation
  "requote_requested",
]);

export const mktVendorQuotesTable = pgTable("mkt_vendor_quotes", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id")
    .notNull()
    .references(() => mktRfqsTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => suppliersTable.id, { onDelete: "restrict" }),

  token: text("token").notNull().unique(), // token akses vendor (tanpa login)
  status: mktQuoteStatusEnum("status").notNull().default("invited"),

  validUntil: timestamp("valid_until"),
  deliveryDateOffered: date("delivery_date_offered"),
  notes: text("notes"),
  attachmentUrl: text("attachment_url"),
  attachmentFilename: text("attachment_filename"), // Phase 2E — display name for the attachment (not the signed URL)

  // ── Phase 2D — Vendor Quote Submission header fields [KEPUTUSAN #3-#6] ────
  quotationNumber: text("quotation_number"), // KEPUTUSAN #3 — bebas, TIDAK unique
  quotationDate: date("quotation_date"),     // KEPUTUSAN #4 — default CURRENT_DATE di service layer
  paymentTerms: text("payment_terms"),       // KEPUTUSAN #5 — free text, bukan enum
  incoterm: text("incoterm"),                // KEPUTUSAN #5 — free text, bukan enum
  deliveryLocation: text("delivery_location"),

  // ── INTERNAL FIELDS — WAJIB disembunyikan dari vendor API [KEPUTUSAN #10] ──
  commissionRate: numeric("commission_rate", { precision: 5, scale: 3 }), // % komisi platform
  commissionTaxId: integer("commission_tax_id")
    .references(() => accountingTaxesTable.id, { onDelete: "set null" }), // KEPUTUSAN #12
  commissionAmount: numeric("commission_amount", { precision: 14, scale: 2 }),
  netVendorAmount: numeric("net_vendor_amount", { precision: 14, scale: 2 }),
  rankScore: numeric("rank_score", { precision: 8, scale: 4 }),
  rankBadges: jsonb("rank_badges").$type<Record<string, unknown> | null>(),

  submittedAt: timestamp("submitted_at"),
  openedAt: timestamp("opened_at"),

  // ── Phase 2F — Requote Flow ────────────────────────────────────────────────
  // Diisi saat admin meminta vendor merevisi quotation (status → 'requote_requested').
  requoteNotes:    text("requote_notes"),    // alasan requote dari admin
  requoteDeadline: timestamp("requote_deadline"), // deadline respons (opsional)
  requoteRound:    integer("requote_round").notNull().default(1),
  // round 1 = initial quote, 2 = first requote, dst.
  // Di-increment saat vendor submit ulang dari 'requote_requested'

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("mkt_vendor_quotes_rfq_idx").on(t.rfqId),
  index("mkt_vendor_quotes_vendor_idx").on(t.vendorId),
  index("mkt_vendor_quotes_status_idx").on(t.status),
  // Phase 2C: satu vendor max 1 invite per RFQ — race guard di DB level
  uniqueIndex("mkt_vendor_quotes_rfq_vendor_unique").on(t.rfqId, t.vendorId),
]);

export const insertMktVendorQuoteSchema = createInsertSchema(mktVendorQuotesTable).omit({
  id: true,
  token: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMktVendorQuote = z.infer<typeof insertMktVendorQuoteSchema>;
export type MktVendorQuote = typeof mktVendorQuotesTable.$inferSelect;
