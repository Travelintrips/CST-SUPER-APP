import {
  pgTable, serial, integer, text, boolean,
  timestamp, jsonb, numeric, index,
} from "drizzle-orm/pg-core";
import { suppliersTable } from "./suppliers";

// ── Admin-created links — vendor uses token to open submission form ───────────
export const vendorCatalogSubmissionLinksTable = pgTable("vendor_catalog_submission_links", {
  id:               serial("id").primaryKey(),
  token:            text("token").notNull().unique(),
  tokenHash:        text("token_hash"),           // P0 — HMAC-SHA256 hash; NULL for legacy tokens
  supplierId:       integer("supplier_id")
                      .references(() => suppliersTable.id, { onDelete: "cascade" })
                      .notNull(),
  vendorName:       text("vendor_name"),
  title:            text("title"),
  notes:            text("notes"),
  categoryKey:      text("category_key"),
  serviceType:      text("service_type"),
  templateKind:     text("template_kind"),
  templateId:       text("template_id"),
  templateVersion:  text("template_version"),
  templateSnapshot: jsonb("template_snapshot").$type<Record<string, unknown> | null>(),
  isActive:         boolean("is_active").notNull().default(true),
  expiresAt:        timestamp("expires_at"),
  maxSubmissions:   integer("max_submissions"),
  submissionCount:  integer("submission_count").notNull().default(0),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  createdBy:        text("created_by"),
}, (t) => [
  index("vcsl_supplier_idx").on(t.supplierId),
]);

// ── Vendor-initiated catalog submissions ──────────────────────────────────────
export const vendorCatalogSubmissionsTable = pgTable("vendor_catalog_submissions", {
  id:               serial("id").primaryKey(),
  linkId:           integer("link_id")
                      .references(() => vendorCatalogSubmissionLinksTable.id, { onDelete: "set null" }),
  token:            text("token").notNull().unique(),
  supplierId:       integer("supplier_id")
                      .references(() => suppliersTable.id, { onDelete: "set null" }),
  vendorName:       text("vendor_name"),

  // ── Template / spec ────────────────────────────────────────────────────────
  categoryKey:      text("category_key"),
  serviceType:      text("service_type"),
  templateKind:     text("template_kind"),
  templateId:       text("template_id"),
  templateVersion:  text("template_version"),
  templateSnapshot: jsonb("template_snapshot").$type<Record<string, unknown> | null>(),
  specValues:       jsonb("spec_values").$type<Record<string, unknown> | null>(),

  // ── Item info ──────────────────────────────────────────────────────────────
  name:             text("name").notNull(),
  description:      text("description"),
  unit:             text("unit"),

  // ── Media ──────────────────────────────────────────────────────────────────
  mediaAssets:      jsonb("media_assets")
                      .$type<Record<string, unknown>[]>()
                      .notNull()
                      .default([]),

  // ── Pricing ────────────────────────────────────────────────────────────────
  priceBase:        numeric("price_base", { precision: 15, scale: 2 }).notNull().default("0"),
  currency:         text("currency").notNull().default("IDR"),

  // ── Availability ──────────────────────────────────────────────────────────
  stockStatus:      text("stock_status"),
  stockQty:         numeric("stock_qty", { precision: 15, scale: 3 }),
  leadTime:         text("lead_time"),
  validityDate:     text("validity_date"),
  location:         text("location"),
  origin:           text("origin"),

  // ── Review flow ───────────────────────────────────────────────────────────
  // status: submitted | approved | rejected
  status:           text("status").notNull().default("submitted"),
  catalogItemId:    integer("catalog_item_id"),  // set after approval
  reviewedBy:       text("reviewed_by"),
  reviewedAt:       timestamp("reviewed_at"),
  reviewNotes:      text("review_notes"),

  submittedAt:      timestamp("submitted_at").defaultNow().notNull(),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow(),
}, (t) => [
  index("vcs_supplier_idx").on(t.supplierId),
  index("vcs_status_idx").on(t.status),
  index("vcs_link_idx").on(t.linkId),
]);

export type VendorCatalogSubmissionLink   = typeof vendorCatalogSubmissionLinksTable.$inferSelect;
export type InsertVendorCatalogSubmissionLink = typeof vendorCatalogSubmissionLinksTable.$inferInsert;
export type VendorCatalogSubmission       = typeof vendorCatalogSubmissionsTable.$inferSelect;
export type InsertVendorCatalogSubmission = typeof vendorCatalogSubmissionsTable.$inferInsert;
