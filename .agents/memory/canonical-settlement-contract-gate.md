---
name: Canonical settlement contract gate
description: Boundary and readiness rule for adapting Sport Center canonical settlement into bank reconciliation.
---

Canonical Sport Center settlement may reuse the existing `qris_settlement` candidate type only when persisted source identity distinguishes `sport_center` canonical batches from legacy public QRIS rows. Numeric candidate IDs alone are unsafe because the two sources can collide.

**Why:** The reconciliation code has a generic `qris_settlement` path backed by `public.qris_settlements`, while the target canonical contract is in `sport_center.*`. Routing canonical rows through the generic approval path can create a second journal instead of linking the already-posted settlement journal.

**How to apply:** Keep legacy `public.qris_*` flows functional, add a source-aware read adapter, use `net_amount` as the canonical matching amount, bypass generic journal creation for canonical approval, and do not begin implementation until canonical table/view/RPC columns, journal relation, constraints, and bank-mutation status mapping are verified.