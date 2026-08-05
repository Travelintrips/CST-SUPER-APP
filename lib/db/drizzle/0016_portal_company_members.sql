-- Phase 2B.1 — Buyer Organization Layer
-- Migration: 0016_portal_company_members
-- Date: 2026-07-02
-- Idempotent — safe to re-run

-- ── 1. portal_company_members (NEW TABLE) ─────────────────────────────────────
-- Jembatan antara portal_customers dan companies (ERP).
-- Menyimpan procurement role, department, cost center, approval level per membership.

CREATE TABLE IF NOT EXISTS portal_company_members (
  id                  SERIAL PRIMARY KEY,
  portal_customer_id  INTEGER NOT NULL
                        REFERENCES portal_customers(id) ON DELETE CASCADE,
  company_id          INTEGER NOT NULL
                        REFERENCES companies(id) ON DELETE CASCADE,

  -- Procurement identity
  buyer_role          TEXT NOT NULL DEFAULT 'requester',
  department          TEXT,
  cost_center         TEXT,
  approval_level      INTEGER,
  spending_limit      NUMERIC(15, 2),

  -- Membership status
  is_active           BOOLEAN NOT NULL DEFAULT true,

  -- Invitation audit
  invited_by          INTEGER REFERENCES portal_customers(id) ON DELETE SET NULL,
  invited_at          TIMESTAMP,
  joined_at           TIMESTAMP,

  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (portal_customer_id, company_id)
);

CREATE INDEX IF NOT EXISTS pcm_company_idx
  ON portal_company_members(company_id);

CREATE INDEX IF NOT EXISTS pcm_portal_customer_idx
  ON portal_company_members(portal_customer_id);

CREATE INDEX IF NOT EXISTS pcm_active_company_idx
  ON portal_company_members(company_id, is_active);

-- ── 2. mkt_rfqs — Buyer context snapshot columns (additive) ──────────────────
-- Kolom ini di-snapshot dari portal_company_members saat RFQ dibuat.
-- Nullable — RFQ guest tetap valid tanpa nilai.

ALTER TABLE mkt_rfqs
  ADD COLUMN IF NOT EXISTS buyer_role           TEXT,
  ADD COLUMN IF NOT EXISTS buyer_department     TEXT,
  ADD COLUMN IF NOT EXISTS buyer_cost_center    TEXT,
  ADD COLUMN IF NOT EXISTS buyer_approval_level INTEGER;

-- ── 3. mkt_rfqs — Index untuk admin dashboard (company + status filter) ───────
CREATE INDEX IF NOT EXISTS mkt_rfqs_company_status_idx
  ON mkt_rfqs(company_id, status)
  WHERE company_id IS NOT NULL;
