---
name: Drizzle sql`` template null params need type casts
description: Bare null bound into a drizzle sql template literal throws "could not determine data type of parameter $N"
---

When binding a value that can be `null` into a `db.execute(sql\`...\`)` template in
Postgres, an untyped `NULL` comparison like `(... AND ${maybeNull} IS NULL)` fails
at runtime with `could not determine data type of parameter $N`.

**Why:** Postgres needs a type for every bound parameter. A standalone `$N IS NULL`
gives the planner no way to infer the type, so the prepared statement is rejected.

**How to apply:** Cast the param to the column's type, e.g. `${rackId}::int`, or build
the predicate conditionally in JS (`rackId == null ? sql\`col IS NULL\` : sql\`col = ${rackId}\``).
Seen in inventoryStock postStockIn/postStockOut rack_id matching.
