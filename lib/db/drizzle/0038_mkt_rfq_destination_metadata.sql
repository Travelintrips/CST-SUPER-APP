-- Marketplace RFQ destination metadata.
-- Additive and idempotent: existing text-only RFQs remain valid.
ALTER TABLE mkt_rfqs
  ADD COLUMN IF NOT EXISTS destination_place_id TEXT,
  ADD COLUMN IF NOT EXISTS destination_lat NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS destination_lng NUMERIC(10, 7);