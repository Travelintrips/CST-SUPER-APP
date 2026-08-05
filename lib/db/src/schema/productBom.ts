import {
  pgTable, serial, text, integer, numeric, boolean, timestamp, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { productsTable } from "./products";

// ── RAW_MATERIALS — bahan baku ────────────────────────────────────────────────

export const rawMaterialsTable = pgTable("raw_materials", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  unit: text("unit").notNull().default("gram"),
  costPrice: numeric("cost_price", { precision: 14, scale: 2 }).notNull().default("0"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("raw_materials_company_idx").on(t.companyId),
]);

// ── RECIPES — 1 per produk ────────────────────────────────────────────────────

export const recipesTable = pgTable("recipes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  note: text("note"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("recipes_company_idx").on(t.companyId),
  index("recipes_product_idx").on(t.productId),
]);

// ── RECIPE_ITEMS — baris bahan baku dalam recipe ──────────────────────────────

export const recipeItemsTable = pgTable("recipe_items", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  rawMaterialId: integer("raw_material_id").notNull().references(() => rawMaterialsTable.id, { onDelete: "cascade" }),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull().default("0"),
  unit: text("unit").notNull().default("gram"),
});

// ── ZOD SCHEMAS ───────────────────────────────────────────────────────────────

export const insertRawMaterialSchema = createInsertSchema(rawMaterialsTable).omit({ id: true, createdAt: true });
export const insertRecipeSchema = createInsertSchema(recipesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRecipeItemSchema = createInsertSchema(recipeItemsTable).omit({ id: true });

export type RawMaterial = typeof rawMaterialsTable.$inferSelect;
export type Recipe = typeof recipesTable.$inferSelect;
export type RecipeItem = typeof recipeItemsTable.$inferSelect;
