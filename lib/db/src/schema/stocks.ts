import { pgTable, serial, text, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const stocksTable = pgTable("stocks", {
  id: serial("id").primaryKey(),
  // Phase 1 isolation — nullable during backfill; enforce NOT NULL after data migration
  companyId: integer("company_id"),
  productName: text("product_name").notNull(),
  sku: text("sku").notNull(),
  quantity: integer("quantity").notNull().default(0),
  unit: text("unit").notNull(),
  costPrice: numeric("cost_price", { precision: 12, scale: 2 }).notNull(),
  supplierId: integer("supplier_id"),
  hsCode: text("hs_code"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("stocks_company_idx").on(t.companyId),
]);

export const insertStockSchema = createInsertSchema(stocksTable).omit({ id: true, createdAt: true });
export type InsertStock = z.infer<typeof insertStockSchema>;
export type Stock = typeof stocksTable.$inferSelect;
