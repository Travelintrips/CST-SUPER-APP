---
name: Generic post approved-match guard
description: Generic bank posting must distinguish approved matches from stale candidate evidence.
---

The generic bank-post guard must count only `approved` reconciliation matches when deciding whether a mutation has multiple approved identities; a remaining `candidate` row is review evidence, not a second approval. Any mutation with an approved match must also stay out of the QRIS approval queue, even if `bank_mutations.status` is still `matched`.

**Why:** Counting both `candidate` and `approved` caused valid approved transfers to be blocked as ambiguous when an older candidate remained.

**How to apply:** Keep the fail-closed check for more than one approved match, apply source-aware rules to the single approved match, and use an `approved` match existence check when building ready-to-approve lists and summary counts.