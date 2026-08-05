-- Phase 2E: Winner fields on mkt_rfqs
-- Idempotent — semua statement pakai IF NOT EXISTS / DO $$ guard
-- Additive only — tidak ada DROP atau ALTER existing column
-- Requires session-mode connection (DO $$ blocks incompatible with pgBouncer transaction mode)

-- ── 1. winner_selected_at ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_rfqs'
      AND column_name  = 'winner_selected_at'
  ) THEN
    ALTER TABLE mkt_rfqs ADD COLUMN winner_selected_at TIMESTAMP;
  END IF;
END $$;
--> statement-breakpoint

-- ── 2. winner_selected_by ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_rfqs'
      AND column_name  = 'winner_selected_by'
  ) THEN
    ALTER TABLE mkt_rfqs ADD COLUMN winner_selected_by TEXT;
  END IF;
END $$;
--> statement-breakpoint

-- ── 3. winning_quote_id ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mkt_rfqs'
      AND column_name  = 'winning_quote_id'
  ) THEN
    ALTER TABLE mkt_rfqs ADD COLUMN winning_quote_id INTEGER;
  END IF;
END $$;
--> statement-breakpoint

-- ── 4. FK: winning_quote_id → mkt_vendor_quotes(id) ─────────────────────────
-- ON DELETE SET NULL: jika vendor quote dihapus, winner tetap tercatat (SET NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema    = 'public'
      AND table_name      = 'mkt_rfqs'
      AND constraint_name = 'mkt_rfqs_winning_quote_id_fkey'
  ) THEN
    ALTER TABLE mkt_rfqs
      ADD CONSTRAINT mkt_rfqs_winning_quote_id_fkey
      FOREIGN KEY (winning_quote_id)
      REFERENCES mkt_vendor_quotes(id)
      ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint

-- ── 5. Index: mkt_rfqs_winning_quote_idx ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS mkt_rfqs_winning_quote_idx
  ON mkt_rfqs(winning_quote_id)
  WHERE winning_quote_id IS NOT NULL;
