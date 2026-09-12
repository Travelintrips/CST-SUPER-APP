---
name: Canonical bridge live installation
description: The checked-in bridge source can be newer than the DEV catalog when startup markers skip the additive stage.
---

The canonical bridge contract must be verified from `pg_get_functiondef` in the
development database before CF-SC runtime proofs. If the live function lacks
the exact settlement scope carried by `public.bank_mutations.source_account`,
run the DEV-only canonical contract restoration runner before re-running the
harness.

**Why:** Startup registry completion is not proof that a later additive
function definition was installed; stale bridge logic can make same-day DP and
pelunasan settlements appear ambiguous.

**How to apply:** Compare the live definition with the checked-in source, use
the guarded development restoration command when needed, restart the DEV API,
then rerun the rollback-only CF-SC harness.