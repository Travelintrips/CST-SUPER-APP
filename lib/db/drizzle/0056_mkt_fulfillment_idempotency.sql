-- Canonical Marketplace fulfillment request identity.
-- Nullable keys preserve compatibility for historical callers; supplied keys
-- are unique within their parent PO or shipment.
ALTER TABLE mkt_po_shipments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE mkt_po_shipment_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE mkt_po_goods_receipts
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS mkt_po_shipments_po_idempotency_unique
  ON mkt_po_shipments (po_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS mkt_po_shipment_events_shipment_idempotency_unique
  ON mkt_po_shipment_events (shipment_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS mkt_po_goods_receipts_shipment_idempotency_unique
  ON mkt_po_goods_receipts (shipment_id, idempotency_key);