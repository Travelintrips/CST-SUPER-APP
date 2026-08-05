import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktRfqsTable } from "./mktRfqs";
import { portalCompanyMembersTable } from "./portalCompanyMembers";

// ── SCHEMA — Phase 2F: Buyer Approval Flow ───────────────────────────────────
//
// Satu row per approval request per RFQ.
// Saat RFQ buyer_approval_level >= 2, satu record dibuat dengan status='pending'.
// Approver yang eligible (company member dengan role procurement/finance/admin)
// bisa approve atau reject RFQ tersebut.
//
// Approval eligibility:
//   - approver_member_id: member yang mengklaim dan mengerjakan approval (set saat respond)
//   - Sebelum diklaim: approver_member_id = NULL (terbuka untuk semua eligible approver)
//
// Status lifecycle:
//   pending → approved  (on approve: mkt_rfqs.status → 'submitted')
//   pending → rejected  (on reject:  mkt_rfqs.status stays 'draft', buyer revises)
//   pending → delegated (future — delegasi ke approver lain)
//
// MIGRATED via 0020_phase2f_approval_requote.sql

export const mktRfqApprovalsTable = pgTable("mkt_rfq_approvals", {
  id: serial("id").primaryKey(),

  // FK ke RFQ yang dimintakan approval-nya
  rfqId: integer("rfq_id")
    .notNull()
    .references(() => mktRfqsTable.id, { onDelete: "cascade" }),

  // Level approval (1 = L1, 2 = L2, dst.) — untuk multi-level future support
  approverLevel: integer("approver_level").notNull().default(1),

  // Member yang bertanggung jawab atas approval ini (set pada waktu request, bisa NULL = terbuka)
  // Untuk Phase 2F: NULL = any eligible approver in same company can respond
  approverMemberId: integer("approver_member_id").references(
    () => portalCompanyMembersTable.id,
    { onDelete: "set null" },
  ),

  // Approval status: pending | approved | rejected | delegated
  status: text("status").notNull().default("pending"),

  // Timestamps
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  respondedAt: timestamp("responded_at"),

  // Catatan dari approver saat merespons
  responseNotes: text("response_notes"),

  // Member yang benar-benar merespons (untuk audit — bisa berbeda dari approverMemberId)
  responderMemberId: integer("responder_member_id").references(
    () => portalCompanyMembersTable.id,
    { onDelete: "set null" },
  ),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("mkt_rfq_approvals_rfq_idx").on(t.rfqId),
  index("mkt_rfq_approvals_status_idx").on(t.status),
  index("mkt_rfq_approvals_approver_idx").on(t.approverMemberId),
]);

export const insertMktRfqApprovalSchema = createInsertSchema(mktRfqApprovalsTable).omit({
  id: true,
  createdAt: true,
  requestedAt: true,
});

export type InsertMktRfqApproval = z.infer<typeof insertMktRfqApprovalSchema>;
export type MktRfqApproval = typeof mktRfqApprovalsTable.$inferSelect;
