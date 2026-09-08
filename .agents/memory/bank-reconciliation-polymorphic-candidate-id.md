---
name: Bank reconciliation polymorphic candidate IDs
description: Live reconciliation matches store polymorphic candidate identities as text while source primary keys remain integer/bigint.
---

The live reconciliation schema stores `bank_reconciliation_matches.candidate_id` as text because one match table represents multiple candidate types. Source tables still use integer or bigint IDs, so every identity join in read queries must normalize the candidate text safely before comparing it.

**Why:** Direct `integer = text` comparisons can make the entire bank-mutation list return HTTP 500, including rows unrelated to the malformed or legacy candidate.

**How to apply:** Use a guarded numeric conversion for candidate IDs so non-numeric historical identities become non-matches rather than query errors. Keep source-specific candidate type/source predicates alongside the conversion.