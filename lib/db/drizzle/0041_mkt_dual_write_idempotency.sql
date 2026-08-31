-- Marketplace dual-write retry idempotency
--
-- A logical RFQ is identified by one stable key. The partial unique index keeps
-- legacy rows (which have no key) untouched while making new/retried requests
-- concurrency-safe.

ALTER TABLE mkt_dual_write_log
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS mdwl_idempotency_key_uidx
  ON mkt_dual_write_log(idempotency_key)
  WHERE idempotency_key IS NOT NULL;