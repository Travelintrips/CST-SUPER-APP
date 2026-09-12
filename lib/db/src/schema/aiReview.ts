/**
 * AI Transaction Intelligence — Phase 10
 * Production Persistence Schema
 *
 * 6 tables for review case lifecycle, snapshots, decisions, audit, feedback, rule packages.
 * All tables enforce company isolation. All audit/snapshot tables are append-only.
 *
 * Naming convention: snake_case table + column names, matching existing schema files.
 */

import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const aiReviewStatusEnum = pgEnum("ai_review_status", [
  "OPEN",
  "QUEUED",
  "ASSIGNED",
  "IN_REVIEW",
  "NEEDS_INFORMATION",
  "APPROVED_RECOMMENDATION",
  "CHANGED_COA",
  "REJECTED_RECOMMENDATION",
  "ESCALATED",
  "CANCELLED",
  "CLOSED",
]);

export const aiReviewQueueEnum = pgEnum("ai_review_queue", [
  "AUTO_CLEAR_CANDIDATE",
  "STANDARD_FINANCE_REVIEW",
  "ACCOUNTING_REVIEW",
  "TREASURY_REVIEW",
  "TAX_REVIEW",
  "PAYROLL_REVIEW",
  "INTERCOMPANY_REVIEW",
  "ANOMALY_REVIEW",
  "HIGH_RISK_REVIEW",
  "DATA_QUALITY_REVIEW",
]);

export const aiReviewPriorityEnum = pgEnum("ai_review_priority", [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
  "CRITICAL",
]);

export const aiReviewDecisionEnum = pgEnum("ai_review_decision_type", [
  "APPROVE_RECOMMENDATION",
  "CHANGE_COA",
  "REJECT_RECOMMENDATION",
  "REQUEST_INFORMATION",
  "ESCALATE",
]);

export const aiLearningFeedbackStatusEnum = pgEnum("ai_learning_feedback_status", [
  "PENDING",
  "PROCESSED",
  "IGNORED",
]);

export const aiRulePackageStatusEnum = pgEnum("ai_rule_package_status", [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
]);

export const aiReviewAuditEventTypeEnum = pgEnum("ai_review_audit_event_type", [
  "CASE_CREATED",
  "QUEUED",
  "ASSIGNED",
  "REVIEW_STARTED",
  "INFORMATION_REQUESTED",
  "RECOMMENDATION_APPROVED",
  "COA_CHANGED",
  "RECOMMENDATION_REJECTED",
  "ESCALATED",
  "REEVALUATED",
  "CANCELLED",
  "CLOSED",
]);

// ─── Table 1: ai_review_cases ─────────────────────────────────────────────────

export const aiReviewCasesTable = pgTable(
  "ai_review_cases",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    transactionId: text("transaction_id"),
    source: text("source").notNull().default("bank_mutation"),
    sourceRecordId: text("source_record_id"),
    idempotencyKey: text("idempotency_key").notNull(),

    queue: aiReviewQueueEnum("queue").notNull(),
    priority: aiReviewPriorityEnum("priority").notNull().default("NORMAL"),
    status: aiReviewStatusEnum("status").notNull().default("OPEN"),

    intent: text("intent"),
    intentConfidence: numeric("intent_confidence", { precision: 6, scale: 4 }),

    recommendedCoaId: integer("recommended_coa_id"),
    recommendedCoaCode: text("recommended_coa_code"),
    recommendedCoaName: text("recommended_coa_name"),
    recommendedCoaConfidence: numeric("recommended_coa_confidence", { precision: 6, scale: 4 }),

    anomalyScore: numeric("anomaly_score", { precision: 6, scale: 4 }),
    anomalyRisk: text("anomaly_risk"),
    requiresManualReview: boolean("requires_manual_review").notNull().default(true),

    decisionPolicyVersion: text("decision_policy_version"),
    orchestrationVersion: text("orchestration_version"),
    snapshotVersion: text("snapshot_version"),

    flagsJson: jsonb("flags_json"),
    anomalyTypesJson: jsonb("anomaly_types_json"),

    assignedReviewerId: text("assigned_reviewer_id"),
    assignedReviewerRole: text("assigned_reviewer_role"),
    assignedAt: timestamp("assigned_at"),

    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    dueAt: timestamp("due_at"),
    closedAt: timestamp("closed_at"),
  },
  (t) => ({
    idempotencyUniq: uniqueIndex("ai_review_cases_idempotency_uniq").on(
      t.companyId,
      t.idempotencyKey,
    ),
    companyStatusIdx: index("ai_review_cases_company_status_idx").on(
      t.companyId,
      t.status,
    ),
    companyQueueIdx: index("ai_review_cases_company_queue_idx").on(
      t.companyId,
      t.queue,
    ),
    transactionIdx: index("ai_review_cases_transaction_idx").on(t.transactionId),
    createdAtIdx: index("ai_review_cases_created_at_idx").on(t.createdAt),
    dueAtIdx: index("ai_review_cases_due_at_idx").on(t.dueAt),
  }),
);

