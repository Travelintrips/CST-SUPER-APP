-- Marketplace Phase 1C / Sprint 04C
-- Extend the existing activity log with nullable marketplace references.
ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS mkt_rfq_id INTEGER
    REFERENCES mkt_rfqs(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS mkt_vendor_quote_id INTEGER
    REFERENCES mkt_vendor_quotes(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS mkt_purchase_order_id INTEGER
    REFERENCES mkt_purchase_orders(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_logs_mkt_rfq_idx
  ON activity_logs (mkt_rfq_id)
  WHERE mkt_rfq_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_logs_mkt_quote_idx
  ON activity_logs (mkt_vendor_quote_id)
  WHERE mkt_vendor_quote_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_logs_mkt_po_idx
  ON activity_logs (mkt_purchase_order_id)
  WHERE mkt_purchase_order_id IS NOT NULL;