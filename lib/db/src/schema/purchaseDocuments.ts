import { pgTable, serial, text, integer, numeric, timestamp, pgEnum, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { suppliersTable } from "./suppliers";
import { productsTable } from "./products";
import { companiesTable } from "./companies";
import { warehousesTable } from "./inventory";
import { mktPurchaseOrdersTable } from "./mktPurchaseOrders";

export const purchaseDocKindEnum = pgEnum("purchase_doc_kind", ["rfq", "order"]);
export const purchaseDocStatusEnum = pgEnum("purchase_doc_status", [
  "draft",
  "sent",
  "confirmed",
  "done",
  "cancelled",
]);
export const purchaseReceiveStatusEnum = pgEnum("purchase_receive_status", [
  "none",
  "to_receive",
  "received",
]);
export const purchaseBillStatusEnum = pgEnum("purchase_bill_status", [
  "none",
  "to_bill",
  "billed",
]);
export const purchasePaymentStatusEnum = pgEnum("purchase_payment_status", [
  "unpaid",
  "partial",
  "paid",
  "overdue",
]);

export const purchaseDocumentsTable = pgTable("purchase_documents", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  docNumber: text("doc_number").notNull().unique(),
  kind: purchaseDocKindEnum("kind").notNull().default("rfq"),
  status: purchaseDocStatusEnum("status").notNull().default("draft"),
  receiveStatus: purchaseReceiveStatusEnum("receive_status").notNull().default("none"),
  billStatus: purchaseBillStatusEnum("bill_status").notNull().default("none"),
  paymentStatus: purchasePaymentStatusEnum("payment_status").notNull().default("unpaid"),
  amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }).notNull().default("0"),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierName: text("supplier_name").notNull(),
  supplierAddress: text("supplier_address"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxRateId: integer("tax_rate_id"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  grandTotal: numeric("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
  expectedDate: timestamp("expected_date"),
  notes: text("notes"),
  confirmedAt: timestamp("confirmed_at"),
  // Bill automation fields
  billNumber: text("bill_number"),
  billDate: text("bill_date"),
  dueDate: text("due_date"),
  paymentTermDays: integer("payment_term_days").default(30),
  productCategory: text("product_category"),
  incoterm: text("incoterm"),
  deliveryTerm: text("delivery_term"),
  targetPrice: numeric("target_price", { precision: 14, scale: 2 }),
  commoditySpecs: jsonb("commodity_specs"),
  requiredDocuments: jsonb("required_documents"),
  categoryKey: text("category_key"),
  templateId: text("template_id"),
  templateVersion: text("template_version"),
  templateSnapshot: jsonb("template_snapshot").$type<Record<string, unknown> | null>(),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: text("cancelled_by"),
  cancelReason: text("cancel_reason"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  editReason: text("edit_reason"),
  createdById: text("created_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Marketplace link — Added Phase 1C (2026-07-02), Group D migration
  mktPurchaseOrderId: integer("mkt_purchase_order_id").references(() => mktPurchaseOrdersTable.id, { onDelete: "set null" }),
}, (t) => [
  index("purchase_docs_company_idx").on(t.companyId),
  index("purchase_docs_supplier_idx").on(t.supplierId),
  index("purchase_docs_status_idx").on(t.status, t.kind),
  index("purchase_documents_mkt_po_idx").on(t.mktPurchaseOrderId),
]);

export const purchaseDocumentLinesTable = pgTable("purchase_document_lines", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .notNull()
    .references(() => purchaseDocumentsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  unit: text("unit"),
  uomId: integer("uom_id"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
}, (t) => [
  index("purchase_doc_lines_doc_idx").on(t.documentId),
  index("purchase_doc_lines_product_idx").on(t.productId),
]);

export const insertPurchaseDocumentSchema = createInsertSchema(purchaseDocumentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  docNumber: true,
});
export const insertPurchaseDocumentLineSchema = createInsertSchema(purchaseDocumentLinesTable).omit({
  id: true,
});

export type InsertPurchaseDocument = z.infer<typeof insertPurchaseDocumentSchema>;
export type InsertPurchaseDocumentLine = z.infer<typeof insertPurchaseDocumentLineSchema>;
export type PurchaseDocument = typeof purchaseDocumentsTable.$inferSelect;
export type PurchaseDocumentLine = typeof purchaseDocumentLinesTable.$inferSelect;
