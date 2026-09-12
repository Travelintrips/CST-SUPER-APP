---
name: Phase 4C-7A.7H runtime proof
description: Final development-only proof boundary for canonical settlement status ownership and grouping.
---

The final status/grouping contract is proven only when the checked-in source markers and live PostgreSQL definitions agree, the owner changes only active items belonging to the posted settlement, and all behavioral writes run inside a transaction that is rolled back.

**Why:** Catalog existence alone can miss stale trigger/function definitions, while committed test fixtures could contaminate canonical settlement state or touch unrelated payments.

**How to apply:** Load the development secret bundle explicitly, apply only the canonical contract migration, read back function/index/trigger definitions, use existing posted data for the owner proof, use synthetic negative-ID rows for duplicate and reversed/voided lifecycle checks, and verify payment/settlement counts after rollback.