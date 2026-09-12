import { pgTable, serial, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mktRfqsTable } from "./mktRfqs";

// ── SCHEMA — Enterprise Marketplace Blueprint v1.1.1, Section 6.6 ────────────
// MIGRATED — Phase 1C (2026-07-02). Table exists in Supabase production.
// KEPUTUSAN #9 — guest claim mechanism.

export const mktClaimStatusEnum = pgEnum("mkt_claim_status", [
  "pending",
  "claimed",
  "expired",
]);

export const mktRfqGuestClaimsTable = pgTable("mkt_rfq_guest_claims", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id")
    .notNull()
    .references(() => mktRfqsTable.id, { onDelete: "cascade" }),

  guestEmail: text("guest_email").notNull(),
  guestToken: text("guest_token").notNull(), // token dari mkt_rfqs.guest_token

  claimedByUserId: text("claimed_by_user_id"), // user_id setelah login/register
  claimStatus: mktClaimStatusEnum("claim_status").notNull().default("pending"),
  claimedAt: timestamp("claimed_at"),
  expiresAt: timestamp("expires_at").notNull(), // token claim expired dalam 7 hari

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("mkt_rfq_guest_claims_rfq_idx").on(t.rfqId),
  index("mkt_rfq_guest_claims_guest_token_idx").on(t.guestToken),
  index("mkt_rfq_guest_claims_status_idx").on(t.claimStatus),
]);

export const insertMktRfqGuestClaimSchema = createInsertSchema(mktRfqGuestClaimsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMktRfqGuestClaim = z.infer<typeof insertMktRfqGuestClaimSchema>;
export type MktRfqGuestClaim = typeof mktRfqGuestClaimsTable.$inferSelect;
