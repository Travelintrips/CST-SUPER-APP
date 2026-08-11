---
name: Canonical settlement contract gate
description: Boundary and readiness rule for adapting Sport Center canonical settlement into bank reconciliation.
---

Canonical Sport Center settlement may reuse the existing `qris_settlement` candidate type only when persisted source identity distinguishes `sport_center` canonical batches from legacy public QRIS rows. Numeric candidate IDs alone are unsafe because the two sources can collide. The frozen owner policy is `bank_mutation.status=approved` on canonical link approval and `approved -> unmatched` on canonical void/reopen; this is a reconciliation-link state, not journal posting.

**Why:** The reconciliation code has a generic `qris_settlement` path backed by `public.qris_settlements`, while the target canonical contract is in `sport_center.*`. Routing canonical rows through the generic approval path can create a second journal instead of linking the already-posted settlement journal. The bank-mutation enum has no discoverable canonical transition, so the owner-approved policy must be treated as the source of truth.

**How to apply:** Keep legacy `public.qris_*` flows functional, add a source-aware read adapter, use `net_amount` as the canonical matching amount, bypass generic journal creation for canonical approval, use `approved`/`unmatched` only in the canonical link lifecycle, and preserve NULL historical sources without guessed backfill.