---
name: Reconciliation table schema qualification
description: Avoid ambiguous reconciliation queries when production has same-named tables with different contracts.
---

Bank reconciliation lifecycle queries must explicitly target the source-aware table in the `public` schema and normalize compared legacy/enum fields to text where compatibility is required.

**Why:** Production contains `bank_reconciliation_matches` in both `public` and `sport_center`. Their column contracts differ, so an unqualified query can fail with type-operator errors or read the wrong lifecycle data if a session search path changes.

**How to apply:** For approval, reopen, reject, and void guards, qualify `public.bank_reconciliation_matches`. Do not rely on the role's current search path. Where production generations may use text, enum, or legacy scalar types, cast only the compared identity/status fields to text while preserving exact canonical source values.