---
name: Sport Center payment_method backfill fix
description: Root causes and solution for accounting_entries.payment_method = NULL on sport center booking entries
---

## Problem
`accounting_entries.payment_method` was NULL for posted sport center booking entries even after backfill was added.

## Root Cause Chain
1. **Trigger ordering**: `accountingHubMigration` runs before `financeGovernanceMigration` in startup chain (index.ts line ~1638 vs ~1724).
2. **Trigger `fn_block_posted_entry_update`** (from `financeGovernanceMigration.ts`) blocks ALL UPDATEs on posted entries — including metadata-only updates like `payment_method`.
3. When `accountingHubMigration` backfills tried to SET `payment_method` on posted entries, they hit `IMMUTABILITY_VIOLATION: Cannot modify a posted journal entry`.
4. Secondary root: `public.sport_payments.booking_id` can be NULL when trigger couldn't resolve `public.sport_bookings.sc_booking_id = NEW.booking_id`, breaking all join-based backfill paths.

## Fix
### 1. Trigger patch (both files)
`fn_block_posted_entry_update` updated in `financeGovernanceMigration.ts` to allow **metadata-only** updates (no financial field or status change). Matches policy of `ae_immutability_fn` in `ledgerGuard.ts`.

### 2. Inline trigger patch in `accountingHubMigration.ts`
Since accounting hub runs BEFORE finance governance, the trigger must be patched inline inside `runAccountingHubMigration()` BEFORE the backfill queries execute. Added `CREATE OR REPLACE FUNCTION fn_block_posted_entry_update()` with new logic at the start of the backfill section.

### 3. Journal-code backfill (most reliable path, path 2c)
When `sport_payments.booking_id` is NULL, join-based paths fail. Derive method from journal code:
```sql
UPDATE accounting_entries ae
SET payment_method = CASE aj.code WHEN 'CSH' THEN 'cash' WHEN 'QRIS' THEN 'qris' ELSE 'transfer' END
FROM accounting_journals aj
WHERE ae.journal_id = aj.id
  AND ae.source = 'sport_center_booking'
  AND ae.payment_method IS NULL
```

### 4. Booking-number ref path (path 2d)
Join via `ae.ref = sport_bookings.booking_number` → `sport_payments.payment_number = 'SCPAY-SC-{sc_booking_id}'` to handle entries where `booking_id` is NULL.

## What Allowed vs Blocked (trigger policy)
- **Allowed**: UPDATE where `status`, `total_debit`, `total_credit`, `journal_id`, `date`, `source`, `source_id` all unchanged (metadata-only, e.g. `payment_method`)
- **Also allowed**: posted → draft cancellation with `cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL`
- **Blocked**: any change to financial fields while status = posted
- **Blocked**: status change from posted to anything other than 'draft' (via cancellation) or 'voided' (via reversal)

**Why:** `payment_method` is observational metadata, not a financial value. Setting it retroactively does not alter the audit trail.

## Row count logging
Added `.then((r) => if (n > 0) logger.info({ updated: n }, "..."))` to all 4 backfill paths. Silence on subsequent runs = 0 rows to update (already fixed).
