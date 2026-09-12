---
name: CF-SC-14A fixture isolation
description: Sport Center shadow fixtures must avoid legacy and central finance identity collisions.
---

A missing `sport_center.sport_payments` row does not prove a numeric payment ID
is safe: legacy accounting, outbox, processing, settlement, mutation, and
reconciliation records can retain the same identity.

**Why:** A shared DEV sequence reused an ID owned by a pre-existing posted
legacy entry, correctly triggering `ACCOUNTING_IDEMPOTENCY_MISMATCH`. Historical
posted rows must remain immutable.

**How to apply:** Allocate with normal `nextval`, inspect runtime-discovered
identity surfaces before legacy posting, reject and roll back any referenced
candidate with a finite retry limit, and clean up only exact fixture-owned row
IDs rather than inferring ownership from payment IDs.