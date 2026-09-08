---
name: Live schema diff discipline
description: How to interpret DEV/PROD PostgreSQL catalog diffs without treating security or legacy objects as migration instructions.
---

Raw catalog equality is not the same as canonical application parity.

**Why:** PROD can intentionally contain stronger RLS deny policies and legacy objects, while DEV can contain newer feature tables. Treating every catalog difference as drift can weaken production security or create unsafe migrations.

**How to apply:** Compare normalized identities and definitions, classify objects by canonical ownership, and require owner review before changing functions, non-additive columns/types, constraints, indexes, or views. Keep PROD RLS hardening intact.

Before invoking a production accounting reversal path, verify the live journal-line column contract independently; a route can still contain legacy names such as `coa_id` while PROD stores the account reference under a different column.

**Why:** A reversal endpoint that is logically correct but targets stale column names can fail after partially progressing through a destructive workflow.

**How to apply:** Treat live catalog inspection as a prerequisite for financial mutation, and stop rather than bypassing ledger guards when the route/schema contract is not proven.