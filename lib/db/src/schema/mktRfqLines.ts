import { pgTable, serial, text, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktRfqsTable } from "./mktRfqs";
import { vendorCatalogItemsTable } from "./suppliers";

// ── SCHEMA — Enterprise Marketplace Blueprint v1.1.1, Section 6.2 ────────────
// MIGRATED — Phase 1C (2026-07-02). Table exists in Supabase production.
// KEPUTUSAN #2 — line items terpisah dari header RFQ.

export const mktRfqLinesTable = pgTable("mkt_rfq_lines", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id")
    .notNull()
    .references(() => mktRfqsTable.id, { onDelete: "cascade" }),
  vendorCatalogItemId: integer("vendor_catalog_item_id")
    .references(() => vendorCatalogItemsTable.id, { onDelete: "set null" }), // KEPUTUSAN #4

  itemName: text("item_name").notNull(), // snapshot nama item saat RFQ dibuat
  itemDescription: text("item_description"),
  itemUnit: text("item_unit"),

  requestedQty: numeric("requested_qty", { precision: 12, scale: 3 }).notNull().default("1"),
  targetPricePerUnit: numeric("target_price_per_unit", { precision: 14, scale: 2 }), // budget buyer, opsional

  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("mkt_rfq_lines_rfq_idx").on(t.rfqId),
  index("mkt_rfq_lines_vendor_catalog_item_idx").on(t.vendorCatalogItemId),
]);

export const insertMktRfqLineSchema = createInsertSchema(mktRfqLinesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMktRfqLine = z.infer<typeof insertMktRfqLineSchema>;
export type MktRfqLine = typeof mktRfqLinesTable.$inferSelect;
