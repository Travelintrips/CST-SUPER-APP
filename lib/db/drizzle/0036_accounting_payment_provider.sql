-- Preserve the payment provider across Sport Center and Accounting Hub.
-- Additive and idempotent: safe for existing development and production schemas.
ALTER TABLE accounting_entries
  ADD COLUMN IF NOT EXISTS payment_provider TEXT;
--> statement-breakpoint
ALTER TABLE accounting_payments
  ADD COLUMN IF NOT EXISTS payment_provider TEXT;