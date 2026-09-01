---
name: Bank reconciliation list schema gate
description: The mutation list and summary must initialize the same QRIS schema before querying.
---

The bank reconciliation mutation list must run the QRIS settlement migration before building its UNION/candidate subqueries, just like the summary endpoint.

**Why:** The summary can show real counts while the list returns 500 when a production database is behind on QRIS tables; the old UI hid that 500 as “0 mutasi.”

**How to apply:** Keep the list schema gate idempotent and surface query errors in the UI instead of treating missing data as an empty result.