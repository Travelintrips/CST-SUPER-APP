---
name: Development synthetic marker cleanup
description: Safe cleanup boundary for audit fixtures whose notification leaves can outlive or outnumber their business parents.
---

Marker-bearing audit rows are not sufficient evidence to delete a current business parent: numeric IDs may be reused after an earlier fixture was removed. Build a fresh, exact marker manifest, inspect the live parent and FK graph, delete only proven synthetic leaves and parents in child-to-parent order, and fail closed on ambiguity.

**Why:** Old proof harnesses left notification and activity records after their main rows were cleaned up, while an old activity log referenced an ID that had since been reused by a legitimate RFQ.

**How to apply:** Restrict cleanup to development, classify each marker family and row shape, preserve legitimate parents even when stale audit rows point at their reused IDs, and verify all marker-bearing base-table rows are gone after commit.