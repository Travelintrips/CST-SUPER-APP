-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2B: mkt_rfqs — Buyer Identity (portal_customer_id)
-- Migration: 0015
-- Run: pnpm migrate:dev  (dev)  |  pnpm migrate:prod  (prod)
--
-- IDEMPOTENT: aman dijalankan berulang kali.
--
-- Tujuan:
--   Setiap RFQ dari logged-in portal customer di-link ke portal_customers.id.
--   Guest RFQ tetap portal_customer_id = NULL.
--
-- Backward compatible:
--   - Kolom nullable — tidak ada nilai default yang wajib.
--   - Existing rows tetap valid (portal_customer_id = NULL = guest / legacy).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE mkt_rfqs
  ADD COLUMN IF NOT EXISTS portal_customer_id INTEGER REFERENCES portal_customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS mkt_rfqs_portal_customer_idx
  ON mkt_rfqs(portal_customer_id)
  WHERE portal_customer_id IS NOT NULL;
