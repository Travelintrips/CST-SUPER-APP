import { pgTable, serial, text, integer, numeric, timestamp, date, pgEnum, boolean, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { logisticOrdersTable } from "./logisticOrders";
import { companiesTable } from "./companies";
import { uomTable } from "./uom";

export const salesDocKindEnum = pgEnum("sales_doc_kind", ["quote", "order"]);
export const salesDocStatusEnum = pgEnum("sales_doc_status", [
  "draft",
  "sent",
  "confirmed",
  "done",
  "cancelled",
]);
export const salesInvoiceStatusEnum = pgEnum("sales_invoice_status", [
  "none",
  "to_invoice",
  "invoiced",
]);
export const salesDeliveryStatusEnum = pgEnum("sales_delivery_status", [
  "none",
  "to_deliver",
  "delivered",
]);
export const salesPaymentStatusEnum = pgEnum("sales_payment_status", [
  "unpaid",
  "partial",
  "paid",
  "overdue",
]);

export const salesDocumentsTable = pgTable("sales_documents", {
  id: serial("id").primaryKey(),
  docNumber: text("doc_number").notNull().unique(),
  kind: salesDocKindEnum("kind").notNull().default("quote"),
  status: salesDocStatusEnum("status").notNull().default("draft"),
  invoiceStatus: salesInvoiceStatusEnum("invoice_status").notNull().default("none"),
  deliveryStatus: salesDeliveryStatusEnum("delivery_status").notNull().default("none"),
  paymentStatus: salesPaymentStatusEnum("payment_status").notNull().default("unpaid"),
  amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }).notNull().default("0"),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxRateId: integer("tax_rate_id"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  grandTotal: numeric("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
  origin: text("origin"),
  destination: text("destination"),
  transportMode: text("transport_mode"),
  etd: date("etd"),
  eta: date("eta"),
  validUntil: timestamp("valid_until"),
  expectedDate: timestamp("expected_date"),
  notes: text("notes"),
  paymentType: text("payment_type"),
  confirmedAt: timestamp("confirmed_at"),
  // Invoice automation fields
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  dueDate: date("due_date"),
  paymentTermDays: integer("payment_term_days").default(30),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: text("cancelled_by"),
  cancelReason: text("cancel_reason"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  editReason: text("edit_reason"),
  reversalReason: text("reversal_reason"),
  createdById: text("created_by_id"),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  aiSourceCorrespondenceId: integer("ai_source_correspondence_id"),
  aiSourceWaPhone: text("ai_source_wa_phone"),
  logisticOrderId: integer("logistic_order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  warehouseId: integer("warehouse_id"),
  categoryKey: text("category_key"),
  templateId: text("template_id"),
  templateVersion: text("template_version"),
  templateSnapshot: jsonb("template_snapshot").$type<Record<string, unknown> | null>(),
  paymentProofToken: text("payment_proof_token").unique(),
  proofUrl: text("proof_url"),
  proofUploadedAt: timestamp("proof_uploaded_at"),
  proofRemarks: text("proof_remarks"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // [H6-FIX] Prevent duplicate SO from same logistic order (nullable-safe: NULL != NULL in PG unique index)
  uniqueIndex("sales_documents_logistic_order_id_unique_idx").on(t.logisticOrderId),
  // [H10-FIX] Performance indexes for most-queried columns
  index("sales_documents_customer_id_idx").on(t.customerId),
  index("sales_documents_company_id_idx").on(t.companyId),
  index("sales_documents_status_idx").on(t.status),
  index("sales_documents_company_status_idx").on(t.companyId, t.status),
]);

export const salesDocumentLinesTable = pgTable("sales_document_lines", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .notNull()
    .references(() => salesDocumentsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  salesUomId: integer("sales_uom_id").references(() => uomTable.id, { onDelete: "set null" }),
  baseQty: numeric("base_qty", { precision: 12, scale: 4 }),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  meta: jsonb("meta").$type<{
    orderItemId?: number;
    vendorCatalogItemId?: number | null;
    vendorFulfillmentId?: number | null;
  } | null>(),
}, (t) => [
  index("sales_doc_lines_doc_idx").on(t.documentId),
]);

export const insertSalesDocumentSchema = createInsertSchema(salesDocumentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  docNumber: true,
});
export const insertSalesDocumentLineSchema = createInsertSchema(salesDocumentLinesTable).omit({
  id: true,
});

export type InsertSalesDocument = z.infer<typeof insertSalesDocumentSchema>;
export type InsertSalesDocumentLine = z.infer<typeof insertSalesDocumentLineSchema>;
export type SalesDocument = typeof salesDocumentsTable.$inferSelect;
export type SalesDocumentLine = typeof salesDocumentLinesTable.$inferSelect;
