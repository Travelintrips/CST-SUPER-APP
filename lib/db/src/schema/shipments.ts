/**
 * @deprecated TABEL LEGACY — FROZEN Phase 4 (2026-05-30)
 *
 * Tabel `shipments` dipakai oleh logistics.ts (route lama, sudah dinonaktifkan).
 * Sistem freight aktif sekarang memakai tabel `freight_shipments` (lihat freightShipments.ts).
 *
 * JANGAN DROP tabel ini dulu:
 *   - dashboard.ts masih membaca count dari tabel ini (legacy widget).
 *   - Migration plan Phase 5: update dashboard widget → freightShipmentsTable, lalu drop tabel + enum.
 *
 * Active readers:
 *   - artifacts/api-server/src/routes/dashboard.ts (count query only, read-only)
 *
 * Active writers: NONE (logistics.ts sudah diblokir write via middleware)
 */

import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const shipmentStatusEnum = pgEnum("shipment_status", [
  "pending", "picked_up", "in_transit", "out_for_delivery", "delivered", "failed"
]);

export const shipmentsTable = pgTable("shipments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id"),
  trackingNumber: text("tracking_number").notNull().unique(),
  carrier: text("carrier").notNull(),
  status: shipmentStatusEnum("status").default("pending").notNull(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  estimatedDelivery: text("estimated_delivery"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertShipmentSchema = createInsertSchema(shipmentsTable).omit({ id: true, createdAt: true });
export type InsertShipment = z.infer<typeof insertShipmentSchema>;
export type Shipment = typeof shipmentsTable.$inferSelect;
