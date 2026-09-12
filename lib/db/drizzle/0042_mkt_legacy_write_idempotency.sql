-- Marketplace legacy compatibility-write idempotency
--
-- Additive follow-up to 0041. This must remain a separate migration because
-- existing environments may already have recorded 0041 as applied.

ALTER TABLE portal_product_orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- A normal unique index is intentional: PostgreSQL permits multiple NULL
-- values, while every keyed request is protected across processes.
CREATE UNIQUE INDEX IF NOT EXISTS ppo_idempotency_key_uidx
  ON portal_product_orders(idempotency_key);