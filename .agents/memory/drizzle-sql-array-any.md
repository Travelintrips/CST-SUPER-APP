---
name: Drizzle sql template array ANY syntax
description: Passing a JS array to sql`= ANY(${arr})` generates a tuple ($1,$2,…) not a PostgreSQL ARRAY, causing "op ANY/ALL (array) requires array on right side".
---

## Rule
In Drizzle ORM raw `sql` template literals:
- `sql\`= ANY(${jsArray})\`` → PostgreSQL receives `= ANY(($1,$2,…))` — a **row constructor**, not an array → ERROR.
- For static (hardcoded, no user input) IN-lists, use: `sql\`IN (${sql.raw(arr.map(s => \`'${s}'\`).join(', '))})\``
- For dynamic user-supplied values, use Drizzle's `inArray(col, values)` helper instead.

**Why:** Drizzle serializes JS arrays as comma-separated parameter bindings wrapped in parens, which PostgreSQL interprets as a row literal, not an array literal. `ANY()` requires an actual array type.

**How to apply:** In `repairOrphanedEntryLines` and any other migration that filters by a static list of string enum values, always use `sql.raw` for the IN-list or use Drizzle's `inArray` helper. Never pass a plain JS array to `sql\`= ANY(...)\``.
