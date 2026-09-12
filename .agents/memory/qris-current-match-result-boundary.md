---
name: QRIS current match-result boundary
description: Source-aware filtering for reconciliation results and historical suggestions.
---

Current reconciliation results must treat `qris_settlement` rows as visible only when their candidate source is the canonical Sport Center settlement source. Legacy or NULL-source QRIS rows remain audit history and must not seed current status, candidate details, or historical recommendations, even if cleanup/replay recreates them with an active match status.

**Why:** Retired QRIS match rows can be recreated after production cleanup; status-only filters then make old settlement references reappear for unmatched bank mutations.

**How to apply:** Keep the source boundary aligned across the mutation candidate projection, effective mutation status/approval guards, and approved-history queries. Do not broaden visibility back to legacy or source-less QRIS rows without a source-specific replacement contract.

Current QRIS evidence also needs independent allow-lists for provisional snapshot status (`candidate_auto_matched`, `candidate_review`), legacy match status (`candidate`, `approved`), and live settlement status. Rejected, blocked, superseded, reversed, and voided rows are history even when their IDs still appear in a current mutation projection.

**Why:** The production reproduction had an exact matched snapshot with status `rejected` and failed auto-post metadata; status-only or blacklist filters allowed stale nominal errors to survive after the canonical source was reversed.

**How to apply:** Apply the allow-lists in generation, listing, diagnostic projection, generic match-result queries, and approval lookup. Regeneration may use the mutation only as a reference, but must rebuild from confirmed active QRIS payments and exact gross-minus-MDR equality without changing source amounts.