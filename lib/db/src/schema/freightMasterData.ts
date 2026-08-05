import {
  pgTable, serial, text, numeric, integer, boolean, timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const freightPortsTable = pgTable("freight_ports", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  city: text("city").notNull().default(""),
  country: text("country").notNull().default(""),
  countryCode: text("country_code").notNull().default(""),
  region: text("region").notNull().default(""),
  portType: text("port_type").notNull().default("sea"),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const freightCarriersTable = pgTable("freight_carriers", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  carrierType: text("carrier_type").notNull().default("shipping_line"),
  country: text("country").notNull().default(""),
  countryCode: text("country_code").notNull().default(""),
  logoUrl: text("logo_url"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const freightContainerTypesTable = pgTable("freight_container_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  teu: numeric("teu", { precision: 5, scale: 2 }).notNull().default("1"),
  maxCbm: numeric("max_cbm", { precision: 10, scale: 2 }),
  maxPayloadKg: integer("max_payload_kg"),
  isReefer: boolean("is_reefer").notNull().default(false),
  isSpecial: boolean("is_special").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
});

export const oceanFreightRouteMatrixTable = pgTable("ocean_freight_route_matrix", {
  id: serial("id").primaryKey(),
  originPortCode: text("origin_port_code").notNull(),
  destinationPortCode: text("destination_port_code").notNull(),
  carrierCode: text("carrier_code").notNull(),
  serviceName: text("service_name").notNull().default(""),
  transitDaysMin: integer("transit_days_min"),
  transitDaysMax: integer("transit_days_max"),
  frequency: text("frequency").notNull().default("weekly"),
  directOrTransshipment: text("direct_or_transshipment").notNull().default("direct"),
  pol: text("pol"),
  pod: text("pod"),
  transshipmentPort: text("transshipment_port"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  routeUq: uniqueIndex("ofr_route_matrix_uq").on(t.originPortCode, t.destinationPortCode, t.carrierCode),
}));

export type FreightPort = typeof freightPortsTable.$inferSelect;
export type FreightCarrier = typeof freightCarriersTable.$inferSelect;
export type FreightContainerType = typeof freightContainerTypesTable.$inferSelect;
export type OceanFreightRouteMatrix = typeof oceanFreightRouteMatrixTable.$inferSelect;
