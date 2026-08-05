import { pgTable, serial, text, boolean, jsonb, timestamp, integer } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const productTemplatesTable = pgTable("product_templates", {
  id: serial("id").primaryKey(),

  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),

  categoryKey: text("category_key").notNull(),
  label: text("label").notNull(),
  version: text("version").notNull().default("1.0.0"),
  isActive: boolean("is_active").notNull().default(true),
  icon: text("icon"),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  requiredDocuments: jsonb("required_documents").notNull().default([]),
  checklist: jsonb("checklist").notNull().default([]),
  customFields: jsonb("custom_fields").notNull().default([]),
  packagingInstructions: text("packaging_instructions").default(""),
  conditionalRules: jsonb("conditional_rules").notNull().default([]),
  validationRules: jsonb("validation_rules").notNull().default([]),
  // ── Media Foundation ──────────────────────────────────────────────────────
  mediaAssets: jsonb("media_assets").$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ProductTemplate = typeof productTemplatesTable.$inferSelect;
export type InsertProductTemplate = typeof productTemplatesTable.$inferInsert;
