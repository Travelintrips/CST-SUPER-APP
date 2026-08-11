---
name: AI matching performance boundary
description: Bank reconciliation matching must use bounded concurrency and avoid serial candidate-query/persistence round trips.
---

Bank reconciliation matching should keep a bounded worker pool for mutations, run independent candidate sources in parallel, and persist candidate scores in batches.

**Why:** The endpoint processes many mutations and each mutation touches several independent sources; unbounded parallelism can exhaust the database pool, while serial queries make the UI appear stuck.

**How to apply:** Preserve the bounded-concurrency pattern when adding candidate sources or matching stages, and measure any new per-mutation database or external call before making it part of the synchronous request.