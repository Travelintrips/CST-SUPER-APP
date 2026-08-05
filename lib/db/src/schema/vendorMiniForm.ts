import { pgTable, serial, integer, text, boolean, timestamp, jsonb, numeric, uniqueIndex } from "drizzle-orm/pg-core";
// Note: integer imported for accessCount
import { sql } from "drizzle-orm";
import { suppliersTable } from "./suppliers";

export const vendorMiniFormLinksTable = pgTable("vendor_mini_form_links", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  serviceType: text("service_type").notNull(),
  title: text("title"),
  notes: text("notes"),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  shortUrl: text("short_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: text("created_by"),
  // Order-based mode columns
  mode: text("mode").notNull().default("rate_collection"),
  orderId: integer("order_id"),
  orderNumber: text("order_number"),
  orderItemId: integer("order_item_id"),
  itemStatus: text("item_status").default("waiting_vendor"),
  phase: text("phase").default("quotation"),
  vendorName: text("vendor_name"),
  // Security & limits
  maxSubmissions: integer("max_submissions"),
  resubmitAllowed: boolean("resubmit_allowed").default(false),
  // Internal
  adminNotes: text("admin_notes"),
  // Target audience: vendor | customer | admin
  formTarget: text("form_target").notNull().default("vendor"),
  // Commodity template integration (legacy)
  commodityTemplateId: integer("commodity_template_id"),
  // Product Template Engine columns (Step 1F cutover)
  categoryKey: text("category_key"),
  templateId: text("template_id"),
  templateVersion: text("template_version"),
  templateSnapshot: jsonb("template_snapshot").$type<Record<string, unknown> | null>(),
});

export const vendorMiniFormSubmissionsTable = pgTable("vendor_mini_form_submissions", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").references(() => vendorMiniFormLinksTable.id, { onDelete: "set null" }),
  token: text("token").notNull().unique(),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  serviceType: text("service_type").notNull(),
  vendorName: text("vendor_name"),
  contactPerson: text("contact_person"),
  contactPhone: text("contact_phone"),
  formData: jsonb("form_data").notNull().default({}),
  staffData: jsonb("staff_data").notNull().default({}),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  // Order-based fields
  responseStatus: text("response_status").default("submitted"),
  vendorPrice: numeric("vendor_price", { precision: 14, scale: 2 }),
  currency: text("currency").default("IDR"),
  eta: text("eta"),
  validUntil: text("valid_until"),
  attachmentUrl: text("attachment_url"),
  orderId: integer("order_id"),
  orderItemId: integer("order_item_id"),
  selectedByAdmin: boolean("selected_by_admin").default(false),
  selectedAt: timestamp("selected_at"),
  // Security tracking
  submittedIp: text("submitted_ip"),
  submittedUa: text("submitted_ua"),
  // Revision tracking
  revisionCount: integer("revision_count").default(0),
  // Admin internal
  adminNotes: text("admin_notes"),
  // Lock after customer approve
  locked: boolean("locked").default(false),
  unlockReason: text("unlock_reason"),
  // ── Template Engine: version snapshot of the form template used at submission time ─
  templateId: text("template_id"),
  templateVersion: text("template_version"),
  templateSnapshot: jsonb("template_snapshot").$type<Record<string, unknown> | null>(),
  // ── Media Foundation ──────────────────────────────────────────────────────
  mediaAssets: jsonb("media_assets").$type<Record<string, unknown>[]>().notNull().default([]),
}, (t) => [
  // Mencegah vendor yang sama (supplier_id tidak null) submit 2x untuk link yang sama.
  // Vendor anonim (supplier_id IS NULL) dikecualikan karena diidentifikasi via token unik.
  uniqueIndex("vmf_submissions_link_supplier_uidx")
    .on(t.linkId, t.supplierId)
    .where(sql`${t.supplierId} IS NOT NULL`),
]);

