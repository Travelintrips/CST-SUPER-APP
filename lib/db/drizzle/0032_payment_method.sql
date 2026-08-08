-- Preserve the selected payment method on Paylabs payments.
-- Additive and idempotent for existing runtime databases.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_method TEXT;