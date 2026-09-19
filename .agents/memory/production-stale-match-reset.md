---
name: Production stale-match reset
description: Safe production boundary for returning stale bank mutations to unmatched.
---

A production bank mutation may be reset from `matched` to `unmatched` only when it has no journal entry and no active reconciliation candidate or approved match. The repair must lock the rows, assert the expected set/count before updating, clear legacy ownership fields, and write an append-only audit record.

**Why:** A raw matched status can outlive deleted or superseded candidate evidence, but changing a row with a journal or active ownership would alter accounting meaning and can create double-posting risk.

**How to apply:** Audit current PROD state first, pin the exact IDs or an invariant-guarded set, run one transaction, then verify status, candidate absence, and audit count after commit.