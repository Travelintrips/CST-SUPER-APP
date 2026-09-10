---
name: Development accounting purge guard
description: Safe handling of explicit accounting transaction cleanup in the isolated development database
---

## Rule
Posted accounting entries and their lines are protected by database immutability triggers. An explicit development-only purge must first stop writers, confirm the Supabase development target, preserve master/configuration data, execute atomically, and verify foreign-key references afterward.

**Why:** Normal DELETE is intentionally rejected for posted entries; bypassing the guard is only appropriate for a deliberate destructive cleanup of the isolated development dataset, never as a workaround for application behavior.

**How to apply:** Keep the API workers stopped during the purge, limit the scope to transaction/audit records, do not delete COA, journal definitions, settings, tax definitions, or source business data unless separately requested, and leave the API stopped if restarting could repopulate the deleted records.

## Derived mirror identity

When removing development accounting descendants, match fleet-ledger mirrors by both `source_type` and `source_id`; `source_id` alone is not globally unique across business modules.

**Why:** The DEV dataset contained the same source IDs under bank-reconciliation, sales-payment, and sport-center mirror types. An ID-only delete would remove unrelated financial mirrors.

**How to apply:** Build the purge manifest with the exact source discriminator, lock writers first, and fail closed if the manifest differs from the audited counts.

## User-triggered mutation purge

A user-facing hard-delete action for development bank mutations must require an authenticated internal admin, remain unavailable outside development, and share a database advisory lock with every matching run. Keep foreign keys enabled and exclude journal-, posting-, and settlement-owned mutations.

**Why:** A process-local “matching active” flag cannot coordinate multiple API instances, and a destructive route on a broadly mounted reconciliation router is otherwise vulnerable to unauthenticated deletion.

**How to apply:** Authorize before migrations or database work, acquire the shared transaction advisory lock before source-table locks, return conflict on contention, and report preserved rows instead of forcing deletion.

## Cross-module settlement boundary

The DEV reconciliation reset should remove reconciliation postings and candidates but retain source bank mutations that are referenced by customer-portal or Sport Center settlement records.

**Why:** A single bank mutation can be reused as canonical settlement evidence by another module; deleting or resetting it would orphan a valid settlement.

**How to apply:** Exclude settlement-owned mutation IDs from reset/delete predicates and report them to the caller instead of silently mutating them.