-- Align the isolated TEST PPJK relations with the verified runtime contract.

ALTER TABLE ppjk_orders
  DROP CONSTRAINT IF EXISTS ppjk_orders_portal_order_id_fkey;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ppjk_dc_order_type_uniq
  ON ppjk_document_checklist (ppjk_order_id, doc_type);
--> statement-breakpoint
ALTER TABLE ppjk_orders
  ADD CONSTRAINT ppjk_status_check CHECK (status IN (
    'draft','waiting_documents','document_review','document_completed',
    'quotation','waiting_customer','customer_approved',
    'preparing_pib','preparing_peb','submitted_ceisa','inspection',
    'red_lane','yellow_lane','green_lane','hold',
    'sppb','released','completed','cancelled'
  )) NOT VALID;