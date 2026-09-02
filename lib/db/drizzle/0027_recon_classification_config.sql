-- Bank Reconciliation Classification Configuration
-- Feature: Configurable Transaction Classification Master Data
--
-- Scope: Additive only. No DROP, no RENAME, no data destruction.
-- Idempotent: all IF NOT EXISTS.
--
-- Tables created:
--   1. recon_classification_configs   — main config (business txn / routine expense / income)
--   2. recon_ai_classification_rules  — AI classification rules (user-managed)
--   3. recon_keyword_dictionary       — keyword dictionary (per config or global)
--   4. recon_approval_rules_config    — approval rules per config category

-- ── Table 1: recon_classification_configs ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "recon_classification_configs" (
  "id"                    SERIAL PRIMARY KEY,
  "company_id"            INTEGER,
  "category"              TEXT NOT NULL,
  "name"                  TEXT NOT NULL,
  "code"                  TEXT NOT NULL,
  "type"                  TEXT,
  "flow"                  TEXT NOT NULL DEFAULT 'MANUAL_REVIEW',
  "default_coa_code"      TEXT,
  "default_vendor_id"     INTEGER,
  "default_department"    TEXT,
  "default_cost_center"   TEXT,
  "need_upload"           TEXT NOT NULL DEFAULT 'none',
  "upload_file_types"     JSONB NOT NULL DEFAULT '[]',
  "upload_max_files"      INTEGER DEFAULT 5,
  "upload_max_size_mb"    INTEGER DEFAULT 10,
  "need_approval"         BOOLEAN NOT NULL DEFAULT FALSE,
  "need_invoice_number"   BOOLEAN NOT NULL DEFAULT FALSE,
  "need_reference_number" BOOLEAN NOT NULL DEFAULT FALSE,
  "ai_learning_enabled"   BOOLEAN NOT NULL DEFAULT TRUE,
  "confidence_threshold"  NUMERIC(4,2) DEFAULT 0.75,
  "keywords"              JSONB NOT NULL DEFAULT '[]',
  "regex_pattern"         TEXT,
  "priority"              INTEGER NOT NULL DEFAULT 50,
  "is_active"             BOOLEAN NOT NULL DEFAULT TRUE,
  "is_seed"               BOOLEAN NOT NULL DEFAULT FALSE,
  "usage_count"           INTEGER NOT NULL DEFAULT 0,
  "created_by"            TEXT,
  "updated_by"            TEXT,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "rcc_company_category_idx"
  ON "recon_classification_configs" ("company_id", "category");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "rcc_category_active_idx"
  ON "recon_classification_configs" ("category", "is_active", "priority");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "rcc_code_company_uniq"
  ON "recon_classification_configs" ("code", COALESCE("company_id", 0));
--> statement-breakpoint

-- ── Table 2: recon_ai_classification_rules ────────────────────────────────────

CREATE TABLE IF NOT EXISTS "recon_ai_classification_rules" (
  "id"                  SERIAL PRIMARY KEY,
  "company_id"          INTEGER,
  "config_id"           INTEGER REFERENCES "recon_classification_configs"("id") ON DELETE SET NULL,
  "name"                TEXT NOT NULL,
  "description"         TEXT,
  "condition_field"     TEXT NOT NULL,
  "condition_operator"  TEXT NOT NULL,
  "condition_value"     TEXT NOT NULL,
  "action_flow"         TEXT,
  "action_coa_code"     TEXT,
  "action_config_code"  TEXT,
  "requires_document_upload" BOOLEAN NOT NULL DEFAULT FALSE,
  "tax_type"            TEXT NOT NULL DEFAULT 'none',
  "confidence"          NUMERIC(4,2) DEFAULT 0.80,
  "priority"            INTEGER NOT NULL DEFAULT 50,
  "is_active"           BOOLEAN NOT NULL DEFAULT TRUE,
  "source"              TEXT NOT NULL DEFAULT 'manual',
  "created_by"          TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "racr_company_active_idx"
  ON "recon_ai_classification_rules" ("company_id", "is_active", "priority");
--> statement-breakpoint

-- ── Table 3: recon_keyword_dictionary ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "recon_keyword_dictionary" (
  "id"          SERIAL PRIMARY KEY,
  "company_id"  INTEGER,
  "config_id"   INTEGER REFERENCES "recon_classification_configs"("id") ON DELETE SET NULL,
  "term"        TEXT NOT NULL,
  "weight"      NUMERIC(4,2) NOT NULL DEFAULT 0.80,
  "is_active"   BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by"  TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "rkd_company_active_idx"
  ON "recon_keyword_dictionary" ("company_id", "is_active");
--> statement-breakpoint

-- ── Table 4: recon_approval_rules_config ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "recon_approval_rules_config" (
  "id"                      SERIAL PRIMARY KEY,
  "company_id"              INTEGER,
  "config_id"               INTEGER REFERENCES "recon_classification_configs"("id") ON DELETE SET NULL,
  "name"                    TEXT NOT NULL,
  "min_amount"              NUMERIC(15,2),
  "max_amount"              NUMERIC(15,2),
  "required_approver_role"  TEXT,
  "approval_level"          INTEGER NOT NULL DEFAULT 1,
  "is_active"               BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by"              TEXT,
  "created_at"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "rarc_company_active_idx"
  ON "recon_approval_rules_config" ("company_id", "is_active");
