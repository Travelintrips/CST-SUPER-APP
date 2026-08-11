---
name: Canonical approval bridge
description: The required public-to-Sport-Center bank mutation bridge for canonical settlement link approval.
---

Canonical settlement approval must resolve the public bank mutation to exactly one `sport_center.bank_mutations` row by the exact `mutation_key` before changing settlement or reconciliation state.

**Why:** The link-only approval transaction revalidates the canonical mutation, settlement, journal, and payment evidence. A numeric ID or amount fallback would risk linking a public bank row to the wrong Sport Center event.

**How to apply:** If the exact mutation-key bridge is absent or non-unique, stop without approval, generic posting, cleanup, or guessed backfill. Report the bridge failure and preserve all existing business evidence.