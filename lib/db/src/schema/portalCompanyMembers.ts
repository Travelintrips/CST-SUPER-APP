import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  numeric,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { portalCustomersTable } from "./portalCustomers";

// ── SCHEMA — Phase 2B.1: Buyer Organization Layer ────────────────────────────
//
// Jembatan antara portal_customers (auth / identity) dan companies (ERP entity).
//
// Relasi:
//   portal_customers  1 ──< portal_company_members >── 1  companies
//   (satu buyer bisa member di banyak company; satu company punya banyak buyer)
//
// buyer_role adalah procurement role (bukan auth role di portal_customers.role):
//   requester   — default, bisa buat RFQ, tidak bisa approve
//   procurement — bisa buat & track RFQ, set preferred vendor
//   finance     — bisa lihat semua RFQ company, approve budget
//   admin       — full access untuk company ini di portal
//   viewer      — read-only
//
// approval_level dan spending_limit disiapkan sebagai fondasi approval chain.
// Approval engine TIDAK diimplementasikan di phase ini.
//
// Kolom buyer context (buyer_role, department, cost_center, approval_level) di
// mkt_rfqs merupakan SNAPSHOT dari membership saat RFQ dibuat — immutable.
//
// MIGRATED via 0016_portal_company_members.sql

export const portalCompanyMembersTable = pgTable("portal_company_members", {
  id: serial("id").primaryKey(),

  // FK — both sides of the bridge
  portalCustomerId: integer("portal_customer_id")
    .notNull()
    .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),

  // Procurement identity — snapshotted into mkt_rfqs at RFQ creation
  buyerRole: text("buyer_role").notNull().default("requester"),
  // Valid values: requester | procurement | finance | admin | viewer
  // Stored as TEXT (not pgEnum) — extensible without DDL migration

  department: text("department"),   // mis. "Procurement", "Finance", "Operations"
  costCenter: text("cost_center"),  // mis. "CC-OPS-01", "PROJ-2024-TOLL"

  // Approval chain foundation (draft) — engine diimplementasikan di fase berikutnya
  approvalLevel: integer("approval_level"),
  // NULL  = no approval config yet
  // 1     = self-approve
  // 2     = needs L1 approval (mis. procurement manager)
  // 3     = needs L1 + L2 (mis. finance director)

  spendingLimit: numeric("spending_limit", { precision: 15, scale: 2 }),
  // NULL = unlimited / belum dikonfigurasi
  // Threshold yang nanti memicu requirement approval berdasarkan approval_level

  // Membership status
  isActive: boolean("is_active").notNull().default(true),

  // Invitation audit
  invitedBy: integer("invited_by").references(() => portalCustomersTable.id, {
    onDelete: "set null",
  }),
  invitedAt: timestamp("invited_at"),
  joinedAt: timestamp("joined_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // Satu portal customer hanya bisa menjadi member satu kali per company
  uniqueIndex("pcm_unique_member").on(t.portalCustomerId, t.companyId),
  index("pcm_company_idx").on(t.companyId),
  index("pcm_portal_customer_idx").on(t.portalCustomerId),
  // Partial index — hanya active members yang sering di-query
  index("pcm_active_company_idx").on(t.companyId, t.isActive),
]);

export const insertPortalCompanyMemberSchema = createInsertSchema(portalCompanyMembersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPortalCompanyMember = z.infer<typeof insertPortalCompanyMemberSchema>;
export type PortalCompanyMember = typeof portalCompanyMembersTable.$inferSelect;
