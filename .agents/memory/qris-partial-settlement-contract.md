---
name: QRIS partial settlement contract
description: Partial QRIS approval settles only explicitly selected payments while the bank mutation remains pending.
---

Partial QRIS approval is an accounting settlement action, not bank reconciliation approval. The canonical batch may contain only the reviewer-selected payment IDs; unselected payments remain unsettled and the bank mutation must stay pending until a later complete approval path reconciles the full amount.

**Why:** A canonical reconciliation link validates the entire bank mutation amount. Linking a subset would mark an under-allocated mutation reconciled and break bank-to-ledger completeness.

**How to apply:** Preserve the candidate as partial/review, ignore already-posted subset evidence during candidate freshness checks, and only run canonical bank-mutation matching/reconciliation when the full remaining amount is explicitly complete.