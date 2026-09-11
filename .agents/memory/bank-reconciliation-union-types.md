---
name: Bank reconciliation UNION type normalization
description: Cross-environment enum/text differences must be normalized explicitly in reconciliation UNION projections.
---

Every corresponding column in the bank-mutation and import branches of a `UNION` must be cast to the same portable type, especially journal and status fields that may be PostgreSQL enums in production but text in development.

**Why:** Production used an accounting status enum while the import branch returned text, causing the entire mutation list to fail even though Sheet synchronization succeeded.

**How to apply:** Cast enum-like read projections to text in every UNION branch and validate the endpoint against the live schema before treating a sync failure as a Google Sheets connection problem.