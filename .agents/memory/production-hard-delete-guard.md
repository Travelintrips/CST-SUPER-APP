---
name: Production hard-delete guard
description: Safe boundary for explicitly approved deletion of posted bank-reconciliation data in production
---

Hard deletion of posted bank-reconciliation data must cover both the accounting journal/line guard and the immutable fleet-ledger mirror; disable only those delete guards inside one locked transaction and restore them before commit while keeping foreign keys active.

**Why:** The posted-journal workflow is intentionally reversal-first, and the fleet mirror has an independent immutable guard. Deleting only the primary journal guard either fails or leaves derived ledger rows behind.

**How to apply:** Re-identify the exact auto-post targets at execution time, fail closed on count or reference changes, remove derived mirror rows and source rows atomically, and verify every targeted surface plus trigger state after commit.