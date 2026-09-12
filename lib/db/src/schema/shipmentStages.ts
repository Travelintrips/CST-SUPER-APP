import { pgTable, serial, integer, text, date, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const shipmentStageTypeEnum = pgEnum("shipment_stage_type", [
  "booking", "trucking", "handling", "customs",
  "pickup", "customs_export", "sea_freight", "customs_import", "delivery",
]);

export const SHIPMENT_STAGE_TYPES = shipmentStageTypeEnum.enumValues;
export type ShipmentStageType = typeof SHIPMENT_STAGE_TYPES[number];

export const shipmentStagesTable = pgTable("shipment_stages", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id").notNull(),
  stageType: shipmentStageTypeEnum("stage_type").notNull(),
  vendorName: text("vendor_name"),
  date: date("date"),
  status: text("status").default("pending").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
