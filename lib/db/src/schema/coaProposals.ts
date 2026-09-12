/**
 * COA Proposal Tables — Task #7: AI COA Proposal Engine
 *
 * Three additive tables:
 *   coa_proposals          — main proposal record (maker-checker lifecycle)
 *   coa_proposal_versions  — append-only snapshot history (every edit = new version)
 *   coa_proposal_audit     — append-only event log (no DELETE endpoint)
 *
 * Rules:
 *   - No DROP, no destructive ALTER on existing tables
 *   - company_id enforced on every table
 *   - idempotency_key unique per company
 *   - proposal_number unique per company
 *   - version unique per proposal_id
 *   - audit rows are never deleted via API
 */

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { chartOfAccountsTable } from "./accounting";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const coaProposalStatusEnum = pgEnum("coa_proposal_status", [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "IMPLEMENTED",
  "CANCELLED",
]);

export const coaFinancialStatementEnum = pgEnum("coa_financial_statement", [
  "BALANCE_SHEET",
  "PROFIT_AND_LOSS",
  "CASH_FLOW_SUPPORT",
  "OFF_STATEMENT",
]);

export const coaProposalSourceTypeEnum = pgEnum("coa_proposal_source_type", [
  "BANK_RECONCILIATION",
  "EXPENSE",
  "TREASURY",
  "VENDOR_PAYMENT",
  "CUSTOMER_PAYMENT",
  "MANUAL",
]);

export const coaProposalEventTypeEnum = pgEnum("coa_proposal_event_type", [
  "PROPOSAL_CREATED",
  "PROPOSAL_UPDATED",
  "PROPOSAL_SUBMITTED",
  "PROPOSAL_APPROVED",
  "PROPOSAL_REJECTED",
  "PROPOSAL_CANCELLED",
  "COA_IMPLEMENTED",
  "RULE_RECOMMENDATION_CREATED",
  "LEARNING_FEEDBACK_CREATED",
]);

// ── coa_proposals ─────────────────────────────────────────────────────────────

export const coaProposalsTable = pgTable("coa_proposals", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  proposalNumber: text("proposal_number").notNull(),

  // Source traceability
  sourceType: coaProposalSourceTypeEnum("source_type").notNull().default("MANUAL"),
  sourceRecordId: text("source_record_id"),
  reviewCaseId: integer("review_case_id"),
  transactionId: integer("transaction_id"),

  // Lifecycle status
  status: coaProposalStatusEnum("status").notNull().default("DRAFT"),

  // Proposed account fields
  proposedCode: text("proposed_code").notNull(),
  proposedName: text("proposed_name").notNull(),
  proposedParentId: integer("proposed_parent_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  proposedCategory: text("proposed_category").notNull(),
  proposedNormalBalance: text("proposed_normal_balance").notNull(),
  proposedIsHeader: boolean("proposed_is_header").notNull().default(false),
  proposedIsPostable: boolean("proposed_is_postable").notNull().default(true),
  proposedEffectiveFrom: timestamp("proposed_effective_from"),
  financialStatement: coaFinancialStatementEnum("financial_statement").notNull(),

  // AI context
  detectedIntent: text("detected_intent"),
  normalizedDescription: text("normalized_description"),
  missingMappingType: text("missing_mapping_type"),

  // AI metrics
  aiConfidence: integer("ai_confidence"),           // 0–100
  historicalOccurrences: integer("historical_occurrences").default(0),
  estimatedMonthlyUsage: integer("estimated_monthly_usage").default(0),

  // Rich JSON payloads (never contains SQL/stack/secrets)
  reasonJson: jsonb("reason_json"),
  evidenceJson: jsonb("evidence_json"),
  impactAnalysisJson: jsonb("impact_analysis_json"),
  alternativeAccountsJson: jsonb("alternative_accounts_json"),

  // Workflow actors
  createdBy: text("created_by").notNull(),
  submittedBy: text("submitted_by"),
  reviewedBy: text("reviewed_by"),
  approvedBy: text("approved_by"),
  implementedBy: text("implemented_by"),

  // Timestamps
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  approvedAt: timestamp("approved_at"),
  implementedAt: timestamp("implemented_at"),
  rejectedAt: timestamp("rejected_at"),
  cancelledAt: timestamp("cancelled_at"),

  // Review outcome
  rejectionReason: text("rejection_reason"),
  reviewComments: text("review_comments"),

  // Idempotency & fingerprinting
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint"),

  // Reference to implemented COA (set after IMPLEMENTED)
  implementedCoaId: integer("implemented_coa_id"),

  // Optimistic locking
  version: integer("version").notNull().default(1),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyIdempotencyUniq: uniqueIndex("coa_proposals_company_idempotency_uniq")
    .on(t.companyId, t.idempotencyKey),
  companyProposalNumberUniq: uniqueIndex("coa_proposals_company_number_uniq")
    .on(t.companyId, t.proposalNumber),
  companyStatusIdx: index("coa_proposals_company_status_idx").on(t.companyId, t.status),
  companyIntentIdx: index("coa_proposals_company_intent_idx").on(t.companyId, t.detectedIntent),
  companyCreatedIdx: index("coa_proposals_company_created_idx").on(t.companyId, t.createdAt),
  sourceIdx: index("coa_proposals_source_idx").on(t.sourceType, t.sourceRecordId),
}));

// ── coa_proposal_versions ─────────────────────────────────────────────────────

export const coaProposalVersionsTable = pgTable("coa_proposal_versions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  proposalId: integer("proposal_id").notNull(),
  version: integer("version").notNull(),
  snapshotJson: jsonb("snapshot_json").notNull(),
  changeReason: text("change_reason"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  proposalVersionUniq: uniqueIndex("coa_proposal_versions_proposal_version_uniq")
    .on(t.proposalId, t.version),
  proposalIdx: index("coa_proposal_versions_proposal_idx").on(t.proposalId),
  companyIdx: index("coa_proposal_versions_company_idx").on(t.companyId),
}));

// ── coa_proposal_audit ────────────────────────────────────────────────────────

export const coaProposalAuditTable = pgTable("coa_proposal_audit", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  proposalId: integer("proposal_id").notNull(),
  eventType: coaProposalEventTypeEnum("event_type").notNull(),
  actorId: text("actor_id").notNull(),
  actorType: text("actor_type").notNull().default("user"),  // user | system
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  reason: text("reason"),
  metadataJson: jsonb("metadata_json"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  proposalIdx: index("coa_proposal_audit_proposal_idx").on(t.proposalId),
  companyIdx: index("coa_proposal_audit_company_idx").on(t.companyId),
  eventTypeIdx: index("coa_proposal_audit_event_idx").on(t.eventType),
  occurredIdx: index("coa_proposal_audit_occurred_idx").on(t.companyId, t.occurredAt),
}));

// ── Exported types ────────────────────────────────────────────────────────────

export type CoaProposal = typeof coaProposalsTable.$inferSelect;
export type InsertCoaProposal = typeof coaProposalsTable.$inferInsert;
export type CoaProposalVersion = typeof coaProposalVersionsTable.$inferSelect;
export type InsertCoaProposalVersion = typeof coaProposalVersionsTable.$inferInsert;
export type CoaProposalAudit = typeof coaProposalAuditTable.$inferSelect;
export type InsertCoaProposalAudit = typeof coaProposalAuditTable.$inferInsert;
