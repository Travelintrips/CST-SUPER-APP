-- Settlement Pattern Engine
-- Feature: Configurable Settlement Pattern Matching for Bank Reconciliation
--
-- Scope: Additive only. No DROP, no RENAME, no data destruction.
-- Idempotent: all IF NOT EXISTS.
-- DO NOT modify: Accounting Engine, Universal Journal Reuse Engine, COA Governance,
--               AI Governance, Posting Journal, General Ledger.
--
-- Tables created:
--   1. recon_settlement_patterns         — master settlement pattern config
--   2. recon_settlement_pattern_keywords — keyword rules per pattern
--   3. recon_settlement_pattern_examples — AI learning examples

-- ── Table 1: recon_settlement_patterns ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "recon_settlement_patterns" (
  "id"                    SERIAL PRIMARY KEY,
  "company_id"            INTEGER,
  "code"                  TEXT NOT NULL,
  "name"                  TEXT NOT NULL,
  "provider"              TEXT NOT NULL,
  "pattern_type"          TEXT NOT NULL DEFAULT 'settlement',
  "match_strategy"        TEXT NOT NULL DEFAULT 'BATCH_SETTLEMENT',
  "priority"              INTEGER NOT NULL DEFAULT 50,
  "status"                TEXT NOT NULL DEFAULT 'active',
  "merchant_name"         TEXT,
  "merchant_id"           TEXT,
  "terminal_id"           TEXT,
  "bank_name"             TEXT,
  "account_number"        TEXT,
  "currency"              TEXT NOT NULL DEFAULT 'IDR',
  "settlement_delay_days" INTEGER NOT NULL DEFAULT 1,
  "gross_matching"        BOOLEAN NOT NULL DEFAULT TRUE,
  "fee_matching"          BOOLEAN NOT NULL DEFAULT FALSE,
  "fee_account_id"        INTEGER,
  "confidence_threshold"  NUMERIC(4,2) NOT NULL DEFAULT 0.80,
  "is_seed"               BOOLEAN NOT NULL DEFAULT FALSE,
  "usage_count"           INTEGER NOT NULL DEFAULT 0,
  "created_by"            TEXT,
  "updated_by"            TEXT,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "rsp_company_code_idx"
  ON "recon_settlement_patterns" ("company_id", "code")
  WHERE "company_id" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "rsp_global_code_idx"
  ON "recon_settlement_patterns" ("code")
  WHERE "company_id" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "rsp_provider_status_idx"
  ON "recon_settlement_patterns" ("provider", "status");
--> statement-breakpoint

-- ── Table 2: recon_settlement_pattern_keywords ────────────────────────────────

CREATE TABLE IF NOT EXISTS "recon_settlement_pattern_keywords" (
  "id"         SERIAL PRIMARY KEY,
  "pattern_id" INTEGER NOT NULL REFERENCES "recon_settlement_patterns"("id") ON DELETE CASCADE,
  "keyword"    TEXT NOT NULL,
  "match_mode" TEXT NOT NULL DEFAULT 'contains',
  "priority"   INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

-- match_mode values: contains | starts_with | ends_with | equals | regex

CREATE INDEX IF NOT EXISTS "rspk_pattern_idx"
  ON "recon_settlement_pattern_keywords" ("pattern_id");
--> statement-breakpoint

-- ── Table 3: recon_settlement_pattern_examples ────────────────────────────────

CREATE TABLE IF NOT EXISTS "recon_settlement_pattern_examples" (
  "id"               SERIAL PRIMARY KEY,
  "pattern_id"       INTEGER NOT NULL REFERENCES "recon_settlement_patterns"("id") ON DELETE CASCADE,
  "raw_description"  TEXT NOT NULL,
  "matched_provider" TEXT,
  "matched_merchant" TEXT,
  "gross_amount"     NUMERIC(18,2),
  "fee_amount"       NUMERIC(18,2),
  "net_amount"       NUMERIC(18,2),
  "match_confidence" NUMERIC(4,2),
  "source"           TEXT NOT NULL DEFAULT 'user_confirmed',
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

-- source values: user_confirmed | ai_learned | simulator

CREATE INDEX IF NOT EXISTS "rspe_pattern_idx"
  ON "recon_settlement_pattern_examples" ("pattern_id");
--> statement-breakpoint
