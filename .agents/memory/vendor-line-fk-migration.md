---
name: Vendor line FK migration
description: Compatibility rule for adding child tables to legacy vendor invoice line data.
---

Before adding a foreign key to a legacy line-table identifier, verify the live database has a primary key or unique constraint for that identifier; source ORM declarations alone are not proof.

**Why:** A historical schema import can preserve the column but lose its uniqueness constraint, causing PostgreSQL to reject an otherwise valid child-table FK.

**How to apply:** Add the smallest safe, idempotent uniqueness repair first, then create the child table and FK. Let duplicate data fail explicitly rather than silently de-duplicating financial rows.