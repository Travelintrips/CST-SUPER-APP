---
name: COA proposal and bank reconciliation flow
description: Proposal COA approval, Task #5 implementation, and bank mutation approval are separate governed states.
---

COA Proposal `APPROVED` does not mean the source bank mutation is approved. Implementing a proposal creates a Task #5 COA change request that still needs its own checker approval; only then can the bank mutation be approved and posted.

**Why:** Treating these states as one action would bypass maker-checker governance and could create journals against an unapproved COA.

**How to apply:** Keep proposal actions and bank reconciliation actions separate in backend state transitions, but return the user to bank reconciliation with the source mutation highlighted after implementation.

When an approved proposal's proposed COA code already exists for the company, implementation links the proposal to that existing account instead of creating a duplicate Task #5 request; repeated implementation calls return the existing implemented result.

**Why:** A COA can be created between proposal generation and implementation, and treating that normal race as a 409 stranded users on the proposal detail page.

**How to apply:** Validate the existing account belongs to the company, record the link in the proposal version/audit trail, and keep the redirect to bank reconciliation idempotent.