---
name: Accounting draft idempotency
description: Safe recovery boundary when an idempotent accounting post finds an existing draft journal.
---

An automatic posting retry may promote an existing draft only when the caller explicitly requests a posted system entry and the draft is balanced; manual/governance drafts must remain in their approval flow. Historical recovery must lock the source invoice and exact linked journal in one transaction, verify the source identity and balanced lines, set the journal's posted timestamp, and never search for or promote an unrelated orphan.

**Why:** Returning an existing draft as a successful idempotent post can mark the source document posted while the ledger remains excluded from reports that read only posted entries.

**How to apply:** Validate the exact source, source ID, company, and balanced lines before promotion. For historical records, expose an authenticated, transaction-locked recovery path rather than mutating production directly; report missing, mismatched, or unbalanced journals for Finance review.