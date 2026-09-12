-- ============================================================
-- Migration: COA Proposals — Task #7 AI COA Proposal Engine
-- Additive only. No DROP, no destructive ALTER.
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE coa_proposal_status AS ENUM (
    'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'IMPLEMENTED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE coa_financial_statement AS ENUM (
    'BALANCE_SHEET', 'PROFIT_AND_LOSS', 'CASH_FLOW_SUPPORT', 'OFF_STATEMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE coa_proposal_source_type AS ENUM (
    'BANK_RECONCILIATION', 'EXPENSE', 'TREASURY', 'VENDOR_PAYMENT', 'CUSTOMER_PAYMENT', 'MANUAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE coa_proposal_event_type AS ENUM (
    'PROPOSAL_CREATED', 'PROPOSAL_UPDATED', 'PROPOSAL_SUBMITTED',
    'PROPOSAL_APPROVED', 'PROPOSAL_REJECTED', 'PROPOSAL_CANCELLED',
    'COA_IMPLEMENTED', 'RULE_RECOMMENDATION_CREATED', 'LEARNING_FEEDBACK_CREATED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── coa_proposals ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coa_proposals (
  id                       SERIAL PRIMARY KEY,
  company_id               INTEGER NOT NULL,
  proposal_number          TEXT    NOT NULL,

  -- Source traceability
  source_type              coa_proposal_source_type NOT NULL DEFAULT 'MANUAL',
  source_record_id         TEXT,
  review_case_id           INTEGER,
  transaction_id           INTEGER,

  -- Lifecycle
  status                   coa_proposal_status NOT NULL DEFAULT 'DRAFT',

  -- Proposed account fields
  proposed_code            TEXT    NOT NULL,
  proposed_name            TEXT    NOT NULL,
  proposed_parent_id       INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  proposed_category        TEXT    NOT NULL,
  proposed_normal_balance  TEXT    NOT NULL,
  proposed_is_header       BOOLEAN NOT NULL DEFAULT FALSE,
  proposed_is_postable     BOOLEAN NOT NULL DEFAULT TRUE,
  proposed_effective_from  TIMESTAMPTZ,
  financial_statement      coa_financial_statement NOT NULL,

  -- AI context
  detected_intent          TEXT,
  normalized_description   TEXT,
  missing_mapping_type     TEXT,

  -- AI metrics
  ai_confidence            INTEGER,           -- 0–100
  historical_occurrences   INTEGER DEFAULT 0,
  estimated_monthly_usage  INTEGER DEFAULT 0,

  -- Rich JSON payloads
  reason_json              JSONB,
  evidence_json            JSONB,
  impact_analysis_json     JSONB,
  alternative_accounts_json JSONB,

  -- Workflow actors
  created_by               TEXT NOT NULL,
  submitted_by             TEXT,
  reviewed_by              TEXT,
  approved_by              TEXT,
  implemented_by           TEXT,

  -- Timestamps
  submitted_at             TIMESTAMPTZ,
  reviewed_at              TIMESTAMPTZ,
  approved_at              TIMESTAMPTZ,
  implemented_at           TIMESTAMPTZ,
  rejected_at              TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,

  -- Review outcome
  rejection_reason         TEXT,
  review_comments          TEXT,

  -- Idempotency
  idempotency_key          TEXT NOT NULL,
  request_fingerprint      TEXT,

  -- Post-implementation
  implemented_coa_id       INTEGER,

  -- Optimistic locking
  version                  INTEGER NOT NULL DEFAULT 1,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS coa_proposals_company_idempotency_uniq
  ON coa_proposals(company_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS coa_proposals_company_number_uniq
  ON coa_proposals(company_id, proposal_number);

CREATE INDEX IF NOT EXISTS coa_proposals_company_status_idx
  ON coa_proposals(company_id, status);

CREATE INDEX IF NOT EXISTS coa_proposals_company_intent_idx
  ON coa_proposals(company_id, detected_intent);

CREATE INDEX IF NOT EXISTS coa_proposals_company_created_idx
  ON coa_proposals(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS coa_proposals_source_idx
  ON coa_proposals(source_type, source_record_id);

-- ── coa_proposal_versions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coa_proposal_versions (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  proposal_id   INTEGER NOT NULL,
  version       INTEGER NOT NULL,
  snapshot_json JSONB   NOT NULL,
  change_reason TEXT,
  created_by    TEXT    NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS coa_proposal_versions_proposal_version_uniq
  ON coa_proposal_versions(proposal_id, version);

CREATE INDEX IF NOT EXISTS coa_proposal_versions_proposal_idx
  ON coa_proposal_versions(proposal_id);

CREATE INDEX IF NOT EXISTS coa_proposal_versions_company_idx
  ON coa_proposal_versions(company_id);

-- ── coa_proposal_audit ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coa_proposal_audit (
  id               SERIAL PRIMARY KEY,
  company_id       INTEGER NOT NULL,
  proposal_id      INTEGER NOT NULL,
  event_type       coa_proposal_event_type NOT NULL,
  actor_id         TEXT    NOT NULL,
  actor_type       TEXT    NOT NULL DEFAULT 'user',
  previous_status  TEXT,
  new_status       TEXT,
  reason           TEXT,
  metadata_json    JSONB,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coa_proposal_audit_proposal_idx
  ON coa_proposal_audit(proposal_id);

CREATE INDEX IF NOT EXISTS coa_proposal_audit_company_idx
  ON coa_proposal_audit(company_id);

CREATE INDEX IF NOT EXISTS coa_proposal_audit_event_idx
  ON coa_proposal_audit(event_type);

CREATE INDEX IF NOT EXISTS coa_proposal_audit_occurred_idx
  ON coa_proposal_audit(company_id, occurred_at DESC);
