import { pgTable, serial, integer, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { suppliersTable } from "./suppliers";

export const vendorRatesTable = pgTable("vendor_rates", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").references(() => suppliersTable.id, { onDelete: "cascade" }),
  transportMode: text("transport_mode").notNull(),
  truckType: text("truck_type"),
  originKeyword: text("origin_keyword"),
  destKeyword: text("dest_keyword"),
  baseRate: numeric("base_rate", { precision: 15, scale: 2 }).notNull().default("0"),
  unit: text("unit").notNull().default("per_trip"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type VendorRate = typeof vendorRatesTable.$inferSelect;
export type InsertVendorRate = typeof vendorRatesTable.$inferInsert;
