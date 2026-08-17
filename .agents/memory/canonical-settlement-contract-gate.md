---
name: Canonical settlement contract gate
description: Boundary and readiness rule for adapting Sport Center canonical settlement into bank reconciliation.
---

Canonical Sport Center settlement may reuse the existing `qris_settlement` candidate type only when persisted source identity distinguishes `sport_center` canonical batches from legacy public QRIS rows. Numeric candidate IDs alone are unsafe because the two sources can collide. The frozen owner policy is `bank_mutation.status=approved` on canonical link approval and `approved -> unmatched` on canonical void/reopen; this is a reconciliation-link state, not journal posting.

**Why:** The reconciliation code has a generic `qris_settlement` path backed by `public.qris_settlements`, while the target canonical contract is in `sport_center.*`. Routing canonical rows through the generic approval path can create a second journal instead of linking the already-posted settlement journal. The bank-mutation enum has no discoverable canonical transition, so the owner-approved policy must be treated as the source of truth.

**How to apply:** Keep legacy `public.qris_*` flows functional, add a source-aware read adapter, use `net_amount` as the canonical matching amount, bypass generic journal creation for canonical approval, use `approved`/`unmatched` only in the canonical link lifecycle, and preserve NULL historical sources without guessed backfill.

Runtime verification must treat the live Supabase catalog as authoritative: passing unit tests and a present settlement table/view do not prove readiness when the six owner SQL routines are absent or the startup migration chain has not reached `/api/health/ready=true`.

**Why:** The application can compile and its pure contract suite can pass while canonical builder/approval calls still fail against a runtime schema that has not installed the database-owned settlement routines.

**How to apply:** Run the approved DEV and PROD catalog preflight through `load-secrets.mjs` before claiming end-to-end parity; classify missing routines, unresolved source/status ownership, and readiness timeout as publish blockers rather than silently applying a DEV→PROD sync.

When diagnosing an apparent duplicate or missing bank link, inspect canonical settlement items by payment ID as well as batch `bank_mutation_id` and net amount; a posted batch can be unlinked and have the wrong net, so the bank mutation lookup alone misses the stale settlement.