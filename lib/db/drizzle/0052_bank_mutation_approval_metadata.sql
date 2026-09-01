-- Approval metadata is part of the public bank-mutation contract used by
-- canonical link-only reconciliation.

ALTER TABLE bank_mutations
  ADD COLUMN IF NOT EXISTS approved_by TEXT;
--> statement-breakpoint
ALTER TABLE bank_mutations
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;