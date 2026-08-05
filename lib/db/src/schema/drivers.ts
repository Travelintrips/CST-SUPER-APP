import { pgTable, serial, text, boolean, numeric, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const driversTable = pgTable("drivers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  phone: text("phone"),
  licenseNumber: text("license_number"),
  vehiclePlate: text("vehicle_plate"),
  vehicleType: text("vehicle_type"),
  isActive: boolean("is_active").default(true).notNull(),
  currentLat: numeric("current_lat", { precision: 10, scale: 7 }),
  currentLng: numeric("current_lng", { precision: 10, scale: 7 }),
  lastLocationAt: timestamp("last_location_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("drivers_company_idx").on(t.companyId),
]);

export const insertDriverSchema = createInsertSchema(driversTable).omit({
  id: true,
  passwordHash: true,
  createdAt: true,
  lastLocationAt: true,
  currentLat: true,
  currentLng: true,
});

export type Driver = typeof driversTable.$inferSelect;
export type InsertDriver = z.infer<typeof insertDriverSchema>;
