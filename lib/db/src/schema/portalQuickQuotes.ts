import { pgTable, serial, text, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";

export const portalQuickQuotesTable = pgTable("portal_quick_quotes", {
  id: serial("id").primaryKey(),
  quoteNumber: text("quote_number").notNull().unique(),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone").notNull(),
  serviceCategory: text("service_category").notNull(),
  origin: text("origin"),
  destination: text("destination"),
  commodity: text("commodity"),
  weightKg: numeric("weight_kg", { precision: 12, scale: 2 }),
  volume: text("volume"),
  description: text("description"),
  status: text("status").notNull().default("new"),
  adminNotes: text("admin_notes"),
  assignedTo: text("assigned_to"),
  contactedAt: timestamp("contacted_at"),
  meta: jsonb("meta").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type PortalQuickQuote = typeof portalQuickQuotesTable.$inferSelect;
export type InsertPortalQuickQuote = typeof portalQuickQuotesTable.$inferInsert;
