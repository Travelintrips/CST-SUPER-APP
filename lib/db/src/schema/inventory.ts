import {
  pgTable, pgEnum, serial, text, integer, numeric, boolean,
  timestamp, unique, index,
} from "drizzle-orm/pg-core";
import { productsTable } from "./products";
import { companiesTable } from "./companies";

// ── Enums ──────────────────────────────────────────────────────────────────────

export const warehouseTypeEnum = pgEnum("warehouse_type", ["CENTRAL", "BRANCH", "OUTLET"]);

export const movementTypeEnum = pgEnum("inv_movement_type", [
  "PURCHASE_RECEIPT",
  "SALES_DELIVERY",
  "POS_SALE",
  "RECIPE_CONSUMPTION",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "RETURN_IN",
  "RETURN_OUT",
  "OPNAME_ADJUST",
  "DAMAGE",
  "MANUAL_IN",
  "MANUAL_OUT",
]);

export const referenceTypeEnum = pgEnum("inv_reference_type", [
  "PURCHASE_ORDER",
  "SALES_ORDER",
  "POS_SESSION",
  "TRANSFER",
  "RETURN",
  "OPNAME",
  "MANUAL",
]);

// ── Tables ─────────────────────────────────────────────────────────────────────

export const warehousesTable = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  warehouseCode: text("warehouse_code").notNull().unique(),
  warehouseName: text("warehouse_name").notNull(),
  warehouseType: warehouseTypeEnum("warehouse_type").notNull().default("BRANCH"),
  branchId: integer("branch_id"),
  address: text("address"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("warehouses_company_idx").on(t.companyId),
]);

export const warehouseRacksTable = pgTable("warehouse_racks", {
  id: serial("id").primaryKey(),
  warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id, { onDelete: "cascade" }),
  rackCode: text("rack_code").notNull(),
  rackName: text("rack_name").notNull(),
  zone: text("zone"),
  qrCode: text("qr_code"),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [
  unique("warehouse_racks_code_unique").on(t.warehouseId, t.rackCode),
]);

export const inventoryStockTable = pgTable("inventory_stock", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id, { onDelete: "cascade" }),
  rackId: integer("rack_id").references(() => warehouseRacksTable.id, { onDelete: "set null" }),
  stockOnHand: numeric("stock_on_hand", { precision: 14, scale: 3 }).notNull().default("0"),
  stockReserved: numeric("stock_reserved", { precision: 14, scale: 3 }).notNull().default("0"),
  stockAvailable: numeric("stock_available", { precision: 14, scale: 3 }).notNull().default("0"),
  minimumStock: numeric("minimum_stock", { precision: 14, scale: 3 }).notNull().default("0"),
  unit: text("unit").notNull().default("pcs"),
  averageCost: numeric("average_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
}, (t) => [
  unique("inventory_stock_product_warehouse_rack_unique").on(t.productId, t.warehouseId, t.rackId),
]);

export const stockMovementsTable = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  movementNo: text("movement_no").notNull().unique(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id, { onDelete: "cascade" }),
  rackId: integer("rack_id").references(() => warehouseRacksTable.id, { onDelete: "set null" }),
  movementType: movementTypeEnum("movement_type").notNull(),
  referenceType: referenceTypeEnum("reference_type"),
  referenceId: integer("reference_id"),
  qtyIn: numeric("qty_in", { precision: 14, scale: 3 }).notNull().default("0"),
  qtyOut: numeric("qty_out", { precision: 14, scale: 3 }).notNull().default("0"),
  balanceAfter: numeric("balance_after", { precision: 14, scale: 3 }).notNull().default("0"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  totalCost: numeric("total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("stock_movements_product_idx").on(t.productId),
  index("stock_movements_warehouse_idx").on(t.warehouseId),
  index("stock_movements_type_idx").on(t.movementType),
  index("stock_movements_created_idx").on(t.createdAt),
]);

// ── Types ──────────────────────────────────────────────────────────────────────

export type Warehouse = typeof warehousesTable.$inferSelect;
export type InsertWarehouse = typeof warehousesTable.$inferInsert;
export type WarehouseRack = typeof warehouseRacksTable.$inferSelect;
export type InsertWarehouseRack = typeof warehouseRacksTable.$inferInsert;
export type InventoryStock = typeof inventoryStockTable.$inferSelect;
export type StockMovement = typeof stockMovementsTable.$inferSelect;
