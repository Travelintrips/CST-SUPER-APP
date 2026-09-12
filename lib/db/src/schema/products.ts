import { pgTable, serial, text, numeric, integer, timestamp, boolean, primaryKey, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { uomTable } from "./uom";
import { companiesTable } from "./companies";

export const productCategoriesTable = pgTable("product_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProductCategorySchema = createInsertSchema(productCategoriesTable).omit({ id: true, createdAt: true });
export type InsertProductCategory = z.infer<typeof insertProductCategorySchema>;
export type ProductCategory = typeof productCategoriesTable.$inferSelect;

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  costPrice: numeric("cost_price", { precision: 12, scale: 2 }).default("0"),
  stock: integer("stock").notNull().default(0),
  description: text("description"),
  imageUrl: text("image_url"),
  mediaItems: text("media_items").default("[]"),
  defaultSalesTaxId: integer("default_sales_tax_id"),
  defaultPurchaseTaxId: integer("default_purchase_tax_id"),
  itemType: text("item_type").notNull().default("barang"),
  unit: text("unit").notNull().default("pcs"),
  unitOptions: text("unit_options").notNull().default("[]"),
  baseUomId: integer("base_uom_id").references(() => uomTable.id, { onDelete: "set null" }),
  subcategory: text("subcategory"),
  isActive: boolean("is_active").notNull().default(true),
  weightKg: numeric("weight_kg", { precision: 10, scale: 3 }),
  volumeCbm: numeric("volume_cbm", { precision: 12, scale: 4 }),
  lengthCm: numeric("length_cm", { precision: 10, scale: 2 }),
  widthCm: numeric("width_cm", { precision: 10, scale: 2 }),
  heightCm: numeric("height_cm", { precision: 10, scale: 2 }),
  goodsType: text("goods_type"),
  currencyCode: text("currency_code").notNull().default("IDR"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("products_company_idx").on(t.companyId),
]);

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;

export const productCategoryMapTable = pgTable("product_category_map", {
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").notNull().references(() => productCategoriesTable.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.productId, table.categoryId] }),
]);

export type ProductCategoryMap = typeof productCategoryMapTable.$inferSelect;
