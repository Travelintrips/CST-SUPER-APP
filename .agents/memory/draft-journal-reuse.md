---
name: Draft journal reuse policy
description: JournalReuseEngine policy for draft-status accounting entries during bank reconciliation
---

## Rules

### Rule 1 — JournalReuseEngine: allow reuse of unlinked drafts
An accounting entry in `draft` status that is NOT linked to any bank mutation
(`reconciled_mutation_id IS NULL`) AND whose `total_debit` matches the mutation
amount (within 0.01% or Rp 1) should be treated as a PROVISIONAL entry and
returned as `REUSE_EXISTING_JOURNAL`, not `MANUAL_REVIEW_REQUIRED`.

### Rule 2 — UnifiedMatchingEngine: promote draft → posted on reuse
When `REUSE_EXISTING_JOURNAL` is returned and the entry is in `draft` status,
`approveAndCreateJournal` MUST also run:
```sql
UPDATE accounting_entries SET status = 'posted', updated_at = NOW()
WHERE id = <reusedEntry.id> AND status = 'draft'
```
Without this the bank mutation shows "Sudah Diposting" but the accounting entry
stays draft, making it invisible to Trial Balance (which filters `status = 'posted'`).

### Rule 3 — Auto-post recovery must adopt only an exact journal
If an auto-post request encounters an already-created journal for the same bank
mutation, it may recover that journal only when there is exactly one unclaimed
entry in the same company, its debit total matches the mutation, and it is
neither voided nor reversed. A draft can then be promoted to posted; ambiguous,
cross-mutation, or amount-mismatched entries stay in manual review.

## Why
The sport center module (and similar upstream modules) creates draft journal
entries when a payment is recorded. These drafts are PROVISIONAL — they exist
before bank confirmation. Bank reconciliation approval IS the bank confirmation.
The old blanket policy ("any draft → MANUAL_REVIEW_REQUIRED") blocked valid
approvals and triggered the "Buat Proposal COA" banner, which was completely
wrong because the COA was already known via the candidate match.

## How to apply
- File: `artifacts/api-server/src/lib/reconciliation/journalReuseEngine.ts`
- The draft-specific block (before the generic DRAFT_STATUSES block) handles:
  1. Draft + unlinked + amount OK → REUSE_EXISTING_JOURNAL (confidence 75)
  2. Draft + already claimed by another mutation → MANUAL_REVIEW_REQUIRED (high risk)
  3. Draft + amount mismatch → MANUAL_REVIEW_REQUIRED (different event)
- `pending_approval` / `approved_pending_posting` still → MANUAL_REVIEW_REQUIRED (under governance)
- `JOURNAL_REUSE_DUPLICATE_MUTATION` was added to `JournalReuseErrorCode` enum for case 2.
- A legacy auto-post duplicate-journal review is rematchable only when its
  recorded reason identifies this exact interrupted-post condition.

## Test cases
- Test 7: draft + unlinked + amount matches → REUSE_EXISTING_JOURNAL
- Test 7d: draft + claimed by mut 999 → MANUAL_REVIEW_REQUIRED
- Test 7e: draft + amount mismatch (50k vs 30k) → MANUAL_REVIEW_REQUIRED
