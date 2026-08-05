-- Phase 2E.1: Marketplace Notification Reliability Queue
-- Tabel ini menggantikan fire-and-forget WA kirim langsung di vendorSelectionService
-- dan mengaktifkan WA invite yang sebelumnya hanya disiapkan tapi tidak pernah dikirim.
--
-- Status lifecycle: pending → sending → sent | failed → retrying → exhausted
-- Worker: marketplaceNotificationWorker (startupOrchestrator, delay 160s)

CREATE TABLE IF NOT EXISTS mkt_notification_queue (
  id                SERIAL PRIMARY KEY,
  event_type        TEXT NOT NULL,          -- mkt_vendor_invitation_notification | mkt_vendor_winner_notification | mkt_vendor_rejected_notification
  channel           TEXT NOT NULL DEFAULT 'whatsapp',
  recipient_type    TEXT NOT NULL,          -- 'vendor'
  recipient_id      INTEGER,               -- vendor (supplier) id
  recipient_phone   TEXT,
  rfq_id            INTEGER,
  vendor_quote_id   INTEGER,
  purchase_order_id INTEGER,
  payload_json      JSONB NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sending','sent','failed','retrying','exhausted')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  last_error        TEXT,
  next_retry_at     TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  deduplication_key TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- P1: partial index now includes 'failed' so polling (which selects
-- pending/retrying/failed) can use an index scan instead of a full table scan.
CREATE INDEX IF NOT EXISTS idx_mkt_notif_queue_status_v2
  ON mkt_notification_queue (status)
  WHERE status IN ('pending','retrying','failed');

-- P1: dedicated index for next_retry_at lookups used by the worker's polling query.
CREATE INDEX IF NOT EXISTS idx_mkt_notif_queue_next_retry_at
  ON mkt_notification_queue (next_retry_at)
  WHERE next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mkt_notif_queue_rfq_id
  ON mkt_notification_queue (rfq_id);

-- P2: prevent the same logical notification from being enqueued twice.
-- NULL values are excluded so existing/legacy enqueue calls without a
-- deduplication_key keep working unaffected (backward compatible).
CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_notif_queue_dedup_key
  ON mkt_notification_queue (deduplication_key)
  WHERE deduplication_key IS NOT NULL;

COMMENT ON TABLE mkt_notification_queue IS
  'Phase 2E.1 — Reliable WA notification queue for marketplace events (invite, winner, rejected). Worker polls every 3 min.';
