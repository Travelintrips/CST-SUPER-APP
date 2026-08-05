---
name: Advance Module Service Layer
description: Architecture and gotchas for the Advance Management module after Design Stabilization Sprint
---

## Key files
- `artifacts/api-server/src/lib/advance/AdvanceErrors.ts` — typed errors + sendAdvanceError()
- `artifacts/api-server/src/lib/advance/AdvanceStateMachine.ts` — transition graph, guard functions
- `artifacts/api-server/src/lib/advance/AdvanceJournalService.ts` — all journal postings
- `artifacts/api-server/src/routes/advances.ts` — PRIMARY engine; cashAdvances.ts is deprecated

## Critical invariants
1. `auditFromReq()` returns `void` — never `await` it, never chain `.catch()` on it. It is synchronous fire-and-forget.
2. All journal postings for Advance go through `AdvanceJournalService` — no direct `postEntry()` in routes.
3. Void without journal posted → `lifecycle_status = 'void'`. Void with reversal entry → `lifecycle_status = 'reversed'`.
4. Disbursement requires `approved` status — `pending_approval` must not disburse (approval bypass).
5. `rejected` is NOT `void` — STATUS_MAP was wrong (rejected→void) and has been fixed to (rejected→rejected).

**Why:** Routes had two runtime-breaking bugs (wrong assertCanVoidTransaction interface, wrong createReversalJournal signature) and a semantic bug (rejected status was recorded as void). Service layer created to prevent re-introduction of these patterns.

**How to apply:** Any new advance endpoint must use the guard functions from AdvanceStateMachine before persisting status, and AdvanceJournalService for any GL posting.
