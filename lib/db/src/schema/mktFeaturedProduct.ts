/**
 * mktFeaturedProduct.ts — Featured Product / Produk Unggulan Marketplace
 *
 * Additive schema for the vendor-paid "Featured Product" promotion feature.
 * Reuses existing vendor_catalog_items.is_featured / featured_until / featured_priority /
 * featured_start_at (see suppliers.ts) as the actual "is this item featured right now"
 * state — these two tables below are the request/package layer sitting on top of it.
 *
 * Status lifecycle (mkt_featured_product_requests.status):
 *   pending → approved → active → expired
 *                     └→ rejected
 *   pending/approved → cancelled (vendor or admin)
 *
 * Payment lifecycle (mkt_featured_product_requests.payment_status):
 *   unpaid → pending_verification → verified
 *                                 └→ rejected
 *   verified → refunded (rare, admin-only)
 *
 * Migration: featuredProductMigration.ts (idempotent, additive)
 */

import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { suppliersTable, vendorCatalogItemsTable } from "./suppliers";
import { companiesTable } from "./companies";

// ─── mkt_featured_packages ──────────────────────────────────────────────────
// Promotion packages an admin configures (e.g. "7 Hari Homepage Top").

export const mktFeaturedPackagesTable = pgTable("mkt_featured_packages", {
  id:             serial("id").primaryKey(),
  code:           text("code").notNull().unique(),
  name:           text("name").notNull(),
  description:    text("description"),
  durationDays:   integer("duration_days").notNull(),
  price:          numeric("price", { precision: 15, scale: 2 }).notNull().default("0"),
  currency:       text("currency").notNull().default("IDR"),
  placementType:  text("placement_type").notNull().default("homepage_top"),
  priorityWeight: integer("priority_weight").notNull().default(0),
  categoryId:     integer("category_id"),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export type MktFeaturedPackage = typeof mktFeaturedPackagesTable.$inferSelect;
export type MktFeaturedPackageInsert = typeof mktFeaturedPackagesTable.$inferInsert;

// ─── mkt_featured_product_requests ──────────────────────────────────────────
// One vendor's request to feature one catalog item using one package.

export const mktFeaturedProductRequestsTable = pgTable("mkt_featured_product_requests", {
  id:                serial("id").primaryKey(),
  companyId:         integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  vendorId:          integer("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  catalogItemId:     integer("catalog_item_id").notNull().references(() => vendorCatalogItemsTable.id, { onDelete: "cascade" }),
  packageId:         integer("package_id").notNull().references(() => mktFeaturedPackagesTable.id),

  status:            text("status").notNull().default("pending"), // pending | approved | rejected | active | expired | cancelled

  requestedStartAt:  timestamp("requested_start_at").notNull(),
  requestedEndAt:    timestamp("requested_end_at").notNull(),
  approvedStartAt:   timestamp("approved_start_at"),
  approvedEndAt:     timestamp("approved_end_at"),

  price:             numeric("price", { precision: 15, scale: 2 }).notNull().default("0"),
  currency:          text("currency").notNull().default("IDR"),

  paymentStatus:     text("payment_status").notNull().default("unpaid"), // unpaid | pending_verification | verified | rejected | refunded
  paymentReference:  text("payment_reference"),
  paymentProofUrl:   text("payment_proof_url"),
  paymentProofToken: text("payment_proof_token").unique(),

  adminNotes:        text("admin_notes"),
  rejectionReason:   text("rejection_reason"),

  approvedBy:        text("approved_by"),
  approvedAt:        timestamp("approved_at"),
  rejectedBy:        text("rejected_by"),
  rejectedAt:        timestamp("rejected_at"),
  activatedAt:       timestamp("activated_at"),
  expiredAt:         timestamp("expired_at"),
  cancelledAt:       timestamp("cancelled_at"),

  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
});

export type MktFeaturedProductRequest = typeof mktFeaturedProductRequestsTable.$inferSelect;
export type MktFeaturedProductRequestInsert = typeof mktFeaturedProductRequestsTable.$inferInsert;
