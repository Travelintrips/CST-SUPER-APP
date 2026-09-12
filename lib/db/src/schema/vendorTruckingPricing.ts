import { pgTable, serial, integer, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { suppliersTable } from "./suppliers";

export const vendorTruckingPricingTable = pgTable("vendor_trucking_pricing", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  vehicleType: text("vehicle_type").notNull(),
  pricePerKm: numeric("price_per_km", { precision: 15, scale: 2 }).notNull().default("0"),
  minimumCharge: numeric("minimum_charge", { precision: 15, scale: 2 }).notNull().default("0"),
  innerCityRadiusKm: numeric("inner_city_radius_km", { precision: 8, scale: 2 }).notNull().default("30"),
  outOfCitySurchargePercent: numeric("out_of_city_surcharge_percent", { precision: 6, scale: 2 }).notNull().default("0"),
  interProvinceSurchargePercent: numeric("inter_province_surcharge_percent", { precision: 6, scale: 2 }).notNull().default("0"),
  interIslandSurchargePercent: numeric("inter_island_surcharge_percent", { precision: 6, scale: 2 }).notNull().default("0"),
  tollMode: text("toll_mode").notNull().default("actual_cost"),
  tollFlatAmount: numeric("toll_flat_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  ferryMode: text("ferry_mode").notNull().default("not_available"),
  ferryFlatAmount: numeric("ferry_flat_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  loadingHelperFee: numeric("loading_helper_fee", { precision: 15, scale: 2 }).notNull().default("0"),
  unloadingHelperFee: numeric("unloading_helper_fee", { precision: 15, scale: 2 }).notNull().default("0"),
  insurancePercent: numeric("insurance_percent", { precision: 6, scale: 2 }).notNull().default("0"),
  urgentSurchargePercent: numeric("urgent_surcharge_percent", { precision: 6, scale: 2 }).notNull().default("0"),
  waitingFreeHours: numeric("waiting_free_hours", { precision: 5, scale: 1 }).notNull().default("2"),
  waitingFeePerHour: numeric("waiting_fee_per_hour", { precision: 15, scale: 2 }).notNull().default("0"),
  multidropFeePerDrop: numeric("multidrop_fee_per_drop", { precision: 15, scale: 2 }).notNull().default("0"),
  overnightFeePerNight: numeric("overnight_fee_per_night", { precision: 15, scale: 2 }).notNull().default("0"),
  dailyRentalPrice: numeric("daily_rental_price", { precision: 15, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type VendorTruckingPricing = typeof vendorTruckingPricingTable.$inferSelect;
export type InsertVendorTruckingPricing = typeof vendorTruckingPricingTable.$inferInsert;
