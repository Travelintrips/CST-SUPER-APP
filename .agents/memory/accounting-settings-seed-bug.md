---
name: Accounting settings seed bug — journal IDs null
description: accountingSeed.ts bug causing null journal IDs in accounting_settings; fix and enum issue.
---

# Accounting settings seed bug — journal IDs null for all companies

## The Rule
After any dev DB reset, verify `accounting_settings` has non-null `cash_journal_id` and `bank_journal_id` for all 4 companies. If null, sport center payments silently skip accounting.

**Why:** `accountingSeed.ts` (line ~622) originally loaded `allJournals WHERE company_id = cid` (company 1 only). So `journalByCode` only had CST journals. `getJournal("BNK", 2)` returned `undefined` for WS/DV/ER → settings for companies 2–4 fell back to company 1's journal IDs (or null if the fallback also failed). Fixed by changing to `WHERE company_id IS NOT NULL`.

**How to apply:** If sport center payments aren't entering accounting, query:
```sql
SELECT company_id, cash_journal_id, bank_journal_id FROM accounting_settings ORDER BY company_id;
```
If any are null, trigger a full seed or run the direct UPDATE script used in Jul 2026.

## Enum issue
`accounting_payment_status` enum in dev DB was missing the `'draft'` value — causes the startup backfill migration for sport_center payments to fail with `invalid input value for enum`. Fix: `ALTER TYPE accounting_payment_status ADD VALUE IF NOT EXISTS 'draft'`.

## Bizportal Supabase key mismatch
`vite.config.ts` for bizportal now uses `SUPABASE_URL_DEV` / `SUPABASE_ANON_KEY_DEV` (dev priority) instead of `VITE_SUPABASE_*` secrets in non-deployment environments. This prevents "Invalid API key" when the VITE_ secrets belong to a different Supabase project.
