-- Candidate identities are source-qualified opaque identities. Numeric values
-- remain accepted, but storage must not force every source into integer IDs.

ALTER TABLE bank_reconciliation_matches
  ALTER COLUMN candidate_id TYPE TEXT
  USING candidate_id::text;
--> statement-breakpoint
ALTER TABLE bank_reconciliation_matches
  ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE;