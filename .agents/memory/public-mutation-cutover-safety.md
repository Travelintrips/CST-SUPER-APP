---
name: Public mutation cutover safety
description: Safety rule for moving settlement links from a mirrored mutation table to the public mutation identity.
---

The public bank-mutation identity is the only active reconciliation identity. Every approval/candidate SQL reference must explicitly use `public.bank_mutations`; never rely on `search_path`. Compatibility links must be atomic, and approval must re-resolve the company-scoped bank account.

**Why:** A later public-only migration block is not sufficient if an earlier startup block first recreates legacy foreign keys or clears values that are valid only in the new identity space. That can silently damage links on the second startup.

**How to apply:** Schema-qualify mutation reads, locks, updates, candidate joins, builder lookups, and completion checks. Disable obsolete projection/FK setup. Translate legacy values only while live FK targets prove they are legacy; verify repeat runs and overlapping IDs.