-- The settlement journal stores both settlement identities as text, matching
-- the canonical source identity representation used by the live contract.

ALTER TABLE sport_center.accounting_journals
  ALTER COLUMN settlement_id TYPE TEXT
  USING settlement_id::text;
--> statement-breakpoint
ALTER TABLE sport_center.accounting_journals
  ALTER COLUMN settlement_batch_id TYPE TEXT
  USING settlement_batch_id::text;