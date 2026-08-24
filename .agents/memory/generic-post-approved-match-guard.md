---
name: Generic post approved-match guard
description: Generic bank posting must distinguish approved matches from stale candidate evidence.
---

The generic bank-post guard must count only `approved` reconciliation matches when deciding whether a mutation has multiple approved identities; a remaining `candidate` row is review evidence, not a second approval.

**Why:** Counting both `candidate` and `approved` caused valid approved transfers to be blocked as ambiguous when an older candidate remained.

**How to apply:** Keep the fail-closed check for more than one approved match, then apply source-aware rules to the single approved match.