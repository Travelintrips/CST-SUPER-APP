import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Service Packages ────────────────────────────────────────────────────────

export const servicePackagesTable = pgTable("service_packages", {
  id: serial("id").primaryKey(),
  packageCode: text("package_code").notNull().unique(),
  packageName: text("package_name").notNull(),
  packageType: text("package_type").notNull(), // air_export | sea_import | customs | domestic | multimodal
  tradeType: text("trade_type").notNull(), // EXPORT | IMPORT | DOMESTIC | ANY
  description: text("description"),
  pricingMode: text("pricing_mode").notNull().default("PER_ITEM"), // TOTAL_BORONGAN | PER_ITEM | HYBRID
  iconEmoji: text("icon_emoji").default("📦"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const servicePackageItemsTable = pgTable("service_package_items", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull(),
  itemType: text("item_type").notNull(),
  serviceCategory: text("service_category"),
  itemTitle: text("item_title").notNull(),
  isRequired: boolean("is_required").notNull().default(true),
  sequenceNo: integer("sequence_no").notNull().default(1),
  defaultFormSchema: jsonb("default_form_schema").$type<Record<string, unknown>>().default({}),
  requiredDocuments: jsonb("required_documents").$type<string[]>().default([]),
  description: text("description"),
});

export const servicePackagesRelations = relations(servicePackagesTable, ({ many }) => ({
  items: many(servicePackageItemsTable),
}));

export const servicePackageItemsRelations = relations(servicePackageItemsTable, ({ one }) => ({
  package: one(servicePackagesTable, {
    fields: [servicePackageItemsTable.packageId],
    references: [servicePackagesTable.id],
  }),
}));

export type ServicePackage = typeof servicePackagesTable.$inferSelect;
export type ServicePackageItem = typeof servicePackageItemsTable.$inferSelect;
