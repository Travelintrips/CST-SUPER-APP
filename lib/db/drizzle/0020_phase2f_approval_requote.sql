-- Phase 2F: Buyer Approval / Requote Flow
-- Idempotent — pakai IF NOT EXISTS / DO $$ guards
-- Requires session-mode connection (SUPABASE_MIGRATION_URL, bukan pgBouncer)
-- Note: ALTER TYPE ... ADD VALUE tidak bisa dijalankan di dalam transaksi eksplisit
--       tapi aman dijalankan di session connection (auto-commit per statement)

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. mkt_rfqs — Approval state columns
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_rfqs'
      AND column_name  = 'approval_status'
  ) THEN
    ALTER TABLE mkt_rfqs ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'none';
    -- Valid values: none | pending | approved | rejected
    -- 'none'     = tidak butuh approval (approval_level <= 1 atau NULL)
    -- 'pending'  = menunggu approval
    -- 'approved' = sudah diapprove → mkt_rfqs.status = 'submitted'
    -- 'rejected' = ditolak → buyer perlu revisi, status tetap 'draft'
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_rfqs'
      AND column_name  = 'approval_requested_at'
  ) THEN
    ALTER TABLE mkt_rfqs ADD COLUMN approval_requested_at TIMESTAMP;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_rfqs'
      AND column_name  = 'approval_resolved_at'
  ) THEN
    ALTER TABLE mkt_rfqs ADD COLUMN approval_resolved_at TIMESTAMP;
  END IF;
END $$;
--> statement-breakpoint

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. mkt_vendor_quotes — Requote columns
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_vendor_quotes'
      AND column_name  = 'requote_notes'
  ) THEN
    ALTER TABLE mkt_vendor_quotes ADD COLUMN requote_notes TEXT;
    -- Catatan dari admin kenapa diminta requote
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_vendor_quotes'
      AND column_name  = 'requote_deadline'
  ) THEN
    ALTER TABLE mkt_vendor_quotes ADD COLUMN requote_deadline TIMESTAMP;
    -- Deadline untuk vendor merespons requote (opsional)
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_vendor_quotes'
      AND column_name  = 'requote_round'
  ) THEN
    ALTER TABLE mkt_vendor_quotes ADD COLUMN requote_round INTEGER NOT NULL DEFAULT 1;
    -- Round 1 = initial quote, 2 = first requote, dst.
    -- Di-increment saat vendor resubmit dari status 'requote_requested'
  END IF;
END $$;
--> statement-breakpoint

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Enum: tambah 'requote_requested' ke mkt_quote_status
-- CATATAN: ALTER TYPE ADD VALUE tidak bisa dijalankan dalam transaction block.
--          Statement ini harus dijalankan di luar BEGIN/COMMIT.
--          Dengan psql --set ON_ERROR_STOP=1 tanpa BEGIN eksplisit, aman.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TYPE mkt_quote_status ADD VALUE IF NOT EXISTS 'requote_requested';
--> statement-breakpoint

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. mkt_rfq_approvals — Tabel baru
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mkt_rfq_approvals (
  id                  SERIAL PRIMARY KEY,

  -- RFQ yang dimintakan approval
  rfq_id              INTEGER NOT NULL
                        REFERENCES mkt_rfqs(id) ON DELETE CASCADE,

  -- Level approval (1=L1, 2=L2, untuk multi-level future support)
  approver_level      INTEGER NOT NULL DEFAULT 1,

  -- Member yang di-assign sebagai approver (NULL = terbuka untuk semua eligible approver)
  approver_member_id  INTEGER
                        REFERENCES portal_company_members(id) ON DELETE SET NULL,

  -- Status: pending | approved | rejected | delegated
  status              TEXT NOT NULL DEFAULT 'pending',

  -- Timestamps
  requested_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  responded_at        TIMESTAMP,

  -- Catatan dari approver
  response_notes      TEXT,

  -- Member yang benar-benar merespons (audit trail)
  responder_member_id INTEGER
                        REFERENCES portal_company_members(id) ON DELETE SET NULL,

  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS mkt_rfq_approvals_rfq_idx
  ON mkt_rfq_approvals(rfq_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS mkt_rfq_approvals_status_idx
  ON mkt_rfq_approvals(status)
  WHERE status = 'pending';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS mkt_rfq_approvals_approver_idx
  ON mkt_rfq_approvals(approver_member_id)
  WHERE approver_member_id IS NOT NULL;
