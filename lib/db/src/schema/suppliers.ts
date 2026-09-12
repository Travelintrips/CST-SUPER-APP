import { pgTable, serial, text, integer, timestamp, boolean, numeric, index, jsonb, date, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { productsTable } from "./products";

// ─── Supplier Status ──────────────────────────────────────────────────────────
// Nilai valid: pending | active | inactive | suspended | blacklisted | archived
// isActive dipertahankan untuk backward compat (diupdate bersamaan oleh updateSupplierStatus)

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  country: text("country"),
  contactEmail: text("contact_email"),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  address: text("address"),
  taxId: text("tax_id"),
  npwp: text("npwp"),
  nib: text("nib"),
  defaultPurchaseTaxId: integer("default_purchase_tax_id"),
  serviceType: text("service_type"),
  isActive: boolean("is_active").notNull().default(true),
  logo: text("logo").notNull().default("📦"),
  eta: text("eta"),
  fee: numeric("fee", { precision: 12, scale: 2 }).default("0"),
  markup: numeric("markup", { precision: 5, scale: 2 }).default("0"),
  note: text("note"),
  sortOrder: integer("sort_order").notNull().default(0),
  yearVehicle: integer("year_vehicle"),
  supportedModes: text("supported_modes").array(),
  etaDaysMin: integer("eta_days_min"),
  etaDaysMax: integer("eta_days_max"),
  hasInternalTruck: boolean("has_internal_truck").notNull().default(false),
  internalTruckPrice: numeric("internal_truck_price", { precision: 14, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  // ── Fase 1: Status Granular ──────────────────────────────────────────────────
  status: text("status").notNull().default("active"),
  vendorCode: text("vendor_code"),
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  verifiedBy: text("verified_by"),
  statusReason: text("status_reason"),
  statusChangedAt: timestamp("status_changed_at"),
  statusChangedBy: text("status_changed_by"),

  // ── Fase 2: Profil Marketplace ───────────────────────────────────────────────
  logoUrl: text("logo_url"),
  coverUrl: text("cover_url"),
  descriptionPublic: text("description_public"),
  serviceAreas: jsonb("service_areas").$type<string[]>(),
  isPremium: boolean("is_premium").notNull().default(false),
  isFeatured: boolean("is_featured").notNull().default(false),
  marketplaceStatus: text("marketplace_status").notNull().default("draft"),
  marketplacePublishedAt: timestamp("marketplace_published_at"),
  marketplacePublishedBy: text("marketplace_published_by"),
  publicSlug: text("public_slug"),

  // ── Internal Vendor Flag ─────────────────────────────────────────────────────
  // Platform tidak mengambil markup dari vendor internal (perusahaan sendiri).
  // Set true untuk entitas dalam grup CST (misal PT Cahaya Sejati Teknologi, dll.)
  isInternalVendor: boolean("is_internal_vendor").notNull().default(false),

  // ── Company Profile Extended ─────────────────────────────────────────────────
  companyBanner: text("company_banner"),
  vision: text("vision"),
  mission: text("mission"),
  establishedYear: integer("established_year"),
  mainMarket: text("main_market"),
  factoryAddress: text("factory_address"),
  officeAddress: text("office_address"),
  warehouseAddress: text("warehouse_address"),
  website: text("website"),
  socialMedia: jsonb("social_media"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
}, (t) => [
  index("suppliers_company_idx").on(t.companyId),
  index("suppliers_status_idx").on(t.status),
  index("suppliers_is_verified_idx").on(t.isVerified),
  index("suppliers_marketplace_status_idx").on(t.marketplaceStatus),
  uniqueIndex("suppliers_public_slug_unique").on(t.publicSlug),
  uniqueIndex("suppliers_vendor_code_unique").on(t.vendorCode),
]);

export const vendorCatalogItemsTable = pgTable("vendor_catalog_items", {
  // ── Core identity ──────────────────────────────────────────────────────────
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => suppliersTable.id),
  vendorName: text("vendor_name"),
  masterItemId: integer("master_item_id").references(() => productsTable.id, { onDelete: "set null" }),

  // ── Legacy fields (backward compat) ───────────────────────────────────────
  type: text("type").notNull().default("service"),
  name: text("name").notNull(),
  description: text("description"),
  unit: text("unit"),
  kategori: text("kategori"),
  subcategory: text("subcategory"),
  isCommodityTag: boolean("is_commodity_tag").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),

  // ── Template engine ────────────────────────────────────────────────────────
  templateKind: text("template_kind"),
  categoryKey: text("category_key"),
  serviceType: text("service_type"),
  templateId: text("template_id"),
  templateVersion: text("template_version"),
  templateSnapshot: jsonb("template_snapshot"),
  specValues: jsonb("spec_values"),

  // ── Pricing (priceBase = internal cost, NEVER expose to customer) ──────────
  priceBase: numeric("price_base", { precision: 15, scale: 2 }).notNull().default("0"),
  markupPct: numeric("markup_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  priceSell: numeric("price_sell", { precision: 15, scale: 2 }),
  currency: text("currency").notNull().default("IDR"),

  // ── Availability ──────────────────────────────────────────────────────────
  stockStatus: text("stock_status"),
  stockQty: numeric("stock_qty", { precision: 15, scale: 3 }),
  moq: numeric("moq", { precision: 15, scale: 3 }),
  leadTime: text("lead_time"),
  validityDate: date("validity_date"),

  // ── Origin / location ─────────────────────────────────────────────────────
  location: text("location"),
  origin: text("origin"),

  // ── Attachments ───────────────────────────────────────────────────────────
  documents: jsonb("documents"),
  // ── HS Code ───────────────────────────────────────────────────────────────
  hsCode: text("hs_code"),
  // ── Media Foundation ──────────────────────────────────────────────────────
  mediaAssets: jsonb("media_assets").$type<Record<string, unknown>[]>().notNull().default([]),

  // ── Publication state ─────────────────────────────────────────────────────
  status: text("status").notNull().default("draft"),
  isPublished: boolean("is_published").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sourceSubmissionId: integer("source_submission_id"),
  publishedAt: timestamp("published_at"),

  // ── Timestamps ────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),

  // ── Analytics counters ─────────────────────────────────────────────────────
  viewCount:  integer("view_count").notNull().default(0),
  quoteCount: integer("quote_count").notNull().default(0),
  orderCount: integer("order_count").notNull().default(0),

  // ── Featured ──────────────────────────────────────────────────────────────
  isFeatured:   boolean("is_featured").notNull().default(false),
  featuredUntil: timestamp("featured_until"),
  // Featured Product promotion (additive) — priority ordering + explicit window.
  featuredPriority: integer("featured_priority").notNull().default(0),
  featuredStartAt: timestamp("featured_start_at"),
}, (t) => [
  index("vendor_catalog_vendor_idx").on(t.vendorId),
  index("vendor_catalog_status_idx").on(t.status, t.isPublished),
  index("vendor_catalog_category_idx").on(t.categoryKey),
  index("vendor_catalog_service_type_idx").on(t.serviceType),
  index("vendor_catalog_featured_idx").on(t.isFeatured, t.featuredPriority),
]);

// ─── supplier_documents ───────────────────────────────────────────────────────
// Penyimpanan permanen dokumen legalitas vendor (Fase 3)

export const supplierDocumentsTable = pgTable("supplier_documents", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  documentNumber: text("document_number"),
  documentName: text("document_name"),
  fileUrl: text("file_url"),
  issuedAt: date("issued_at"),
  expiresAt: date("expires_at"),
  verificationStatus: text("verification_status").notNull().default("pending"),
  verifiedAt: timestamp("verified_at"),
  verifiedBy: text("verified_by"),
  rejectionReason: text("rejection_reason"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  uploadedBy: text("uploaded_by"),
  source: text("source"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // ── Soft Delete (Phase Final — C) ─────────────────────────────────────────
  // Dokumen tidak langsung dihapus permanen — set deleted_at + deleted_by.
  // Query aktif wajib filter isNull(deletedAt). Admin bisa melihat histori.
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
}, (t) => [
  index("supplier_docs_supplier_idx").on(t.supplierId),
  index("supplier_docs_type_idx").on(t.documentType),
  index("supplier_docs_expires_idx").on(t.expiresAt),
  index("supplier_docs_deleted_idx").on(t.deletedAt),
]);

// ─── supplier_status_history ──────────────────────────────────────────────────
// Audit log setiap perubahan status vendor (Fase 1)

export const supplierStatusHistoryTable = pgTable("supplier_status_history", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  previousStatus: text("previous_status"),
  newStatus: text("new_status").notNull(),
  reason: text("reason"),
  actorUserId: text("actor_user_id"),
  companyId: integer("company_id"),
  requestId: text("request_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("supplier_status_hist_supplier_idx").on(t.supplierId),
  index("supplier_status_hist_created_idx").on(t.createdAt),
]);

// ─── supplier_reviews ─────────────────────────────────────────────────────────
// Rating & review vendor dari buyer (Fase 6)

export const supplierReviewsTable = pgTable("supplier_reviews", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"),
  sourceTransactionType: text("source_transaction_type"),
  sourceTransactionId: integer("source_transaction_id"),
  ratingOverall: numeric("rating_overall", { precision: 3, scale: 1 }).notNull(),
  ratingDelivery: numeric("rating_delivery", { precision: 3, scale: 1 }),
  ratingCommunication: numeric("rating_communication", { precision: 3, scale: 1 }),
  ratingQuality: numeric("rating_quality", { precision: 3, scale: 1 }),
  reviewText: text("review_text"),
  isPublished: boolean("is_published").notNull().default(false),
  moderationStatus: text("moderation_status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("supplier_reviews_supplier_idx").on(t.supplierId),
  index("supplier_reviews_source_idx").on(t.sourceTransactionType, t.sourceTransactionId),
  index("supplier_reviews_customer_idx").on(t.customerId),
]);

// ─── vendor_audit_logs ────────────────────────────────────────────────────────
// Audit trail untuk semua aksi Vendor Profile (Phase Final — A).
// Setiap write operation (status change, verify, publish, dokumen, review, dll)
// mencatat actor, before/after state, IP, dan user-agent.

export const vendorAuditLogsTable = pgTable("vendor_audit_logs", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("vendor_audit_logs_supplier_idx").on(t.supplierId),
  index("vendor_audit_logs_action_idx").on(t.action),
  index("vendor_audit_logs_created_idx").on(t.createdAt),
]);

export type VendorAuditLog = typeof vendorAuditLogsTable.$inferSelect;

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({ id: true, createdAt: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;

export const insertVendorCatalogItemSchema = createInsertSchema(vendorCatalogItemsTable).omit({ id: true, createdAt: true });
export type InsertVendorCatalogItem = z.infer<typeof insertVendorCatalogItemSchema>;
export type VendorCatalogItem = typeof vendorCatalogItemsTable.$inferSelect;

export type SupplierDocument = typeof supplierDocumentsTable.$inferSelect;
export type SupplierStatusHistory = typeof supplierStatusHistoryTable.$inferSelect;
export type SupplierReview = typeof supplierReviewsTable.$inferSelect;