export const customerApprovalsTable = pgTable("customer_approvals", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  orderId: integer("order_id"),
  orderNumber: text("order_number"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  offerSummary: jsonb("offer_summary").default({}),
  // Margin calculator fields
  submissionId: integer("submission_id"),
  vendorCost: numeric("vendor_cost", { precision: 14, scale: 2 }),
  markupPct: numeric("markup_pct", { precision: 8, scale: 2 }),
  markupNominal: numeric("markup_nominal", { precision: 14, scale: 2 }),
  sellingPrice: numeric("selling_price", { precision: 14, scale: 2 }),
  currency: text("currency").default("IDR"),
  ppnPct: numeric("ppn_pct", { precision: 5, scale: 2 }).default("11"),
  ppnNominal: numeric("ppn_nominal", { precision: 14, scale: 2 }),
  profitMarginPct: numeric("profit_margin_pct", { precision: 8, scale: 2 }),
  termsNotes: text("terms_notes"),
  adminNotes: text("admin_notes"),
  status: text("status").notNull().default("pending"),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  notes: text("notes"),
  soId: integer("so_id"),
  soNumber: text("so_number"),
  locked: boolean("locked").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: text("created_by"),
  expiresAt: timestamp("expires_at"),
  usedAt: timestamp("used_at"),
  revokedAt: timestamp("revoked_at"),
  categoryKey: text("category_key"),
  templateId: text("template_id"),
  templateVersion: text("template_version"),
  templateSnapshot: jsonb("template_snapshot").$type<Record<string, unknown> | null>(),
  requiredDocumentsFromTemplate: jsonb("required_documents_from_template").$type<string[] | null>(),
  checklistFromTemplate: jsonb("checklist_from_template").$type<string[] | null>(),
  // ── Media Foundation ──────────────────────────────────────────────────────
  mediaAssets: jsonb("media_assets").$type<Record<string, unknown>[]>().notNull().default([]),
});

export const vendorOperationalConfirmationsTable = pgTable("vendor_operational_confirmations", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  orderId: integer("order_id"),
  orderNumber: text("order_number"),
  orderItemId: integer("order_item_id"),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  vendorName: text("vendor_name"),
  serviceType: text("service_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("pending"),
  submittedAt: timestamp("submitted_at"),
  instruction: text("instruction"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vendorPriceHistoryTable = pgTable("vendor_price_history", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id").references(() => vendorMiniFormSubmissionsTable.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull().default(1),
  oldPrice: numeric("old_price", { precision: 14, scale: 2 }),
  newPrice: numeric("new_price", { precision: 14, scale: 2 }),
  currency: text("currency").default("IDR"),
  reason: text("reason"),
  changedBy: text("changed_by"),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
});

export const vmfActivityLogTable = pgTable("vmf_activity_log", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), // link|submission|customer_approval|op_confirm
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(), // submitted|selected|revision_requested|sent_wa|approved|rejected|so_created|locked|unlocked|created
  actor: text("actor"), // user id | "vendor" | "customer" | "system"
  note: text("note"),
  data: jsonb("data").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customerInvoiceLinksTable = pgTable("customer_invoice_links", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  salesDocId: integer("sales_doc_id"),
  orderId: integer("order_id"),
  orderNumber: text("order_number"),
  invoiceNumber: text("invoice_number"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  currency: text("currency").default("IDR"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).default("11"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }),
  grandTotal: numeric("grand_total", { precision: 14, scale: 2 }),
  amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }).default("0"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  paymentMethod: text("payment_method"),
  dueDate: timestamp("due_date"),
  notes: text("notes"),
  lineItems: jsonb("line_items").default([]),
  viewedAt: timestamp("viewed_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  confirmedAt: timestamp("confirmed_at"),
  status: text("status").notNull().default("sent"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  lastAccessedAt: timestamp("last_accessed_at"),
  accessCount: integer("access_count").notNull().default(0),
  // Template context snapshot (immutable at creation time)
  categoryKey: text("category_key"),
  templateId: text("template_id"),
  templateVersion: text("template_version"),
  templateSnapshot: jsonb("template_snapshot").$type<Record<string, unknown> | null>(),
});

export type VendorMiniFormLink = typeof vendorMiniFormLinksTable.$inferSelect;
export type InsertVendorMiniFormLink = typeof vendorMiniFormLinksTable.$inferInsert;
export type VendorMiniFormSubmission = typeof vendorMiniFormSubmissionsTable.$inferSelect;
export type InsertVendorMiniFormSubmission = typeof vendorMiniFormSubmissionsTable.$inferInsert;
export type CustomerApproval = typeof customerApprovalsTable.$inferSelect;
export type InsertCustomerApproval = typeof customerApprovalsTable.$inferInsert;
export type CustomerInvoiceLink = typeof customerInvoiceLinksTable.$inferSelect;
export type VendorOperationalConfirmation = typeof vendorOperationalConfirmationsTable.$inferSelect;
export type InsertVendorOperationalConfirmation = typeof vendorOperationalConfirmationsTable.$inferInsert;
export type VendorPriceHistory = typeof vendorPriceHistoryTable.$inferSelect;
export type VmfActivityLog = typeof vmfActivityLogTable.$inferSelect;
