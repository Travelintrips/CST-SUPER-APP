import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Persistence contract for the runtime-created public reconciliation match
 * table.
 *
 * The table is intentionally modeled here because it is not represented by a
 * previous Drizzle schema module. `candidateSource` is nullable by design:
 * historical rows predate source-aware identity and must remain readable.
 */
export const bankReconciliationMatchesTable = pgTable("bank_reconciliation_matches", {
  id: serial("id").primaryKey(),
  mutationId: integer("mutation_id").notNull(),
  candidateType: text("candidate_type").notNull(),
  candidateId: integer("candidate_id").notNull(),
  candidateSource: text("candidate_source"),
  matchScore: integer("match_score").notNull().default(0),
  matchReason: text("match_reason"),
  amountMatch: boolean("amount_match").notNull().default(false),
  dateMatch: boolean("date_match").notNull().default(false),
  nameMatch: boolean("name_match").notNull().default(false),
  orderIdMatch: boolean("order_id_match").notNull().default(false),
  proofMatch: boolean("proof_match").notNull().default(false),
  status: text("status").notNull().default("candidate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  customerName: text("customer_name"),
  orderRef: text("order_ref"),
});

export const RECONCILIATION_CANDIDATE_SOURCES = {
  LEGACY_QRIS: "public.qris_settlements",
  CANONICAL_SPORT_CENTER: "sport_center.payment_settlement_batches",
} as const;

export type ReconciliationCandidateSource =
  (typeof RECONCILIATION_CANDIDATE_SOURCES)[keyof typeof RECONCILIATION_CANDIDATE_SOURCES];

export type ReconciliationCandidateIdentity = {
  candidateType: string;
  candidateId: number;
  candidateSource: ReconciliationCandidateSource | null;
};

/**
 * Stable persistence identity representation. A NULL source is retained as a
 * distinct historical state rather than being silently treated as legacy.
 */
export function reconciliationCandidateIdentityKey(
  identity: ReconciliationCandidateIdentity,
): string {
  return [
    identity.candidateType,
    identity.candidateId,
    identity.candidateSource ?? "<historical-null>",
  ].join(":");
}

export type BankReconciliationMatch =
  typeof bankReconciliationMatchesTable.$inferSelect;
export type InsertBankReconciliationMatch =
  typeof bankReconciliationMatchesTable.$inferInsert;