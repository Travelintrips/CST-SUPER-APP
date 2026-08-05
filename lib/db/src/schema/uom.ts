import { pgTable, serial, text, numeric, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const uomTable = pgTable("uom", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  symbol: text("symbol").notNull(),
  category: text("category").notNull().default("count"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const uomConversionsTable = pgTable("uom_conversions", {
  id: serial("id").primaryKey(),
  fromUomId: integer("from_uom_id").notNull().references(() => uomTable.id, { onDelete: "cascade" }),
  toUomId: integer("to_uom_id").notNull().references(() => uomTable.id, { onDelete: "cascade" }),
  factor: numeric("factor", { precision: 18, scale: 6 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("uom_conversions_pair_uidx").on(t.fromUomId, t.toUomId),
]);

export const insertUomSchema = createInsertSchema(uomTable).omit({ id: true, createdAt: true });
export const insertUomConversionSchema = createInsertSchema(uomConversionsTable).omit({ id: true, createdAt: true });

export type Uom = typeof uomTable.$inferSelect;
export type UomConversion = typeof uomConversionsTable.$inferSelect;
export type InsertUom = z.infer<typeof insertUomSchema>;
export type InsertUomConversion = z.infer<typeof insertUomConversionSchema>;
