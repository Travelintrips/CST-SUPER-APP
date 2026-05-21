import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  jsonb,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { suppliersTable } from "./suppliers";
import { companiesTable } from "./companies";

export const logisticOrdersTable = pgTable("logistic_orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  companyName: text("company_name").notNull(),
  customerName: text("customer_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  shipmentType: text("shipment_type").notNull(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  commodity: text("commodity"),
  cargoDescription: text("cargo_description"),
  grossWeight: numeric("gross_weight", { precision: 12, scale: 3 }),
  volumeCbm: numeric("volume_cbm", { precision: 12, scale: 3 }),
  jumlahKoli: integer("jumlah_koli"),
  requiredDate: text("required_date"),
  notes: text("notes"),
  paymentType: text("payment_type"),
  paymentMethod: text("payment_method"),
  namaPenerima: text("nama_penerima"),
  nomorPenerima: text("nomor_penerima"),
  jamOrder: text("jam_order"),
  source: text("source").default("manual").notNull(),
  aiSessionToken: text("ai_session_token"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  tax: numeric("tax", { precision: 14, scale: 2 }).notNull().default("0"),
  grandTotal: numeric("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("New Order"),
  approvedQuoteId: integer("approved_quote_id"),
  adminApprovalStatus: text("admin_approval_status").default("pending"),
  approvedAt: timestamp("approved_at"),
  approvedVendorId: integer("approved_vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  finalSellingPrice: numeric("final_selling_price", { precision: 14, scale: 2 }),
  quotationSentAt: timestamp("quotation_sent_at"),
  customerConfirmToken: text("customer_confirm_token").unique(),
  customerConfirmStatus: text("customer_confirm_status").default("pending"),
  customerConfirmedAt: timestamp("customer_confirmed_at"),
  pickupDate: text("pickup_date"),
  pickupTime: text("pickup_time"),
  truckType: text("truck_type"),
  markupPercent: numeric("markup_percent", { precision: 5, scale: 2 }).default("20"),
  finalPrice: numeric("final_price", { precision: 14, scale: 2 }),
  // [MULTI-MODE] Transport mode & mode-specific fields
  transportMode: text("transport_mode"),
  originDistrict: text("origin_district"),
  destDistrict: text("dest_district"),
  etd: timestamp("etd", { withTimezone: true }),
  eta: timestamp("eta", { withTimezone: true }),
  originPort: text("origin_port"),
  destPort: text("dest_port"),
  weightKg: numeric("weight_kg", { precision: 12, scale: 3 }),
  incoterm: text("incoterm"),
  // [MULTI-MODE] Customer options flow
  optionsToken: text("options_token").unique(),
  optionsSentAt: timestamp("options_sent_at", { withTimezone: true }),
  publicRfqToken: text("public_rfq_token").unique(),
  geofenceEnabled: boolean("geofence_enabled").default(true).notNull(),
  geofenceRadiusKm: integer("geofence_radius_km").default(75).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("logistic_orders_company_idx").on(t.companyId),
  index("logistic_orders_status_idx").on(t.status),
  index("logistic_orders_vendor_idx").on(t.approvedVendorId),
]);

export const logisticOrderItemsTable = pgTable("logistic_order_items", {
  id: serial("id").primaryKey(),
  orderId: serial("order_id").references(() => logisticOrdersTable.id, { onDelete: "cascade" }).notNull(),
  category: text("category").notNull(),
  serviceName: text("service_name").notNull(),
  calculatorType: text("calculator_type").notNull(),
  inputData: jsonb("input_data").notNull().default({}),
  calculationResult: jsonb("calculation_result").notNull().default({}),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const logisticOrderRfqsTable = pgTable("logistic_order_rfqs", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  rfqNumber: text("rfq_number").notNull().unique(),
  vendorIds: integer("vendor_ids").array().notNull().default([]),
  openedVendorIds: integer("opened_vendor_ids").array().notNull().default([]),
  notes: text("notes"),
  status: text("status").notNull().default("admin_review"),
  responseDeadline: timestamp("response_deadline", { withTimezone: true }),
  basicPrice: numeric("basic_price", { precision: 14, scale: 2 }),
  quotedPrice: numeric("quoted_price", { precision: 14, scale: 2 }),
  quotedAt: timestamp("quoted_at", { withTimezone: true }),
  quoteNotes: text("quote_notes"),
  customerResponseNotes: text("customer_response_notes"),
  customerRespondedAt: timestamp("customer_responded_at", { withTimezone: true }),
  createdByUserId: text("created_by_user_id"),
  createdByUserName: text("created_by_user_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const logisticOrderQuotesTable = pgTable("logistic_order_quotes", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id").notNull().references(() => logisticOrderRfqsTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  vendorPrice: numeric("vendor_price", { precision: 14, scale: 2 }).notNull().default("0"),
  estimatedPickup: text("estimated_pickup"),
  estimatedDelivery: text("estimated_delivery"),
  estimatedDays: integer("estimated_days"),
  vendorNotes: text("vendor_notes"),
  markupType: text("markup_type").notNull().default("percentage"),
  markupPercentage: numeric("markup_percentage", { precision: 5, scale: 2 }).notNull().default("0"),
  fixedSellingPrice: numeric("fixed_selling_price", { precision: 14, scale: 2 }),
  sellingPrice: numeric("selling_price", { precision: 14, scale: 2 }),
  quoteStatus: text("quote_status").notNull().default("pending"),
  replySource: text("reply_source").notNull().default("manual"),
  replyTimestamp: timestamp("reply_timestamp"),
  vendorConfirmToken: text("vendor_confirm_token").unique(),
  // Enterprise: ranking & scoring
  rankScore: numeric("rank_score", { precision: 6, scale: 2 }),
  rankBadges: text("rank_badges").array().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vendorOffersTable = pgTable("vendor_offers", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  transportMode: text("transport_mode"),
  offerPrice: numeric("offer_price", { precision: 15, scale: 2 }).notNull().default("0"),
  vehicleYear: integer("vehicle_year"),
  carrierName: text("carrier_name"),
  transitDays: integer("transit_days"),
  notes: text("notes"),
  isSelectedByAdmin: boolean("is_selected_by_admin").notNull().default(false),
  finalCustomerPrice: numeric("final_customer_price", { precision: 15, scale: 2 }),
  optionLabel: text("option_label"),
  status: text("status").notNull().default("PENDING"),
  chosenAt: timestamp("chosen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const logisticOrdersRelations = relations(logisticOrdersTable, ({ many }) => ({
  items: many(logisticOrderItemsTable),
  rfqs: many(logisticOrderRfqsTable),
}));

export const logisticOrderItemsRelations = relations(logisticOrderItemsTable, ({ one }) => ({
  order: one(logisticOrdersTable, {
    fields: [logisticOrderItemsTable.orderId],
    references: [logisticOrdersTable.id],
  }),
}));

export const logisticOrderRfqsRelations = relations(logisticOrderRfqsTable, ({ one, many }) => ({
  order: one(logisticOrdersTable, {
    fields: [logisticOrderRfqsTable.orderId],
    references: [logisticOrdersTable.id],
  }),
  quotes: many(logisticOrderQuotesTable),
}));

export const logisticOrderQuotesRelations = relations(logisticOrderQuotesTable, ({ one }) => ({
  rfq: one(logisticOrderRfqsTable, {
    fields: [logisticOrderQuotesTable.rfqId],
    references: [logisticOrderRfqsTable.id],
  }),
  order: one(logisticOrdersTable, {
    fields: [logisticOrderQuotesTable.orderId],
    references: [logisticOrdersTable.id],
  }),
  vendor: one(suppliersTable, {
    fields: [logisticOrderQuotesTable.vendorId],
    references: [suppliersTable.id],
  }),
}));

export const vendorResponsesTable = pgTable("vendor_responses", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  orderId: integer("order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),
  vendorName: text("vendor_name"),
  status: text("status").notNull(),
  estimatedPickupTime: text("estimated_pickup_time"),
  driverName: text("driver_name"),
  driverPhone: text("driver_phone"),
  plateNumber: text("plate_number"),
  vehicleType: text("vehicle_type"),
  notes: text("notes"),
  unitPhotoUrl: text("unit_photo_url"),
  quotedPrice: numeric("quoted_price", { precision: 14, scale: 2 }),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type VendorResponse = typeof vendorResponsesTable.$inferSelect;
export type InsertVendorResponse = typeof vendorResponsesTable.$inferInsert;
