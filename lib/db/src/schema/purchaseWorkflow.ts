import {
  pgTable, pgEnum, serial, text, integer, numeric, boolean,
  timestamp, index, unique, jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { suppliersTable } from "./suppliers";
import { productsTable } from "./products";
import { companiesTable } from "./companies";
import { purchaseDocumentsTable, purchaseDocumentLinesTable } from "./purchaseDocuments";
import { warehousesTable, warehouseRacksTable } from "./inventory";
import { uomTable, uomConversionsTable } from "./uom";
import { mktPurchaseOrdersTable } from "./mktPurchaseOrders";
import { mktPurchaseOrderLinesTable } from "./mktPurchaseOrderLines";
import { mktPoGoodsReceiptsTable } from "./mktPoGoodsReceipts";

// Backward-compat aliases so route files using uomMasterTable keep working
export { uomTable as uomMasterTable, uomConversionsTable };

// ── Enums ──────────────────────────────────────────────────────────────────────

export const prStatusEnum = pgEnum("pr_status", [
  "draft", "submitted", "approved", "rejected", "converted", "cancelled",
]);

export const pwApprovalStatusEnum = pgEnum("pw_approval_status", [
  "pending", "approved", "rejected",
]);

export const vqStatusEnum = pgEnum("vq_status", [
  "draft", "submitted", "selected", "rejected",
]);

export const grStatusEnum = pgEnum("gr_status", [
  "draft", "confirmed", "cancelled",
]);

export const qcStatusEnum = pgEnum("qc_status", [
  "pending", "passed", "failed", "partial",
]);

export const prReturnStatusEnum = pgEnum("pr_return_status", [
  "draft", "confirmed", "done", "cancelled",
]);

export const viStatusEnum = pgEnum("vi_status", [
  "draft", "submitted", "posted", "matched", "ready_for_ap", "paid", "cancelled",
]);

export const payReqStatusEnum = pgEnum("pay_req_status", [
  "draft", "submitted", "approved", "rejected", "paid", "cancelled",
]);

export const lcMethodEnum = pgEnum("lc_method", [
  "equal", "by_quantity", "by_amount", "by_weight", "by_volume",
]);


// ── Purchase Requests ──────────────────────────────────────────────────────────

export const purchaseRequestsTable = pgTable("purchase_requests", {
  id: serial("id").primaryKey(),
  prNumber: text("pr_number").notNull().unique(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
  status: prStatusEnum("status").notNull().default("draft"),
  requestedBy: text("requested_by"),
  department: text("department"),
  requiredDate: timestamp("required_date"),
  notes: text("notes"),
  rfqId: integer("rfq_id"),
  cancelledAt: timestamp("cancelled_at"),
  createdBy: text("created_by"),
  // ── Template Engine ──────────────────────────────────────────────────────────
  categoryKey: text("category_key"),
  templateId: text("template_id"),
  templateVersion: text("template_version"),
  templateSnapshot: jsonb("template_snapshot"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("pr_company_idx").on(t.companyId),
  index("pr_status_idx").on(t.status),
]);

export const purchaseRequestLinesTable = pgTable("purchase_request_lines", {
  id: serial("id").primaryKey(),
  prId: integer("pr_id").notNull().references(() => purchaseRequestsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unit: text("unit").notNull().default("pcs"),
  estimatedCost: numeric("estimated_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  productCategory: text("product_category"),
  customFieldValues: jsonb("custom_field_values"),
}, (t) => [
  index("pr_lines_pr_idx").on(t.prId),
]);

export const purchaseApprovalsTable = pgTable("purchase_approvals", {
  id: serial("id").primaryKey(),
  docType: text("doc_type").notNull(),
  docId: integer("doc_id").notNull(),
  step: integer("step").notNull().default(1),
  approverName: text("approver_name"),
  approverId: text("approver_id"),
  status: pwApprovalStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("pw_approvals_doc_idx").on(t.docType, t.docId),
]);

// ── Vendor Quotations ──────────────────────────────────────────────────────────

export const vendorQuotationsTable = pgTable("vendor_quotations", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id").notNull().references(() => purchaseDocumentsTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierName: text("supplier_name").notNull(),
  status: vqStatusEnum("status").notNull().default("draft"),
  validUntil: timestamp("valid_until"),
  paymentTermDays: integer("payment_term_days").default(30),
  deliveryDays: integer("delivery_days"),
  notes: text("notes"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  grandTotal: numeric("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
  incoterm: text("incoterm"),
  deliveryTerm: text("delivery_term"),
  availability: text("availability"),
  documentRefs: jsonb("document_refs"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("vq_rfq_idx").on(t.rfqId),
  index("vq_supplier_idx").on(t.supplierId),
]);

export const vendorQuotationLinesTable = pgTable("vendor_quotation_lines", {
  id: serial("id").primaryKey(),
  quotationId: integer("quotation_id").notNull().references(() => vendorQuotationsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unit: text("unit").notNull().default("pcs"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  leadTimeDays: integer("lead_time_days"),
  notes: text("notes"),
}, (t) => [
  index("vq_lines_quotation_idx").on(t.quotationId),
]);

// ── Goods Receipts ─────────────────────────────────────────────────────────────

export const goodsReceiptsTable = pgTable("goods_receipts", {
  id: serial("id").primaryKey(),
  grNumber: text("gr_number").notNull().unique(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  poId: integer("po_id").notNull().references(() => purchaseDocumentsTable.id, { onDelete: "restrict" }),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  status: grStatusEnum("status").notNull().default("draft"),
  receiveDate: timestamp("receive_date").defaultNow().notNull(),
  deliveryNote: text("delivery_note"),
  notes: text("notes"),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdBy: text("created_by"),
  journalEntryId: integer("journal_entry_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("gr_po_idx").on(t.poId),
  index("gr_company_idx").on(t.companyId),
  index("gr_status_idx").on(t.status),
]);

export const goodsReceiptLinesTable = pgTable("goods_receipt_lines", {
  id: serial("id").primaryKey(),
  grId: integer("gr_id").notNull().references(() => goodsReceiptsTable.id, { onDelete: "cascade" }),
  poLineId: integer("po_line_id"),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  qtyOrdered: numeric("qty_ordered", { precision: 12, scale: 3 }).notNull().default("0"),
  qtyReceived: numeric("qty_received", { precision: 12, scale: 3 }).notNull().default("0"),
  qtyRejected: numeric("qty_rejected", { precision: 12, scale: 3 }).notNull().default("0"),
  unit: text("unit").notNull().default("pcs"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  rackId: integer("rack_id").references(() => warehouseRacksTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  condition: text("condition"),
  receivingNotes: text("receiving_notes"),
  attachments: jsonb("attachments"),
}, (t) => [
  index("gr_lines_gr_idx").on(t.grId),
]);

// ── QC Inspections ─────────────────────────────────────────────────────────────

export const qcInspectionsTable = pgTable("qc_inspections", {
  id: serial("id").primaryKey(),
  qcNumber: text("qc_number").notNull().unique(),
  grId: integer("gr_id").notNull().references(() => goodsReceiptsTable.id, { onDelete: "restrict" }),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  status: qcStatusEnum("status").notNull().default("pending"),
  inspectorName: text("inspector_name"),
  inspectedAt: timestamp("inspected_at"),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("qc_gr_idx").on(t.grId),
]);

export const qcLinesTable = pgTable("qc_lines", {
  id: serial("id").primaryKey(),
  qcId: integer("qc_id").notNull().references(() => qcInspectionsTable.id, { onDelete: "cascade" }),
  grLineId: integer("gr_line_id").references(() => goodsReceiptLinesTable.id, { onDelete: "set null" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  qtyInspected: numeric("qty_inspected", { precision: 12, scale: 3 }).notNull().default("0"),
  qtyPassed: numeric("qty_passed", { precision: 12, scale: 3 }).notNull().default("0"),
  qtyFailed: numeric("qty_failed", { precision: 12, scale: 3 }).notNull().default("0"),
  failReason: text("fail_reason"),
  notes: text("notes"),
}, (t) => [
  index("qc_lines_qc_idx").on(t.qcId),
]);

// ── Purchase Returns ───────────────────────────────────────────────────────────

export const purchaseReturnsTable = pgTable("purchase_returns", {
  id: serial("id").primaryKey(),
  returnNumber: text("return_number").notNull().unique(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  poId: integer("po_id").references(() => purchaseDocumentsTable.id, { onDelete: "set null" }),
  grId: integer("gr_id").references(() => goodsReceiptsTable.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierName: text("supplier_name").notNull(),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
  status: prReturnStatusEnum("status").notNull().default("draft"),
  returnDate: timestamp("return_date").defaultNow().notNull(),
  reason: text("reason"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("purchase_returns_po_idx").on(t.poId),
  index("purchase_returns_status_idx").on(t.status),
]);

export const purchaseReturnLinesTable = pgTable("purchase_return_lines", {
  id: serial("id").primaryKey(),
  returnId: integer("return_id").notNull().references(() => purchaseReturnsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  unit: text("unit").notNull().default("pcs"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  reason: text("reason"),
}, (t) => [
  index("purchase_return_lines_return_idx").on(t.returnId),
]);

// ── Vendor Invoices ────────────────────────────────────────────────────────────

export const vendorInvoicesTable = pgTable("vendor_invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  vendorInvoiceRef: text("vendor_invoice_ref"),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierName: text("supplier_name").notNull(),
  poId: integer("po_id").references(() => purchaseDocumentsTable.id, { onDelete: "set null" }),
  grId: integer("gr_id").references(() => goodsReceiptsTable.id, { onDelete: "set null" }),
  mktPurchaseOrderId: integer("mkt_purchase_order_id").references(() => mktPurchaseOrdersTable.id, { onDelete: "set null" }),
  mktGoodsReceiptId: integer("mkt_goods_receipt_id").references(() => mktPoGoodsReceiptsTable.id, { onDelete: "set null" }),
  status: viStatusEnum("status").notNull().default("draft"),
  invoiceDate: timestamp("invoice_date").defaultNow().notNull(),
  dueDate: timestamp("due_date"),
  paymentTermDays: integer("payment_term_days").default(30),
  currency: text("currency").notNull().default("IDR"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  withholdingTaxAmount: numeric("withholding_tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxReviewStatus: text("tax_review_status").notNull().default("not_required"),
  taxReviewReason: text("tax_review_reason"),
  withholdingReviewStatus: text("withholding_review_status").notNull().default("not_required"),
  withholdingReviewCompletedBy: text("withholding_review_completed_by"),
  withholdingReviewCompletedAt: timestamp("withholding_review_completed_at"),
  withholdingTaxType: text("withholding_tax_type"),
  taxObject: text("tax_object"),
  withholdingTaxAmount: numeric("withholding_tax_amount", { precision: 14, scale: 2 }),
  grandTotal: numeric("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
  amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }).notNull().default("0"),
  threeWayMatchStatus: text("three_way_match_status").notNull().default("unmatched"),
  matchNotes: text("match_notes"),
  journalEntryId: integer("journal_entry_id"),
  notes: text("notes"),
  invoiceBreakdown: jsonb("invoice_breakdown").$type<Record<string, unknown> | null>(),
  attachmentObjectPath: text("attachment_object_path"),
  attachmentFileName: text("attachment_file_name"),
  attachmentContentType: text("attachment_content_type"),
  attachmentSize: integer("attachment_size"),
  categoryKey: text("category_key"),
  templateId: text("template_id"),
  templateVersion: text("template_version"),
  templateSnapshot: jsonb("template_snapshot").$type<Record<string, unknown> | null>(),
  cancelledAt: timestamp("cancelled_at"),
  // SAP Invoice Lock fields
  isLocked: boolean("is_locked").notNull().default(false),
  sapLockSnapshot: jsonb("sap_lock_snapshot").$type<Record<string, unknown> | null>(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("vi_po_idx").on(t.poId),
  index("vi_supplier_idx").on(t.supplierId),
  index("vi_status_idx").on(t.status),
]);

export const vendorInvoiceLinesTable = pgTable("vendor_invoice_lines", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => vendorInvoicesTable.id, { onDelete: "cascade" }),
  mktPurchaseOrderLineId: integer("mkt_purchase_order_line_id").references(() => mktPurchaseOrderLinesTable.id, { onDelete: "set null" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unit: text("unit").notNull().default("pcs"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  coaHint: text("coa_hint"),
  coaAccountId: integer("coa_account_id"),
  coaResolutionStatus: text("coa_resolution_status").notNull().default("unresolved"),
  coaConfirmedBy: text("coa_confirmed_by"),
  coaConfirmedAt: timestamp("coa_confirmed_at"),
  coaMappingKey: text("coa_mapping_key"),
  notes: text("notes"),
}, (t) => [
  index("vi_lines_invoice_idx").on(t.invoiceId),
]);

/**
 * One row per withholding tax object on an invoice line.  Keeping this
 * separate from vendor_invoices prevents a header-level PPh value from being
 * applied to every line of a multi-line invoice.
 */
export const vendorInvoiceLineTaxesTable = pgTable("vendor_invoice_line_taxes", {
  id: serial("id").primaryKey(),
  invoiceLineId: integer("invoice_line_id").notNull()
    .references(() => vendorInvoiceLinesTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  taxType: text("tax_type").notNull(),
  taxObject: text("tax_object").notNull(),
  baseAmount: numeric("base_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  liabilityAccountId: integer("liability_account_id"),
  resolutionStatus: text("resolution_status").notNull().default("tax_review"),
  reviewReason: text("review_reason"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("vendor_invoice_line_taxes_line_idx").on(t.invoiceLineId),
  index("vendor_invoice_line_taxes_company_idx").on(t.companyId),
]);

/**
 * Approved, reusable line-to-COA mappings.  Supplier and product are optional
 * refinements, but company ownership is mandatory.
 */
export const vendorInvoiceCoaMappingsTable = pgTable("vendor_invoice_coa_mappings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  mappingKey: text("mapping_key").notNull(),
  coaAccountId: integer("coa_account_id").notNull(),
  status: text("status").notNull().default("approved"),
  approvedBy: text("approved_by").notNull(),
  approvedAt: timestamp("approved_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("vendor_invoice_coa_mapping_scope_unique").on(
    t.companyId, t.supplierId, t.productId, t.mappingKey,
  ),
  index("vendor_invoice_coa_mapping_company_idx").on(t.companyId),
  index("vendor_invoice_coa_mapping_lookup_idx").on(t.companyId, t.supplierId, t.productId, t.mappingKey),
]);

/**
 * Withholding evidence/proof lifecycle.  A confirmed tax without a proof row
 * is deliberately not considered payable/settled.
 */
export const vendorWithholdingRecordsTable = pgTable("vendor_withholding_records", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  vendorInvoiceId: integer("vendor_invoice_id").notNull()
    .references(() => vendorInvoicesTable.id, { onDelete: "restrict" }),
  invoiceLineId: integer("invoice_line_id").notNull()
    .references(() => vendorInvoiceLinesTable.id, { onDelete: "restrict" }),
  lineTaxId: integer("line_tax_id").notNull()
    .references(() => vendorInvoiceLineTaxesTable.id, { onDelete: "restrict" }),
  taxType: text("tax_type").notNull(),
  taxObject: text("tax_object").notNull(),
  baseAmount: numeric("base_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  liabilityAccountId: integer("liability_account_id"),
  status: text("status").notNull().default("proof_pending"),
  proofObjectPath: text("proof_object_path"),
  proofReference: text("proof_reference"),
  proofContentType: text("proof_content_type"),
  proofIssuedAt: timestamp("proof_issued_at"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("vendor_withholding_line_tax_unique").on(t.lineTaxId),
  index("vendor_withholding_company_idx").on(t.companyId),
  index("vendor_withholding_invoice_idx").on(t.vendorInvoiceId),
  index("vendor_withholding_status_idx").on(t.status),
]);

// ── Payment Requests ───────────────────────────────────────────────────────────

export const paymentRequestsTable = pgTable("payment_requests", {
  id: serial("id").primaryKey(),
  payReqNumber: text("pay_req_number").notNull().unique(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierName: text("supplier_name").notNull(),
  status: payReqStatusEnum("status").notNull().default("draft"),
  requestedBy: text("requested_by"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("IDR"),
  paymentMethod: text("payment_method"),
  bankAccount: text("bank_account"),
  paymentDate: timestamp("payment_date"),
  journalEntryId: integer("journal_entry_id"),
  notes: text("notes"),
  // Marketplace AP handoff metadata. These fields are additive and do not
  // authorize, execute, post, or settle a payment.
  sourceType: text("source_type"),
  sourceId: integer("source_id"),
  mktApPreparationId: integer("mkt_ap_preparation_id"),
  idempotencyKey: text("idempotency_key"),
  payloadFingerprint: text("payload_fingerprint"),
  mktLifecycleStatus: text("mkt_lifecycle_status"),
  mktFinanceReviewedBy: text("mkt_finance_reviewed_by"),
  mktFinanceReviewedAt: timestamp("mkt_finance_reviewed_at"),
  mktApprovedBy: text("mkt_approved_by"),
  mktApprovedAt: timestamp("mkt_approved_at"),
  mktTreasuryReadyBy: text("mkt_treasury_ready_by"),
  mktTreasuryReadyAt: timestamp("mkt_treasury_ready_at"),
  mktExecutionStartedAt: timestamp("mkt_execution_started_at"),
  mktCompletedAt: timestamp("mkt_completed_at"),
  mktFailureCode: text("mkt_failure_code"),
  mktFailureReason: text("mkt_failure_reason"),
  mktFailureAt: timestamp("mkt_failure_at"),
  mktFailedBy: text("mkt_failed_by"),
  mktCancellationIdempotencyKey: text("mkt_cancellation_idempotency_key"),
  mktCancelledBy: text("mkt_cancelled_by"),
  mktCancellationReason: text("mkt_cancellation_reason"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("pay_req_supplier_idx").on(t.supplierId),
  index("pay_req_status_idx").on(t.status),
  index("pay_req_source_idx").on(t.sourceType, t.sourceId),
  index("pay_req_mkt_ap_idx").on(t.mktApPreparationId),
  unique("pay_req_idempotency_unique").on(t.idempotencyKey),
  unique("pay_req_mkt_ap_unique").on(t.mktApPreparationId),
]);

export const paymentRequestItemsTable = pgTable("payment_request_items", {
  id: serial("id").primaryKey(),
  paymentRequestId: integer("payment_request_id").notNull().references(() => paymentRequestsTable.id, { onDelete: "cascade" }),
  vendorInvoiceId: integer("vendor_invoice_id").references(() => vendorInvoicesTable.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
}, (t) => [
  index("pay_req_items_pr_idx").on(t.paymentRequestId),
]);

// ── Landed Costs ───────────────────────────────────────────────────────────────

export const landedCostsTable = pgTable("landed_costs", {
  id: serial("id").primaryKey(),
  lcNumber: text("lc_number").notNull().unique(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  grId: integer("gr_id").references(() => goodsReceiptsTable.id, { onDelete: "set null" }),
  poId: integer("po_id").references(() => purchaseDocumentsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"),
  allocationMethod: lcMethodEnum("allocation_method").notNull().default("by_amount"),
  notes: text("notes"),
  totalCost: numeric("total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("landed_costs_gr_idx").on(t.grId),
  index("landed_costs_po_idx").on(t.poId),
]);

export const landedCostLinesTable = pgTable("landed_cost_lines", {
  id: serial("id").primaryKey(),
  lcId: integer("lc_id").notNull().references(() => landedCostsTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  accountId: integer("account_id"),
}, (t) => [
  index("lc_lines_lc_idx").on(t.lcId),
]);

export const landedCostAllocationsTable = pgTable("landed_cost_allocations", {
  id: serial("id").primaryKey(),
  lcId: integer("lc_id").notNull().references(() => landedCostsTable.id, { onDelete: "cascade" }),
  grLineId: integer("gr_line_id").references(() => goodsReceiptLinesTable.id, { onDelete: "set null" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  allocatedAmount: numeric("allocated_amount", { precision: 14, scale: 2 }).notNull().default("0"),
}, (t) => [
  index("lc_alloc_lc_idx").on(t.lcId),
]);

// ── Purchase Receipts (Simple GRN — managed by inventoryReceive route) ────────

export const purchaseReceiptsTable = pgTable("purchase_receipts", {
  id: serial("id").primaryKey(),
  receiptNo: text("receipt_no").notNull().unique(),
  poId: integer("po_id").notNull()
    .references(() => purchaseDocumentsTable.id, { onDelete: "restrict" }),
  warehouseId: integer("warehouse_id").notNull()
    .references(() => warehousesTable.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("posted"),
  notes: text("notes"),
  receivedBy: text("received_by"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("purchase_receipts_po_idx").on(t.poId),
  index("purchase_receipts_wh_idx").on(t.warehouseId),
]);

export const purchaseReceiptLinesTable = pgTable("purchase_receipt_lines", {
  id: serial("id").primaryKey(),
  receiptId: integer("receipt_id").notNull()
    .references(() => purchaseReceiptsTable.id, { onDelete: "cascade" }),
  poLineId: integer("po_line_id")
    .references(() => purchaseDocumentLinesTable.id, { onDelete: "set null" }),
  productId: integer("product_id")
    .references(() => productsTable.id, { onDelete: "set null" }),
  rackId: integer("rack_id")
    .references(() => warehouseRacksTable.id, { onDelete: "set null" }),
  qtyOrdered: numeric("qty_ordered", { precision: 12, scale: 3 }).notNull().default("0"),
  qtyReceived: numeric("qty_received", { precision: 12, scale: 3 }).notNull().default("0"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  totalCost: numeric("total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
}, (t) => [
  index("purchase_receipt_lines_receipt_idx").on(t.receiptId),
]);

// ── Zod Insert Schemas ─────────────────────────────────────────────────────────

export const insertPurchaseRequestSchema = createInsertSchema(purchaseRequestsTable).omit({ id: true, createdAt: true, updatedAt: true, prNumber: true });
export const insertPurchaseRequestLineSchema = createInsertSchema(purchaseRequestLinesTable).omit({ id: true });
export const insertPurchaseApprovalSchema = createInsertSchema(purchaseApprovalsTable).omit({ id: true, createdAt: true });

export const insertVendorQuotationSchema = createInsertSchema(vendorQuotationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertVendorQuotationLineSchema = createInsertSchema(vendorQuotationLinesTable).omit({ id: true });

export const insertGoodsReceiptSchema = createInsertSchema(goodsReceiptsTable).omit({ id: true, createdAt: true, updatedAt: true, grNumber: true });
export const insertGoodsReceiptLineSchema = createInsertSchema(goodsReceiptLinesTable).omit({ id: true });

export const insertQcInspectionSchema = createInsertSchema(qcInspectionsTable).omit({ id: true, createdAt: true, updatedAt: true, qcNumber: true });
export const insertQcLineSchema = createInsertSchema(qcLinesTable).omit({ id: true });

export const insertPurchaseReturnSchema = createInsertSchema(purchaseReturnsTable).omit({ id: true, createdAt: true, updatedAt: true, returnNumber: true });
export const insertPurchaseReturnLineSchema = createInsertSchema(purchaseReturnLinesTable).omit({ id: true });

export const insertVendorInvoiceSchema = createInsertSchema(vendorInvoicesTable).omit({ id: true, createdAt: true, updatedAt: true, invoiceNumber: true });
export const insertVendorInvoiceLineSchema = createInsertSchema(vendorInvoiceLinesTable).omit({ id: true });

export const insertPaymentRequestSchema = createInsertSchema(paymentRequestsTable).omit({ id: true, createdAt: true, updatedAt: true, payReqNumber: true });
export const insertPaymentRequestItemSchema = createInsertSchema(paymentRequestItemsTable).omit({ id: true });

export const insertLandedCostSchema = createInsertSchema(landedCostsTable).omit({ id: true, createdAt: true, updatedAt: true, lcNumber: true });
export const insertLandedCostLineSchema = createInsertSchema(landedCostLinesTable).omit({ id: true });
export const insertLandedCostAllocationSchema = createInsertSchema(landedCostAllocationsTable).omit({ id: true });

export const insertPurchaseReceiptSchema = createInsertSchema(purchaseReceiptsTable).omit({ id: true, createdAt: true, updatedAt: true, receiptNo: true });
export const insertPurchaseReceiptLineSchema = createInsertSchema(purchaseReceiptLinesTable).omit({ id: true });

// ── Types ──────────────────────────────────────────────────────────────────────

export type UomMaster = typeof uomTable.$inferSelect;
export type UomConversion = typeof uomConversionsTable.$inferSelect;
export type PurchaseRequest = typeof purchaseRequestsTable.$inferSelect;
export type PurchaseRequestLine = typeof purchaseRequestLinesTable.$inferSelect;
export type PurchaseApproval = typeof purchaseApprovalsTable.$inferSelect;
export type VendorQuotation = typeof vendorQuotationsTable.$inferSelect;
export type VendorQuotationLine = typeof vendorQuotationLinesTable.$inferSelect;
export type GoodsReceipt = typeof goodsReceiptsTable.$inferSelect;
export type GoodsReceiptLine = typeof goodsReceiptLinesTable.$inferSelect;
export type QcInspection = typeof qcInspectionsTable.$inferSelect;
export type QcLine = typeof qcLinesTable.$inferSelect;
export type PurchaseReturn = typeof purchaseReturnsTable.$inferSelect;
export type PurchaseReturnLine = typeof purchaseReturnLinesTable.$inferSelect;
export type VendorInvoice = typeof vendorInvoicesTable.$inferSelect;
export type VendorInvoiceLine = typeof vendorInvoiceLinesTable.$inferSelect;
export type VendorInvoiceLineTax = typeof vendorInvoiceLineTaxesTable.$inferSelect;
export type VendorInvoiceCoaMapping = typeof vendorInvoiceCoaMappingsTable.$inferSelect;
export type VendorWithholdingRecord = typeof vendorWithholdingRecordsTable.$inferSelect;
export type PaymentRequest = typeof paymentRequestsTable.$inferSelect;
export type PaymentRequestItem = typeof paymentRequestItemsTable.$inferSelect;
export type LandedCost = typeof landedCostsTable.$inferSelect;
export type LandedCostLine = typeof landedCostLinesTable.$inferSelect;
export type LandedCostAllocation = typeof landedCostAllocationsTable.$inferSelect;
export type PurchaseReceipt = typeof purchaseReceiptsTable.$inferSelect;
export type PurchaseReceiptLine = typeof purchaseReceiptLinesTable.$inferSelect;
