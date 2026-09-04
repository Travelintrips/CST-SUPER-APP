---
name: QRIS current match-result boundary
description: Source-aware filtering for reconciliation results and historical suggestions.
---

Current reconciliation results must treat `qris_settlement` rows as visible only when their candidate source is the canonical Sport Center settlement source. Legacy or NULL-source QRIS rows remain audit history and must not seed current status, candidate details, or historical recommendations, even if cleanup/replay recreates them with an active match status.

**Why:** Retired QRIS match rows can be recreated after production cleanup; status-only filters then make old settlement references reappear for unmatched bank mutations.

**How to apply:** Keep the source boundary aligned across the mutation candidate projection, effective mutation status/approval guards, and approved-history queries. Do not broaden visibility back to legacy or source-less QRIS rows without a source-specific replacement contract.