---
name: Development accounting purge guard
description: Safe handling of explicit accounting transaction cleanup in the isolated development database
---

## Rule
Posted accounting entries and their lines are protected by database immutability triggers. An explicit development-only purge must first stop writers, confirm the Supabase development target, preserve master/configuration data, execute atomically, and verify foreign-key references afterward.

**Why:** Normal DELETE is intentionally rejected for posted entries; bypassing the guard is only appropriate for a deliberate destructive cleanup of the isolated development dataset, never as a workaround for application behavior.

**How to apply:** Keep the API workers stopped during the purge, limit the scope to transaction/audit records, do not delete COA, journal definitions, settings, tax definitions, or source business data unless separately requested, and leave the API stopped if restarting could repopulate the deleted records.