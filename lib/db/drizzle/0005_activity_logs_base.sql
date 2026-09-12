-- ─────────────────────────────────────────────────────────────────────────────
-- ACTIVITY LOG BASE
-- The runtime enterprise migration creates this audit table before adding the
-- marketplace foreign-key projections in migration 0029.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_logs (
  id                SERIAL PRIMARY KEY,
  rfq_id            INTEGER,
  order_id          INTEGER,
  actor_type        TEXT NOT NULL DEFAULT 'admin',
  actor_id          TEXT,
  actor_name        TEXT,
  action            TEXT NOT NULL,
  old_value         JSONB,
  new_value         JSONB,
  description       TEXT,
  ip_address        TEXT,
  deduplication_key TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS activity_logs_order_idx
  ON activity_logs(order_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_logs_rfq_idx
  ON activity_logs(rfq_id);