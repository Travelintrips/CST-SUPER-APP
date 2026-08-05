-- AI Transaction Intelligence — Phase 10
-- Production Persistence Schema
--
-- Scope: Additive only. No DROP, no RENAME, no data destruction.
-- All statements use IF NOT EXISTS / DO blocks for full idempotency.
-- Safe to run multiple times.
--
-- Rollback notes (manual):
--   DROP TABLE IF EXISTS ai_rule_recommendation_packages;
--   DROP TABLE IF EXISTS ai_learning_feedback;
--   DROP TABLE IF EXISTS ai_review_audit_events;
--   DROP TABLE IF EXISTS ai_reviewer_decisions;
--   DROP TABLE IF EXISTS ai_review_snapshots;
--   DROP TABLE IF EXISTS ai_review_cases;
--   DROP TYPE IF EXISTS ai_review_audit_event_type;
--   DROP TYPE IF EXISTS ai_rule_package_status;
--   DROP TYPE IF EXISTS ai_learning_feedback_status;
--   DROP TYPE IF EXISTS ai_review_decision_type;
--   DROP TYPE IF EXISTS ai_review_priority;
--   DROP TYPE IF EXISTS ai_review_queue;
--   DROP TYPE IF EXISTS ai_review_status;

-- ── Enum: ai_review_status ────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ai_review_status AS ENUM (
    'OPEN', 'QUEUED', 'ASSIGNED', 'IN_REVIEW', 'NEEDS_INFORMATION',
    'APPROVED_RECOMMENDATION', 'CHANGED_COA', 'REJECTED_RECOMMENDATION',
    'ESCALATED', 'CANCELLED', 'CLOSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ── Enum: ai_review_queue ─────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ai_review_queue AS ENUM (
    'AUTO_CLEAR_CANDIDATE', 'STANDARD_FINANCE_REVIEW', 'ACCOUNTING_REVIEW',
    'TREASURY_REVIEW', 'TAX_REVIEW', 'PAYROLL_REVIEW', 'INTERCOMPANY_REVIEW',
    'ANOMALY_REVIEW', 'HIGH_RISK_REVIEW', 'DATA_QUALITY_REVIEW'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ── Enum: ai_review_priority ──────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ai_review_priority AS ENUM (
    'LOW', 'NORMAL', 'HIGH', 'URGENT', 'CRITICAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ── Enum: ai_review_decision_type ────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ai_review_decision_type AS ENUM (
    'APPROVE_RECOMMENDATION', 'CHANGE_COA', 'REJECT_RECOMMENDATION',
    'REQUEST_INFORMATION', 'ESCALATE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ── Enum: ai_learning_feedback_status ────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ai_learning_feedback_status AS ENUM (
    'PENDING', 'PROCESSED', 'IGNORED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ── Enum: ai_rule_package_status ─────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ai_rule_package_status AS ENUM (
    'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ── Enum: ai_review_audit_event_type ─────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ai_review_audit_event_type AS ENUM (
    'CASE_CREATED', 'QUEUED', 'ASSIGNED', 'REVIEW_STARTED',
    'INFORMATION_REQUESTED', 'RECOMMENDATION_APPROVED', 'COA_CHANGED',
    'RECOMMENDATION_REJECTED', 'ESCALATED', 'REEVALUATED', 'CANCELLED', 'CLOSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ── Table 1: ai_review_cases ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ai_review_cases" (
  "id"                        SERIAL PRIMARY KEY,
  "company_id"                INTEGER NOT NULL,
  "transaction_id"            TEXT,
  "source"                    TEXT NOT NULL DEFAULT 'bank_mutation',
  "source_record_id"          TEXT,
  "idempotency_key"           TEXT NOT NULL,

  "queue"                     ai_review_queue NOT NULL,
  "priority"                  ai_review_priority NOT NULL DEFAULT 'NORMAL',
  "status"                    ai_review_status NOT NULL DEFAULT 'OPEN',

  "intent"                    TEXT,
  "intent_confidence"         NUMERIC(6,4),

  "recommended_coa_id"        INTEGER,
  "recommended_coa_code"      TEXT,
  "recommended_coa_name"      TEXT,
  "recommended_coa_confidence" NUMERIC(6,4),

  "anomaly_score"             NUMERIC(6,4),
  "anomaly_risk"              TEXT,
  "requires_manual_review"    BOOLEAN NOT NULL DEFAULT TRUE,

  "decision_policy_version"   TEXT,
  "orchestration_version"     TEXT,
  "snapshot_version"          TEXT,

  "flags_json"                JSONB,
  "anomaly_types_json"        JSONB,

  "assigned_reviewer_id"      TEXT,
  "assigned_reviewer_role"    TEXT,
  "assigned_at"               TIMESTAMPTZ,

  "created_by"                TEXT,
  "created_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "due_at"                    TIMESTAMPTZ,
  "closed_at"                 TIMESTAMPTZ
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ai_review_cases_idempotency_uniq"
  ON "ai_review_cases" ("company_id", "idempotency_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_review_cases_company_status_idx"
  ON "ai_review_cases" ("company_id", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_review_cases_company_queue_idx"
  ON "ai_review_cases" ("company_id", "queue");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_review_cases_transaction_idx"
  ON "ai_review_cases" ("transaction_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_review_cases_created_at_idx"
  ON "ai_review_cases" ("created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_review_cases_due_at_idx"
  ON "ai_review_cases" ("due_at");
--> statement-breakpoint

-- ── Table 2: ai_review_snapshots ──────────────────────────────────────────────
-- Immutable after insert. No UPDATE API.

CREATE TABLE IF NOT EXISTS "ai_review_snapshots" (
  "id"                           SERIAL PRIMARY KEY,
  "review_case_id"               INTEGER NOT NULL,
  "company_id"                   INTEGER NOT NULL,

  "transaction_snapshot_json"    JSONB NOT NULL,
  "phase1_snapshot_json"         JSONB,
  "phase2_snapshot_json"         JSONB,
  "phase3_snapshot_json"         JSONB,
  "phase4_snapshot_json"         JSONB,
  "phase7_snapshot_json"         JSONB,
  "phase8_snapshot_json"         JSONB,
  "phase9_snapshot_json"         JSONB,

  "snapshot_checksum"            TEXT NOT NULL,
  "snapshot_version"             INTEGER NOT NULL DEFAULT 1,

  "created_at"                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ai_review_snapshots_case_version_uniq"
  ON "ai_review_snapshots" ("review_case_id", "snapshot_version");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_review_snapshots_case_id_idx"
  ON "ai_review_snapshots" ("review_case_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_review_snapshots_company_idx"
  ON "ai_review_snapshots" ("company_id");
--> statement-breakpoint

-- ── Table 3: ai_reviewer_decisions ────────────────────────────────────────────
-- Append-only. No destructive update.

CREATE TABLE IF NOT EXISTS "ai_reviewer_decisions" (
  "id"                  SERIAL PRIMARY KEY,
  "review_case_id"      INTEGER NOT NULL,
  "company_id"          INTEGER NOT NULL,
  "reviewer_id"         TEXT NOT NULL,

  "decision"            ai_review_decision_type NOT NULL,
  "previous_status"     ai_review_status NOT NULL,
  "new_status"          ai_review_status NOT NULL,

  "selected_coa_id"     INTEGER,
  "selected_coa_code"   TEXT,
  "selected_coa_name"   TEXT,

  "reason_code"         TEXT,
  "comments"            TEXT,
  "reviewer_confidence" NUMERIC(4,2),

  "idempotency_key"     TEXT NOT NULL,
  "decided_at"          TIMESTAMPTZ NOT NULL,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ai_reviewer_decisions_idempotency_uniq"
  ON "ai_reviewer_decisions" ("company_id", "idempotency_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_reviewer_decisions_case_id_idx"
  ON "ai_reviewer_decisions" ("review_case_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_reviewer_decisions_reviewer_idx"
  ON "ai_reviewer_decisions" ("reviewer_id");
--> statement-breakpoint

-- ── Table 4: ai_review_audit_events ──────────────────────────────────────────
-- Append-only. No DELETE via API.

CREATE TABLE IF NOT EXISTS "ai_review_audit_events" (
  "id"               SERIAL PRIMARY KEY,
  "review_case_id"   INTEGER NOT NULL,
  "company_id"       INTEGER NOT NULL,

  "event_type"       ai_review_audit_event_type NOT NULL,
  "actor_type"       TEXT NOT NULL DEFAULT 'SYSTEM',
  "actor_id"         TEXT,

  "previous_status"  ai_review_status,
  "new_status"       ai_review_status,
  "reason"           TEXT,
  "metadata_json"    JSONB,

  "occurred_at"      TIMESTAMPTZ NOT NULL,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_review_audit_events_case_id_idx"
  ON "ai_review_audit_events" ("review_case_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_review_audit_events_company_occurred_idx"
  ON "ai_review_audit_events" ("company_id", "occurred_at");
--> statement-breakpoint

-- ── Table 5: ai_learning_feedback ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ai_learning_feedback" (
  "id"                        SERIAL PRIMARY KEY,
  "company_id"                INTEGER NOT NULL,
  "review_case_id"            INTEGER,
  "reviewer_decision_id"      INTEGER,

  "transaction_id"            TEXT,
  "intent"                    TEXT,

  "ai_recommended_coa_code"   TEXT,
  "reviewer_selected_coa_code" TEXT,
  "agreement"                 BOOLEAN,

  "reason_code"               TEXT,
  "feedback_payload_json"     JSONB,

  "status"                    ai_learning_feedback_status NOT NULL DEFAULT 'PENDING',

  "created_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processed_at"              TIMESTAMPTZ
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_learning_feedback_company_status_idx"
  ON "ai_learning_feedback" ("company_id", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_learning_feedback_review_case_idx"
  ON "ai_learning_feedback" ("review_case_id");
--> statement-breakpoint

-- ── Table 6: ai_rule_recommendation_packages ─────────────────────────────────

CREATE TABLE IF NOT EXISTS "ai_rule_recommendation_packages" (
  "id"                           SERIAL PRIMARY KEY,
  "company_id"                   INTEGER NOT NULL,
  "package_type"                 TEXT NOT NULL,
  "status"                       ai_rule_package_status NOT NULL DEFAULT 'DRAFT',

  "recommendation_payload_json"  JSONB,
  "simulation_payload_json"      JSONB,
  "impact_payload_json"          JSONB,
  "risk_level"                   TEXT,
  "priority"                     INTEGER NOT NULL DEFAULT 0,
  "requires_human_approval"      BOOLEAN NOT NULL DEFAULT TRUE,

  "created_by"                   TEXT,
  "reviewed_by"                  TEXT,
  "created_at"                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "reviewed_at"                  TIMESTAMPTZ
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_rule_packages_company_status_idx"
  ON "ai_rule_recommendation_packages" ("company_id", "status");
