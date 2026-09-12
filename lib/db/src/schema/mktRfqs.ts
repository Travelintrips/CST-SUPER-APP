import { pgTable, serial, text, integer, boolean, numeric, date, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { suppliersTable } from "./suppliers";
import { portalCustomersTable } from "./portalCustomers";
// portalCompanyMembersTable intentionally NOT imported here — mktRfqs only stores
// the snapshot values (buyer_role etc), not a FK back to portal_company_members.

// ── SCHEMA — Enterprise Marketplace Blueprint v1.1.1, Section 6.1 ────────────
// MIGRATED — Phase 1C (2026-07-02). Table exists in Supabase production.

export const mktRfqStatusEnum = pgEnum("mkt_rfq_status", [
  "draft",
  "submitted",
  "quoting",
  "quoted",
  "awarded",
  "cancelled",
  "expired",
]);

export const mktRfqPriorityEnum = pgEnum("mkt_rfq_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const mktRfqsTable = pgTable("mkt_rfqs", {
  id: serial("id").primaryKey(),
  rfqNumber: text("rfq_number").notNull().unique(), // format: MKT-RFQ-YYYYMM-XXXX

  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }), // NULL = guest / no mapping yet
  catalogVendorId: integer("catalog_vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }), // KEPUTUSAN #3

  // Phase 2B — Buyer Identity: link ke portal_customers.id jika logged-in, NULL jika guest
  portalCustomerId: integer("portal_customer_id").references(() => portalCustomersTable.id, { onDelete: "set null" }),

  buyerName: text("buyer_name").notNull(),
  buyerEmail: text("buyer_email").notNull(),
  buyerPhone: text("buyer_phone"),
  buyerCompany: text("buyer_company"),

  // Phase 2B.1 — Buyer Organization: snapshot dari portal_company_members saat RFQ dibuat.
  // Immutable — mencerminkan context buyer pada waktu pembuatan RFQ, bukan state saat ini.
  // NULL jika guest atau logged-in tapi belum ada mapping ke company.
  buyerRole: text("buyer_role"),             // snapshot: requester | procurement | finance | admin | viewer
  buyerDepartment: text("buyer_department"), // snapshot: mis. "Procurement", "Finance"
  buyerCostCenter: text("buyer_cost_center"),// snapshot: mis. "CC-OPS-01"
  buyerApprovalLevel: integer("buyer_approval_level"), // snapshot: 1=self, 2=needs L1, dst.

  guestToken: text("guest_token").unique(), // KEPUTUSAN #9 — kept for backward compat
  // Phase 1B token security: hash stored for lookup; raw only sent to client
  guestTokenHash: text("guest_token_hash"),
  guestTokenExpiresAt: timestamp("guest_token_expires_at"),
  guestClaimedAt: timestamp("guest_claimed_at"),
  guestClaimedBy: text("guest_claimed_by"),

  status: mktRfqStatusEnum("status").notNull().default("draft"),
  priority: mktRfqPriorityEnum("priority").default("normal"),

  requiredDeliveryDate: date("required_delivery_date"),
  deliveryAddress: text("delivery_address"),
  // Optional Google Places metadata. NULL means the buyer used the manual fallback.
  destinationPlaceId: text("destination_place_id"),
  destinationLat: numeric("destination_lat", { precision: 10, scale: 7 }),
  destinationLng: numeric("destination_lng", { precision: 10, scale: 7 }),
  notes: text("notes"),

  emailVerified: boolean("email_verified").notNull().default(false), // KEPUTUSAN #11
  emailVerifiedAt: timestamp("email_verified_at"),

  // Counter denormalized [F08 resolved] — update via service layer
  lineCount: integer("line_count").notNull().default(0),
  quoteCount: integer("quote_count").notNull().default(0),

  // ── Phase 2E — Vendor Selection result (set atomically by selectVendorAndCreatePo) ──
  winnerSelectedAt: timestamp("winner_selected_at"),
  winnerSelectedBy: text("winner_selected_by"),       // adminId string (no FK — internal)
  winningQuoteId: integer("winning_quote_id"),         // FK to mkt_vendor_quotes.id (enforced in DB only, not Drizzle to avoid circular import)

  // ── Phase 2F — Buyer Approval Flow ───────────────────────────────────────────
  // Kolom approval berjalan PARALEL dengan status utama (bukan bagian dari status lifecycle).
  // approval_status: none | pending | approved | rejected
  //   'none'     = tidak butuh approval (approval_level <= 1 atau NULL)
  //   'pending'  = menunggu approval dari approver yang eligible
  //   'approved' = disetujui → mkt_rfqs.status = 'submitted'
  //   'rejected' = ditolak → buyer revisi, status tetap 'draft'
  // Detail approval tersimpan di mkt_rfq_approvals table.
  approvalStatus:      text("approval_status").notNull().default("none"),
  approvalRequestedAt: timestamp("approval_requested_at"),
  approvalResolvedAt:  timestamp("approval_resolved_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("mkt_rfqs_company_idx").on(t.companyId),
  index("mkt_rfqs_catalog_vendor_idx").on(t.catalogVendorId),
  index("mkt_rfqs_status_idx").on(t.status),
  index("mkt_rfqs_guest_token_idx").on(t.guestToken),
  index("mkt_rfqs_guest_token_hash_idx").on(t.guestTokenHash),
  index("mkt_rfqs_portal_customer_idx").on(t.portalCustomerId),
  // Phase 2B.1 — company_id + status: untuk filter RFQ per perusahaan di admin dashboard
  index("mkt_rfqs_company_status_idx").on(t.companyId, t.status),
]);

export const insertMktRfqSchema = createInsertSchema(mktRfqsTable).omit({
  id: true,
  rfqNumber: true,
  lineCount: true,
  quoteCount: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMktRfq = z.infer<typeof insertMktRfqSchema>;
export type MktRfq = typeof mktRfqsTable.$inferSelect;
