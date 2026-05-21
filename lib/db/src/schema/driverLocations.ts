import { pgTable, serial, integer, numeric, timestamp, text, index } from "drizzle-orm/pg-core";
import { driversTable } from "./drivers";
import { logisticOrdersTable } from "./logisticOrders";

export const driverLocationsTable = pgTable("driver_locations", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),
  driverId: integer("driver_id").references(() => driversTable.id, { onDelete: "set null" }),
  jobToken: text("job_token"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
  accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
  speed: numeric("speed", { precision: 8, scale: 2 }),
  heading: numeric("heading", { precision: 6, scale: 2 }),
  checkpointType: text("checkpoint_type"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("driver_loc_order_idx").on(t.orderId),
  index("driver_loc_driver_idx").on(t.driverId),
  index("driver_loc_token_idx").on(t.jobToken),
  index("driver_loc_updated_idx").on(t.updatedAt),
]);

export type DriverLocation = typeof driverLocationsTable.$inferSelect;
export type InsertDriverLocation = typeof driverLocationsTable.$inferInsert;
