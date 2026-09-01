-- The canonical journal's payment bridge is stored as text in the live
-- Sport Center contract because the same source identity is also persisted in
-- source_id.  Keep numeric comparisons explicit in application queries.

ALTER TABLE sport_center.accounting_journals
  ALTER COLUMN payment_id TYPE TEXT
  USING payment_id::text;