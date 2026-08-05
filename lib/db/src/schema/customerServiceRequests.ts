import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  numeric,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { portalCustomersTable } from "./portalCustomers";
import { suppliersTable } from "./suppliers";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Main Request Table ──────────────────────────────────────────────────────

export const customerServiceRequestsTable = pgTable("customer_service_requests", {
  id: serial("id").primaryKey(),
  requestNumber: text("request_number").notNull().unique(),
  customerId: integer("customer_id"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  customerCompany: text("customer_company"),
  requestType: text("request_type").notNull().default("service"),
  tradeType: text("trade_type").notNull(), // EXPORT | IMPORT | DOMESTIC
  orderMode: text("order_mode").notNull().default("ITEM_MANDIRI"), // ITEM_MANDIRI | PAKET_BORONGAN
  packageId: integer("package_id"),
  packageNameSnapshot: text("package_name_snapshot"),
  pricingMode: text("pricing_mode").notNull().default("PER_ITEM"), // TOTAL_BORONGAN | PER_ITEM | HYBRID
  status: text("status").notNull().default("draft"), // draft | submitted | reviewing | quoted | approved | rejected | cancelled
  notes: text("notes"),
  adminNotes: text("admin_notes"),
  handledBy: text("handled_by"),
  totalEstimatedPrice: numeric("total_estimated_price", { precision: 14, scale: 2 }),
  totalQuotedPrice: numeric("total_quoted_price", { precision: 14, scale: 2 }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Request Items Table ─────────────────────────────────────────────────────

export const customerServiceRequestItemsTable = pgTable("customer_service_request_items", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull(),
  itemType: text("item_type").notNull(), // air_freight | ocean_freight | ppjk | trucking | warehousing | handling | insurance | survey | project_cargo
  serviceCategory: text("service_category"),
  sequenceNo: integer("sequence_no").notNull().default(1),
  title: text("title").notNull(),
  description: text("description"),
  formData: jsonb("form_data").$type<Record<string, unknown>>().default({}),
  requiredDocuments: jsonb("required_documents").$type<string[]>().default([]),
  isRequired: boolean("is_required").notNull().default(true),
  status: text("status").notNull().default("pending"), // pending | quoted | accepted | rejected
  estimatedPrice: numeric("estimated_price", { precision: 14, scale: 2 }),
  quotedPrice: numeric("quoted_price", { precision: 14, scale: 2 }),
  vendorId: integer("vendor_id"),
  vendorNotes: text("vendor_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Request Documents Table ─────────────────────────────────────────────────

export const customerServiceRequestDocumentsTable = pgTable("customer_service_request_documents", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull(),
  requestItemId: integer("request_item_id"),
  documentType: text("document_type").notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  verificationStatus: text("verification_status").notNull().default("pending"), // pending | verified | rejected
  uploadedBy: text("uploaded_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Relations ───────────────────────────────────────────────────────────────

export const customerServiceRequestsRelations = relations(
  customerServiceRequestsTable,
  ({ one, many }) => ({
    customer: one(portalCustomersTable, {
      fields: [customerServiceRequestsTable.customerId],
      references: [portalCustomersTable.id],
    }),
    items: many(customerServiceRequestItemsTable),
    documents: many(customerServiceRequestDocumentsTable),
  }),
);

export const customerServiceRequestItemsRelations = relations(
  customerServiceRequestItemsTable,
  ({ one, many }) => ({
    request: one(customerServiceRequestsTable, {
      fields: [customerServiceRequestItemsTable.requestId],
      references: [customerServiceRequestsTable.id],
    }),
    vendor: one(suppliersTable, {
      fields: [customerServiceRequestItemsTable.vendorId],
      references: [suppliersTable.id],
    }),
    documents: many(customerServiceRequestDocumentsTable),
  }),
);

export const customerServiceRequestDocumentsRelations = relations(
  customerServiceRequestDocumentsTable,
  ({ one }) => ({
    request: one(customerServiceRequestsTable, {
      fields: [customerServiceRequestDocumentsTable.requestId],
      references: [customerServiceRequestsTable.id],
    }),
    item: one(customerServiceRequestItemsTable, {
      fields: [customerServiceRequestDocumentsTable.requestItemId],
      references: [customerServiceRequestItemsTable.id],
    }),
  }),
);

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

export const insertCustomerServiceRequestSchema = createInsertSchema(customerServiceRequestsTable).omit({
  id: true,
  requestNumber: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
});

export const insertCustomerServiceRequestItemSchema = createInsertSchema(customerServiceRequestItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CustomerServiceRequest = typeof customerServiceRequestsTable.$inferSelect;
export type InsertCustomerServiceRequest = z.infer<typeof insertCustomerServiceRequestSchema>;
export type CustomerServiceRequestItem = typeof customerServiceRequestItemsTable.$inferSelect;
export type InsertCustomerServiceRequestItem = z.infer<typeof insertCustomerServiceRequestItemSchema>;
export type CustomerServiceRequestDocument = typeof customerServiceRequestDocumentsTable.$inferSelect;
