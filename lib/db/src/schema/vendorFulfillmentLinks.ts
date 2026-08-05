import {
  pgTable, serial, integer, text, timestamp,
} from "drizzle-orm/pg-core";
import { logisticOrdersTable } from "./logisticOrders";
import { suppliersTable } from "./suppliers";

export const vendorFulfillmentLinksTable = pgTable("vendor_fulfillment_links", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  tokenHash: text("token_hash"),            // P0.1 — HMAC-SHA256 of raw token
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  serviceType: text("service_type").notNull(),
  // trucking | freight_air | freight_sea | product | customs | general
  status: text("status").notNull().default("pending"),
  // pending | submitted | expired
  // --- Trucking fields ---
  driverName: text("driver_name"),
  driverPhone: text("driver_phone"),
  plateNumber: text("plate_number"),
  vehicleType: text("vehicle_type"),
  pickupTime: text("pickup_time"),
  // --- Freight (Air / Sea) fields ---
  carrierName: text("carrier_name"),
  etd: text("etd"),
  eta: text("eta"),
  bookingNumber: text("booking_number"),
  awbBlNumber: text("awb_bl_number"),
  flightVessel: text("flight_vessel"),
  // --- Product / warehouse fields ---
  stockConfirmed: text("stock_confirmed"),
  qtyConfirmed: text("qty_confirmed"),
  readyDate: text("ready_date"),
  warehouseLocation: text("warehouse_location"),
  // --- Customs / handling fields ---
  customsPicName: text("customs_pic_name"),
  customsDocuments: text("customs_documents"),
  customsProcessEta: text("customs_process_eta"),
  // --- Common ---
  notes: text("notes"),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type VendorFulfillmentLink = typeof vendorFulfillmentLinksTable.$inferSelect;
