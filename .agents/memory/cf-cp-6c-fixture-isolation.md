---
name: CF-CP-6C fixture isolation
description: DEV Customer Portal proof harnesses must skip reused integer identities without touching historical finance rows.
---

Fixture allocation must use the normal database allocator, preflight the candidate
against actual finance-owner base tables, and retry through a finite limit. Generic
source_id columns in unrelated AI/fleet views are not payment identity surfaces.

**Why:** DEV payment sequences can lag orphaned accounting, bank, and Sport Center
references. Treating any generic source_id as a payment identity causes false
collisions, while deleting rows by reused IDs can mutate historical business data.

**How to apply:** Roll back only the newly inserted fixture on collision, keep an
exact ownership registry, transition owned posted entries before deleting owned
lines, and never repair or delete pre-existing collision rows.