-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2A.2: mkt_dual_write_log — Dual Write Reliability Layer
-- Migration: 0014
-- Run: pnpm migrate:dev  (dev)  |  pnpm migrate:prod  (prod)
--
-- IDEMPOTENT: aman dijalankan berulang kali.
-- Handles both:
--   A) Fresh installation — table belum ada, enum belum ada.
--   B) Existing installation (Phase 2A.1 boot migration sudah jalan) —
--      table ada dengan status TEXT, perlu ALTER ke enum + tambah kolom.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Create enum (idempotent) ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mkt_dual_write_status') THEN
    CREATE TYPE mkt_dual_write_status AS ENUM (
      'pending',
      'success',
      'linked',
      'failed',
      'retrying',
      'exhausted'
    );
  END IF;
END $$;

-- ── 2. Create table with all columns (new installations) ─────────────────────
CREATE TABLE IF NOT EXISTS mkt_dual_write_log (
  id                  BIGSERIAL           PRIMARY KEY,
  -- Structured fields for fast dashboard queries
  catalog_item_id     INTEGER             NOT NULL,
  buyer_name          TEXT                NOT NULL DEFAULT '',
  buyer_email         TEXT                NOT NULL,
  buyer_company       TEXT,
  qty                 NUMERIC(10,2)       NOT NULL DEFAULT 1,
  unit                TEXT                NOT NULL DEFAULT 'unit',
  shipping_address    TEXT,
  -- Full snapshot for retry (tidak re-fetch catalog saat retry)
  payload             JSONB               NOT NULL DEFAULT '{}',
  -- State machine
  status              mkt_dual_write_status NOT NULL DEFAULT 'pending',
  attempt             INTEGER             NOT NULL DEFAULT 0,
  last_error          TEXT,
  -- New pipeline result (set saat success)
  mkt_rfq_id          INTEGER,
  mkt_rfq_number      TEXT,
  -- Legacy backlink (set oleh linkLegacyOrder)
  portal_order_id     INTEGER,
  portal_order_number TEXT,
  -- Timestamps
  created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  last_retry_at       TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  -- Retry timing untuk average_retry_duration metric
  retry_started_at    TIMESTAMPTZ,
  retry_completed_at  TIMESTAMPTZ,
  -- Resolution label
  resolution          TEXT
);

-- ── 3. Add missing columns (Phase 2A.1 tables already exist) ─────────────────
ALTER TABLE mkt_dual_write_log
  ADD COLUMN IF NOT EXISTS buyer_name TEXT NOT NULL DEFAULT '';

ALTER TABLE mkt_dual_write_log
  ADD COLUMN IF NOT EXISTS buyer_company TEXT;

ALTER TABLE mkt_dual_write_log
  ADD COLUMN IF NOT EXISTS qty NUMERIC(10,2) NOT NULL DEFAULT 1;

ALTER TABLE mkt_dual_write_log
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'unit';

ALTER TABLE mkt_dual_write_log
  ADD COLUMN IF NOT EXISTS shipping_address TEXT;

ALTER TABLE mkt_dual_write_log
  ADD COLUMN IF NOT EXISTS retry_started_at TIMESTAMPTZ;

ALTER TABLE mkt_dual_write_log
  ADD COLUMN IF NOT EXISTS retry_completed_at TIMESTAMPTZ;

-- ── 4. Migrate status column TEXT → enum (if column is still TEXT) ────────────
-- Safe: semua nilai status yang ada adalah valid enum values.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'mkt_dual_write_log'
      AND  column_name  = 'status'
      AND  data_type    = 'text'
  ) THEN
    -- Drop NOT NULL first to allow safe USING cast
    ALTER TABLE mkt_dual_write_log ALTER COLUMN status DROP NOT NULL;
    ALTER TABLE mkt_dual_write_log ALTER COLUMN status DROP DEFAULT;

    ALTER TABLE mkt_dual_write_log
      ALTER COLUMN status
      TYPE mkt_dual_write_status
      USING status::mkt_dual_write_status;

    ALTER TABLE mkt_dual_write_log ALTER COLUMN status SET DEFAULT 'pending';
    ALTER TABLE mkt_dual_write_log ALTER COLUMN status SET NOT NULL;
  END IF;
END $$;

-- ── 5. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS mdwl_status_idx
  ON mkt_dual_write_log(status);

CREATE INDEX IF NOT EXISTS mdwl_mkt_rfq_id_idx
  ON mkt_dual_write_log(mkt_rfq_id)
  WHERE mkt_rfq_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mdwl_created_at_idx
  ON mkt_dual_write_log(created_at);

CREATE INDEX IF NOT EXISTS mdwl_portal_order_id_idx
  ON mkt_dual_write_log(portal_order_id)
  WHERE portal_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mdwl_buyer_email_idx
  ON mkt_dual_write_log(buyer_email);
