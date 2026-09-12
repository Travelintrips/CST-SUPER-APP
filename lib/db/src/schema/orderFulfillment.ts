import {
  pgTable, serial, integer, text, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { logisticOrdersTable } from "./logisticOrders";
import { suppliersTable } from "./suppliers";

export const orderFulfillmentLinksTable = pgTable("order_fulfillment_links", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  serviceType: text("service_type").notNull(),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at"),
  expiresAt: timestamp("expires_at"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("ofl_order_idx").on(t.orderId),
  index("ofl_token_idx").on(t.token),
]);

export const orderFulfillmentSubmissionsTable = pgTable("order_fulfillment_submissions", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull().references(() => orderFulfillmentLinksTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  serviceType: text("service_type").notNull(),
  fulfillmentData: jsonb("fulfillment_data").notNull(),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("ofs_order_idx").on(t.orderId),
  index("ofs_link_idx").on(t.linkId),
]);
