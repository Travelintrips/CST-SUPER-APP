---
name: Server-side search before pagination
description: Listing pages must send search terms to the API so filtering covers all rows, not only the currently loaded page.
---

Searchable paginated lists must apply the search predicate in the database query and in the count query before LIMIT/OFFSET; client-side filtering of the current page is only a visual safeguard.

**Why:** Filtering only the loaded page makes results appear biased toward the current sort order and produces incorrect totals, especially when the first page is dominated by one status.

**How to apply:** Include the search value in the frontend query key and request parameters, then apply the same predicate to the primary data query and its count/fallback queries.