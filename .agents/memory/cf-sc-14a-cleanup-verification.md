---
name: CF-SC-14A cleanup verification
description: Literal fixture cleanup must cover both Sport Center source tables and public mirror tables.
---

CF-SC-14A harness cleanup can leave orphaned fixture rows in the public
`sport_bookings`/`sport_payments` mirror and journal rows after source rows are
removed. Verify the literal marker prefix (not an SQL `_` wildcard) across
both schemas, and delete only explicitly marked, unposted fixture rows.

**Why:** The source tables were empty while public mirror payments/bookings and
orphaned journal rows still remained; an unescaped `LIKE 'CFSC14A_%'` also
produced misleading counts.

**How to apply:** Use an escaped literal prefix or anchored regex, inspect
finance links before cleanup, remove child journal lines before marked journal
headers, then re-scan source, mirror, outbox, observer, settlement, mutation,
reconciliation, and accounting surfaces.