---
name: Posting service draft-first rule
description: accountingPostingService.ts must insert entries as 'draft' before inserting lines, due to trg_block_lines_mutation trigger.
---

# Posting Service: Draft-First Entry Insert

## The rule
Any function that inserts into `accounting_entries` AND then inserts into `accounting_entry_lines` MUST:
1. Insert the entry with `status: "draft"`
2. Insert the lines
3. `UPDATE accounting_entries SET status = 'posted' WHERE id = <entryId>`

**Why:** The trigger `fn_block_posted_lines_mutation` (registered as `trg_block_lines_mutation` on `BEFORE INSERT OR UPDATE OR DELETE` on `accounting_entry_lines`) raises `IMMUTABILITY_VIOLATION` if the parent entry already has `status = 'posted'`. Inserting the entry as "posted" up-front causes the subsequent line INSERT to be rejected by the trigger. If the insert and line operations are not wrapped in a single transaction, the entry persists in the DB with zero lines — which causes the reversal endpoint to fail with "Entri tidak memiliki baris jurnal".

**How to apply:** Check every place that inserts an `accounting_entries` row and then inserts `accounting_entry_lines` rows. Both `postToAccountingHub` and `voidAccountingEntry` in `accountingPostingService.ts` had this bug; both were fixed. `_postEntryCore` in `accounting.ts` already uses the correct pattern (see the comment there).
