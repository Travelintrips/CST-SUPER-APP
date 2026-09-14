---
name: Rule AI rerun after rule change
description: Existing unmatched Sheet mutations need an explicit non-final rematch after a rule is created or corrected.
---

When Sheet sync has already recorded `MATCH_CREATED` with zero candidates, creating or editing a Rule AI later does not re-evaluate that mutation through the default incremental matching mode. The rule must be direction/company compatible, then the non-final rematch path must run.

**Why:** Incremental matching intentionally skips mutations with an existing `MATCH_CREATED` audit, so a rule added after the sync can appear active while the old mutation remains unmatched.

**How to apply:** Use the non-final/retry-unmatched matching path after rule changes. Do not change an incoming bank mutation to an expense rule merely to force a match; verify Debit/Keluar versus Credit/Masuk semantics first.