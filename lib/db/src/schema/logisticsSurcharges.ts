import { pgTable, serial, text, boolean, integer, timestamp, numeric, pgEnum } from "drizzle-orm/pg-core";

export const surchargeTypeEnum = pgEnum("surcharge_type", ["fixed", "percentage", "per_unit"]);
export const surchargeUnitEnum = pgEnum("surcharge_unit", [
  "per_kg",
  "per_cbm",
  "per_container",
  "per_day",
  "per_pallet",
  "flat",
]);
export const surchargeAppliesToEnum = pgEnum("surcharge_applies_to", [
  "all",
  "dg",
  "temp_controlled",
  "oversize",
  "overnight",
]);

export const logisticsSurchargesTable = pgTable("logistics_surcharges", {
  id: serial("id").primaryKey(),
  serviceType: text("service_type").notNull(),
  name: text("name").notNull(),
  label: text("label").notNull(),
  surchargeType: surchargeTypeEnum("surcharge_type").notNull().default("fixed"),
  amount: numeric("amount", { precision: 18, scale: 4 }).notNull().default("0"),
  unit: surchargeUnitEnum("unit").notNull().default("flat"),
  isMandatory: boolean("is_mandatory").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  appliesTo: surchargeAppliesToEnum("applies_to").notNull().default("all"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LogisticsSurcharge = typeof logisticsSurchargesTable.$inferSelect;
export type InsertLogisticsSurcharge = typeof logisticsSurchargesTable.$inferInsert;
