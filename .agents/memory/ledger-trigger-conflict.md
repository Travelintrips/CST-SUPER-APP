---
name: Ledger trigger conflict — ae_immutability vs fn_block_posted_entry_update
description: Two separate DB triggers both fire on UPDATE to accounting_entries. ae_immutability_fn is stricter and will override the cancellation exception unless kept in sync.
---

## Rule
Both `ae_immutability_fn` (created by `runLedgerGuardMigration` in `ledgerGuard.ts`) and `fn_block_posted_entry_update` (created by `runFinanceGovernanceMigration`) fire `BEFORE UPDATE` on `accounting_entries`.

`fn_block_posted_entry_update` allows `posted → draft` when `NEW.cancel_reason IS NOT NULL AND NEW.cancelled_at IS NOT NULL`.

`ae_immutability_fn` originally only allowed `posted → voided`. It was stricter and **overrode** the cancellation exception, causing the repair migration to fail with `P0001`.

**Fix:** Added matching exception to `ae_immutability_fn` (at the top of the BEGIN block, before the voided check):
```sql
IF OLD.status = 'posted' AND NEW.status = 'draft'
   AND NEW.cancel_reason IS NOT NULL AND NEW.cancelled_at IS NOT NULL THEN
  RETURN NEW;
END IF;
```

**Why:** The two triggers were written independently; the ledger guard was added later without awareness of the cancellation exception in governance. Any future tightening of `ae_immutability_fn` must preserve this cancellation window.

**How to apply:** Whenever adding a new exception to `fn_block_posted_entry_update`, check `ae_immutability_fn` in `ledgerGuard.ts` and add a matching exception there too. The repair migration pattern (downgrade → insert lines → promote) depends on the cancellation window being open in BOTH triggers.

## Production void caveat

The live production contract can still reject the application's direct `posted → voided` update when the governance trigger has not received the same exception. The current void helper creates and commits the reversal before attempting that status update, so a failed update can leave a balanced reversal paired with an original that is still `posted`; production schema drift may also make its `updated_at` assignment fail.

**Why:** The helper's reversal insert and original-entry metadata update are not one database transaction, while the two live immutability triggers are independently maintained.

**How to apply:** Preflight the live trigger definitions and update-column availability before a production void. Make the helper atomic and keep both triggers aligned; if a legacy partial void exists, repair only through a verified, explicitly allowed cancellation bridge rather than disabling triggers or deleting ledger rows.
