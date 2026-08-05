import { pgTable, serial, integer, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { driversTable } from "./drivers";
import { freightShipmentsTable } from "./freightShipments";
import { logisticOrdersTable } from "./logisticOrders";

export const driverJobStatusEnum = pgEnum("driver_job_status", [
  "ASSIGNED",
  "ACCEPTED",
  "ON_THE_WAY_TO_PICKUP",
  "ARRIVED_AT_PICKUP",
  "PICKED_UP",
  "IN_TRANSIT",
  "ARRIVED_AT_DESTINATION",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
]);

export const driverJobsTable = pgTable("driver_jobs", {
  id: serial("id").primaryKey(),
  // Phase 1 isolation — nullable; backfill from logistic_orders.company_id via logistic_order_id
  companyId: integer("company_id"),
  driverId: integer("driver_id")
    .references(() => driversTable.id, { onDelete: "set null" }),
  freightShipmentId: integer("freight_shipment_id").references(
    () => freightShipmentsTable.id,
    { onDelete: "set null" }
  ),
  logisticOrderId: integer("logistic_order_id").references(
    () => logisticOrdersTable.id,
    { onDelete: "set null" }
  ),
  jobNumber: text("job_number").notNull().unique(),
  customerName: text("customer_name"),
  pickupAddress: text("pickup_address"),
  deliveryAddress: text("delivery_address"),
  cargoDescription: text("cargo_description"),
  vehicleType: text("vehicle_type"),
  truckPlate: text("truck_plate"),
  pickupDateTime: timestamp("pickup_date_time"),
  deliveryDateTime: timestamp("delivery_date_time"),
  specialInstruction: text("special_instruction"),
  weight: text("weight"),
  distance: text("distance"),
  status: driverJobStatusEnum("status").default("ASSIGNED").notNull(),
  notes: text("notes"),
  podReceiverName: text("pod_receiver_name"),
  podReceiverPosition: text("pod_receiver_position"),
  podNotes: text("pod_notes"),
  podPhotos: text("pod_photos"),
  podSubmittedAt: timestamp("pod_submitted_at"),
  podGeoLat: text("pod_geo_lat"),
  podGeoLng: text("pod_geo_lng"),
  podDeviceTimestamp: timestamp("pod_device_timestamp"),
  podMapUrl: text("pod_map_url"),
  podStreetViewUrl: text("pod_street_view_url"),
  podSignatureDataUrl: text("pod_signature_data_url"),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  driverType: text("driver_type").default("EXTERNAL"),
  executionMode: text("execution_mode").default("DRIVER_APP"),
  waProgressToken: text("wa_progress_token"),
  driverNameOverride: text("driver_name_override"),
  driverPhoneOverride: text("driver_phone_override"),
  vehiclePlateOverride: text("vehicle_plate_override"),
  legacySource: text("legacy_source"),
}, (t) => [
  index("driver_jobs_company_idx").on(t.companyId),
  index("driver_jobs_driver_idx").on(t.driverId),
  index("driver_jobs_logistic_order_idx").on(t.logisticOrderId),
]);

export const driverJobLogsTable = pgTable("driver_job_logs", {
  id: serial("id").primaryKey(),
  driverJobId: integer("driver_job_id")
    .notNull()
    .references(() => driverJobsTable.id, { onDelete: "cascade" }),
  status: driverJobStatusEnum("status").notNull(),
  note: text("note"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const driverPhotosTable = pgTable("driver_photos", {
  id: serial("id").primaryKey(),
  driverJobId: integer("driver_job_id")
    .notNull()
    .references(() => driverJobsTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  photoType: text("photo_type").notNull().default("general"),
  takenAt: timestamp("taken_at").defaultNow().notNull(),
});

export type DriverJob = typeof driverJobsTable.$inferSelect;
export type DriverJobLog = typeof driverJobLogsTable.$inferSelect;
export type DriverPhoto = typeof driverPhotosTable.$inferSelect;
