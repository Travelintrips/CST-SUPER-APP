import {
  pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";
import { logisticOrdersTable, logisticOrderItemsTable } from "./logisticOrders";
import { suppliersTable } from "./suppliers";

export const logisticVendorFulfillmentsTable = pgTable(
  "logistic_vendor_fulfillments",
  {
    id:                   serial("id").primaryKey(),
    orderId:              integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
    orderItemId:          integer("order_item_id").notNull().references(() => logisticOrderItemsTable.id, { onDelete: "cascade" }),
    vendorCatalogItemId:  integer("vendor_catalog_item_id").notNull(),
    vendorId:             integer("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
    serviceType:          text("service_type"),
    status:               text("status").notNull().default("pending"),
    // pending | confirmed | in_progress | completed | cancelled
    vendorPoId:           integer("vendor_po_id"),
    fulfillmentPayload:   jsonb("fulfillment_payload"),
    calculationInput:     jsonb("calculation_input"),
    templateSnapshot:     jsonb("template_snapshot"),
    priceSnapshot:        jsonb("price_snapshot"),
    adminNotes:           text("admin_notes"),
    createdAt:            timestamp("created_at").defaultNow().notNull(),
    updatedAt:            timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("lvf_order_item_uidx").on(t.orderItemId),
  ],
);

export type LogisticVendorFulfillment = typeof logisticVendorFulfillmentsTable.$inferSelect;
export type InsertLogisticVendorFulfillment = typeof logisticVendorFulfillmentsTable.$inferInsert;