// ─── Table 2: ai_review_snapshots ─────────────────────────────────────────────

export const aiReviewSnapshotsTable = pgTable(
  "ai_review_snapshots",
  {
    id: serial("id").primaryKey(),
    reviewCaseId: integer("review_case_id").notNull(),
    companyId: integer("company_id").notNull(),

    transactionSnapshotJson: jsonb("transaction_snapshot_json").notNull(),
    phase1SnapshotJson: jsonb("phase1_snapshot_json"),
    phase2SnapshotJson: jsonb("phase2_snapshot_json"),
    phase3SnapshotJson: jsonb("phase3_snapshot_json"),
    phase4SnapshotJson: jsonb("phase4_snapshot_json"),
    phase7SnapshotJson: jsonb("phase7_snapshot_json"),
    phase8SnapshotJson: jsonb("phase8_snapshot_json"),
    phase9SnapshotJson: jsonb("phase9_snapshot_json"),

    snapshotChecksum: text("snapshot_checksum").notNull(),
    snapshotVersion: integer("snapshot_version").notNull().default(1),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    caseVersionUniq: uniqueIndex("ai_review_snapshots_case_version_uniq").on(
      t.reviewCaseId,
      t.snapshotVersion,
    ),
    caseIdIdx: index("ai_review_snapshots_case_id_idx").on(t.reviewCaseId),
    companyIdx: index("ai_review_snapshots_company_idx").on(t.companyId),
  }),
);

// ─── Table 3: ai_reviewer_decisions ──────────────────────────────────────────

export const aiReviewerDecisionsTable = pgTable(
  "ai_reviewer_decisions",
  {
    id: serial("id").primaryKey(),
    reviewCaseId: integer("review_case_id").notNull(),
    companyId: integer("company_id").notNull(),
    reviewerId: text("reviewer_id").notNull(),

    decision: aiReviewDecisionEnum("decision").notNull(),
    previousStatus: aiReviewStatusEnum("previous_status").notNull(),
    newStatus: aiReviewStatusEnum("new_status").notNull(),

    selectedCoaId: integer("selected_coa_id"),
    selectedCoaCode: text("selected_coa_code"),
    selectedCoaName: text("selected_coa_name"),

    reasonCode: text("reason_code"),
    comments: text("comments"),
    reviewerConfidence: numeric("reviewer_confidence", { precision: 4, scale: 2 }),

    idempotencyKey: text("idempotency_key").notNull(),
    decidedAt: timestamp("decided_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    idempotencyUniq: uniqueIndex("ai_reviewer_decisions_idempotency_uniq").on(
      t.companyId,
      t.idempotencyKey,
    ),
    caseIdIdx: index("ai_reviewer_decisions_case_id_idx").on(t.reviewCaseId),
    reviewerIdx: index("ai_reviewer_decisions_reviewer_idx").on(t.reviewerId),
  }),
);

// ─── Table 4: ai_review_audit_events ─────────────────────────────────────────

