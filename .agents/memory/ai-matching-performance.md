---
name: AI matching performance boundary
description: Bank reconciliation matching must use bounded concurrency and avoid serial candidate-query/persistence round trips.
---

Bank reconciliation matching should keep a bounded worker pool for mutations, run independent candidate sources in parallel, and persist candidate scores in batches.

**Why:** The endpoint processes many mutations and each mutation touches several independent sources; unbounded parallelism can exhaust the database pool, while serial queries make the UI appear stuck.

**How to apply:** Preserve the bounded-concurrency pattern when adding candidate sources or matching stages, and measure any new per-mutation database or external call before making it part of the synchronous request.

Sheet sync latency can be dominated by Google Sheets write-back, row coloring, and summary refresh even when no new mutations exist; the sync path should compare desired values with the sheet and skip no-op external writes.

**Why:** A 21–46 row no-op sync was spending seconds rewriting and formatting every row, while the matching loop had no new mutations and therefore was not the bottleneck.

**How to apply:** Keep status write-back for actual approval/matching changes, but only update changed rows and refresh the revenue summary when import or status data changed.