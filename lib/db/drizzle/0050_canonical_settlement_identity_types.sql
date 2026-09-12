-- Canonical settlement IDs are persisted as text identities in the live
-- Sport Center contract. Numeric-looking values remain compatible with the
-- application boundary, which normalizes them to numbers where required.

CREATE SEQUENCE IF NOT EXISTS sport_center.payment_settlement_batches_id_seq;
--> statement-breakpoint
ALTER TABLE sport_center.payment_settlement_batches
  ALTER COLUMN id DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE sport_center.payment_settlement_batches
  ALTER COLUMN id TYPE TEXT
  USING id::text;
--> statement-breakpoint
ALTER TABLE sport_center.payment_settlement_batches
  ALTER COLUMN id SET DEFAULT nextval('sport_center.payment_settlement_batches_id_seq')::text;
--> statement-breakpoint
ALTER TABLE sport_center.payment_settlement_items
  ALTER COLUMN settlement_id TYPE TEXT
  USING settlement_id::text;