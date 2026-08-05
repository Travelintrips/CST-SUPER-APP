import { pgTable, serial, text, integer, numeric, timestamp, date, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktVendorQuotesTable } from "./mktVendorQuotes";
import { mktRfqLinesTable } from "./mktRfqLines";
import { vendorCatalogItemsTable } from "./suppliers";

// ── SCHEMA — Enterprise Marketplace Blueprint v1.1.1, Section 6.4 ────────────
// MIGRATED — Phase 1C (2026-07-02). Table exists in Supabase production.
// KEPUTUSAN #7 — quote per line, bukan quote per header saja.

export const mktStockStatusEnum = pgEnum("mkt_stock_status", [
  "available",
  "limited",
  "backorder",
  "unavailable",
]);

export const mktVendorQuoteLinesTable = pgTable("mkt_vendor_quote_lines", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id")
    .notNull()
    .references(() => mktVendorQuotesTable.id, { onDelete: "cascade" }),
  rfqLineId: integer("rfq_line_id")
    .notNull()
    .references(() => mktRfqLinesTable.id, { onDelete: "cascade" }),
  vendorCatalogItemId: integer("vendor_catalog_item_id")
    .references(() => vendorCatalogItemsTable.id, { onDelete: "set null" }),

  offeredUnitPrice: numeric("offered_unit_price", { precision: 14, scale: 2 }).notNull(),
  offeredQty: numeric("offered_qty", { precision: 12, scale: 3 }).notNull(),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),

  // ── Phase 2D — Vendor Quote Submission per-line fields [KEPUTUSAN #7-#9] ──
  currency: text("currency"),                          // KEPUTUSAN #8 — ISO 4217 text, wajib saat submit
  minimumOrderQty: numeric("minimum_order_qty", { precision: 12, scale: 3 }), // KEPUTUSAN #9 — opsional
  validUntil: date("valid_until"),                     // KEPUTUSAN #9 — per-line, wajib saat submit, >= quotation_date

  leadTimeDays: integer("lead_time_days"),
  stockStatus: mktStockStatusEnum("stock_status").default("available"),
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("mkt_vendor_quote_lines_quote_idx").on(t.quoteId),
  index("mkt_vendor_quote_lines_rfq_line_idx").on(t.rfqLineId),
  index("mkt_vendor_quote_lines_vendor_catalog_item_idx").on(t.vendorCatalogItemId),
]);

export const insertMktVendorQuoteLineSchema = createInsertSchema(mktVendorQuoteLinesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMktVendorQuoteLine = z.infer<typeof insertMktVendorQuoteLineSchema>;
export type MktVendorQuoteLine = typeof mktVendorQuoteLinesTable.$inferSelect;
