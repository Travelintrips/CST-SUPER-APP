---
name: Posted bank unmatch lifecycle
description: Safe lifecycle for returning a posted bank mutation to the unmatched queue
---

Unmatching a posted bank mutation must create a balanced reversal first, keep the original journal immutable, then reopen the mutation and release any approved reconciliation match back to candidate status.

**Why:** Directly clearing the bank link would leave the ledger and reconciliation ownership inconsistent, while an approved match left behind can still block later posting or matching.

**How to apply:** Use the guarded reverse/void flow for the posted journal, then reopen only after a successful reversal. Treat failure between those steps as a visible partial state requiring manual follow-up; never silently delete the original journal or approved match.

When reopening, clear both the reconciliation match row's approval and every legacy ownership field on `bank_mutations` (`matched_*`, `linked_transaction_*`, and `reconciliation_status`), otherwise old match metadata can survive after the status becomes unmatched.

For non-final review states, unmatch may return the mutation directly to `unmatched` without a reversal, but the same ownership cleanup and audit trail are required. Canonical settlement mutations remain on their dedicated lifecycle and must fail closed from generic unmatch.

**Why:** A review-state mutation has no posted ledger impact, while canonical settlement links can represent partial or link-only settlement ownership that a generic reset would corrupt.

**How to apply:** Keep the UI action available for ordinary review/match cards and QRIS cards only when the canonical guard rejects false generic ownership; route posted rows through reversal first.