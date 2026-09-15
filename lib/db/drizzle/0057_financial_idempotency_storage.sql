-- Financial request idempotency storage.
-- This is also applied by the API startup migration lane so request-time
-- idempotency checks never need to acquire a DDL lock.
CREATE TABLE IF NOT EXISTS processed_requests (
  idempotency_key TEXT NOT NULL,
  namespace       TEXT NOT NULL DEFAULT 'default',
  response_code   INTEGER NOT NULL DEFAULT 200,
  response_body   JSONB,
  actor           TEXT,
  request_fingerprint TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (idempotency_key, namespace)
);

ALTER TABLE processed_requests
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS pr_expires_idx
  ON processed_requests(expires_at);