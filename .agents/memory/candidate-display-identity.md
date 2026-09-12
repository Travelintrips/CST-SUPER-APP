---
name: Candidate display identity
description: Reconciliation candidates can have multiple technical rows for one user-facing payment.
---

Candidate uniqueness for reviewers must include the user-facing payment/document reference, not only `(candidate_type, candidate_id, candidate_source)`. Legacy accounting mirrors and invoice/tenant-invoice mirrors can otherwise appear as duplicate choices.

**Why:** Source-aware persistence intentionally preserves distinct technical identities and historical evidence, but reviewers choose an economic transaction, not a database row.

**How to apply:** Keep technical identity for audit and approval routing, then collapse known business-reference aliases at matching output and UI display; prefer the canonical Sport Center payment over its accounting mirror.