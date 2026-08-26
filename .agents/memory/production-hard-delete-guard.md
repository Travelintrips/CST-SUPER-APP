---
name: Production hard-delete guard
description: Safe boundary for explicitly approved deletion of posted bank-reconciliation data in production
---

Hard deletion of posted bank-reconciliation data must cover both the accounting journal/line guard and the immutable fleet-ledger mirror; disable only those delete guards inside one locked transaction and restore them before commit while keeping foreign keys active. Auto-post discovery must combine audit evidence with journal-line markers and source provenance because historical auto-posts may have incomplete audit rows.

**Why:** The posted-journal workflow is intentionally reversal-first, and the fleet mirror has an independent immutable guard. Deleting only the primary journal guard either fails or leaves derived ledger rows behind; relying only on `MATCH_APPROVED_AUTO_POSTED` misses older auto-post journals whose source mutation or audit history is gone.

**How to apply:** Re-identify exact targets at execution time from source, line-description and audit evidence, fail closed on count or reference changes, remove derived mirror rows and source rows atomically, and verify every targeted surface plus trigger state after commit.