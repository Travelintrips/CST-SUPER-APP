-- Preserve the external receiving-account identity on the accounting journal.
-- This is metadata only: it is not the debit/credit COA account ID.
ALTER TABLE accounting_entries
  ADD COLUMN IF NOT EXISTS bank_account_id TEXT;