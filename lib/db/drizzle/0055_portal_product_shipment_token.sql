-- Product-first customer links use separate credentials for product approval
-- and shipment selection. Existing orders keep their approval token; the new
-- token is populated when the shipment-selection phase is entered.
ALTER TABLE portal_product_orders
  ADD COLUMN IF NOT EXISTS shipment_selection_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS portal_product_orders_shipment_selection_token_uniq
  ON portal_product_orders (shipment_selection_token)
  WHERE shipment_selection_token IS NOT NULL;