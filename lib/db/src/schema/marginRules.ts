import { pgTable, serial, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const marginRulesTable = pgTable("margin_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  serviceType: text("service_type"),
  route: text("route"),
  customerType: text("customer_type"),
  marginType: text("margin_type").notNull().default("percentage"),
  // percentage | fixed | minimum
  marginValue: numeric("margin_value", { precision: 14, scale: 2 }).notNull().default("0"),
  minimumMargin: numeric("minimum_margin", { precision: 14, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  priority: numeric("priority", { precision: 5, scale: 0 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MarginRule = typeof marginRulesTable.$inferSelect;
export type InsertMarginRule = typeof marginRulesTable.$inferInsert;