export const aiReviewAuditEventsTable = pgTable(
  "ai_review_audit_events",
  {
    id: serial("id").primaryKey(),
    reviewCaseId: integer("review_case_id").notNull(),
    companyId: integer("company_id").notNull(),

    eventType: aiReviewAuditEventTypeEnum("event_type").notNull(),
    actorType: text("actor_type").notNull().default("SYSTEM"),
    actorId: text("actor_id"),

    previousStatus: aiReviewStatusEnum("previous_status"),
    newStatus: aiReviewStatusEnum("new_status"),
    reason: text("reason"),
    metadataJson: jsonb("metadata_json"),

    occurredAt: timestamp("occurred_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    caseIdIdx: index("ai_review_audit_events_case_id_idx").on(t.reviewCaseId),
    companyOccurredIdx: index("ai_review_audit_events_company_occurred_idx").on(
      t.companyId,
      t.occurredAt,
    ),
  }),
);

// ─── Table 5: ai_learning_feedback ────────────────────────────────────────────

export const aiLearningFeedbackTable = pgTable(
  "ai_learning_feedback",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    reviewCaseId: integer("review_case_id"),
    reviewerDecisionId: integer("reviewer_decision_id"),

    transactionId: text("transaction_id"),
    intent: text("intent"),

    aiRecommendedCoaCode: text("ai_recommended_coa_code"),
    reviewerSelectedCoaCode: text("reviewer_selected_coa_code"),
    agreement: boolean("agreement"),

    reasonCode: text("reason_code"),
    feedbackPayloadJson: jsonb("feedback_payload_json"),

    status: aiLearningFeedbackStatusEnum("status").notNull().default("PENDING"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (t) => ({
    companyStatusIdx: index("ai_learning_feedback_company_status_idx").on(
      t.companyId,
      t.status,
    ),
    reviewCaseIdx: index("ai_learning_feedback_review_case_idx").on(t.reviewCaseId),
  }),
);

// ─── Table 6: ai_rule_recommendation_packages ────────────────────────────────

export const aiRuleRecommendationPackagesTable = pgTable(
  "ai_rule_recommendation_packages",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    packageType: text("package_type").notNull(),
    status: aiRulePackageStatusEnum("status").notNull().default("DRAFT"),

    recommendationPayloadJson: jsonb("recommendation_payload_json"),
    simulationPayloadJson: jsonb("simulation_payload_json"),
    impactPayloadJson: jsonb("impact_payload_json"),
    riskLevel: text("risk_level"),
    priority: integer("priority").notNull().default(0),
    requiresHumanApproval: boolean("requires_human_approval").notNull().default(true),

    createdBy: text("created_by"),
    reviewedBy: text("reviewed_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at"),
  },
  (t) => ({
    companyStatusIdx: index("ai_rule_packages_company_status_idx").on(
      t.companyId,
      t.status,
    ),
  }),
);

// ─── Inferred types ───────────────────────────────────────────────────────────

export type AiReviewCase = typeof aiReviewCasesTable.$inferSelect;
export type InsertAiReviewCase = typeof aiReviewCasesTable.$inferInsert;

export type AiReviewSnapshot = typeof aiReviewSnapshotsTable.$inferSelect;
export type InsertAiReviewSnapshot = typeof aiReviewSnapshotsTable.$inferInsert;

export type AiReviewerDecision = typeof aiReviewerDecisionsTable.$inferSelect;
export type InsertAiReviewerDecision = typeof aiReviewerDecisionsTable.$inferInsert;

export type AiReviewAuditEvent = typeof aiReviewAuditEventsTable.$inferSelect;
export type InsertAiReviewAuditEvent = typeof aiReviewAuditEventsTable.$inferInsert;

export type AiLearningFeedback = typeof aiLearningFeedbackTable.$inferSelect;
export type InsertAiLearningFeedback = typeof aiLearningFeedbackTable.$inferInsert;

export type AiRuleRecommendationPackage = typeof aiRuleRecommendationPackagesTable.$inferSelect;
export type InsertAiRuleRecommendationPackage = typeof aiRuleRecommendationPackagesTable.$inferInsert;
