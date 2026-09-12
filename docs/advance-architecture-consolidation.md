# Advance Management — Architecture Consolidation

**Sprint:** Design Stabilization  
**Date:** 2026-07-06  
**Status:** Completed

---

## 1. Problem Statement

Before this sprint, the Advance Management module had two parallel engines operating on the same database table (`cash_advances`):

| Engine | File | Scope |
|---|---|---|
| **Legacy** | `routes/cashAdvances.ts` (1 139 lines) | Kasbon + Talangan only; inline business logic; ad-hoc accounting |
| **Unified** | `routes/advances.ts` (863 → 996 lines) | All advance types; had critical bugs in void/reversal paths |

Both engines wrote to `cash_advances`. This created:
- Dual status vocabularies (`active`, `partial` vs `outstanding`, `partially_settled`)
- Duplicate journal posting code (4 functions in `journalMappingService.ts` + inline in routes)
- Inconsistent error responses (`error:` key vs `message:` key)
- No formal state machine — transitions were ad-hoc string comparisons
- Two broken function calls in `advances.ts` void path that would crash at runtime

---

## 2. Consolidation Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  BizPortal / API Clients                                             │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ HTTP
          ┌────────────▼──────────────┐
          │  routes/advances.ts       │  ◄ PRIMARY (all new work here)
          │  (Unified Engine)         │
          └────────────┬──────────────┘
                       │
         ┌─────────────┼─────────────────────────────┐
         │             │                             │
         ▼             ▼                             ▼
  AdvanceStateMachine  AdvanceJournalService    AdvanceErrors
  (status transitions) (journal posting)        (typed errors)
         │             │
         ▼             ▼
  accountingPostingGuard.ts   postEntry()
  (void/reversal guard)       (GL posting)
         │
         ▼
  cash_advances table  ←  shared with legacy
  advance_settlements
  advance_allocation_lines

┌─────────────────────────────────────────────────────────────────────┐
│  routes/cashAdvances.ts  ◄ DEPRECATED — READ-ONLY legacy support   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. New Service Layer

### `lib/advance/AdvanceErrors.ts`
Typed error classes. All advance routes use `sendAdvanceError(res, err)` for consistent `{ message, code }` responses.

| Class | HTTP | Code |
|---|---|---|
| `AdvanceNotFoundError` | 404 | `ADVANCE_NOT_FOUND` |
| `InvalidTransitionError` | 400 | `INVALID_TRANSITION` |
| `JournalPostingError` | 400 | `JOURNAL_POSTING_FAILED` |
| `MoneyMovedError` | 400 | `MONEY_MOVED` |
| `AlreadyVoidedError` | 400 | `ALREADY_VOIDED` |
| `AccountingConfigError` | 400 | `ACCOUNTING_CONFIG_MISSING` |
| `DuplicateJournalError` | 400 | `DUPLICATE_JOURNAL` |

### `lib/advance/AdvanceStateMachine.ts`
Canonical transition graph. All status changes validated via `canTransition()` / `assertTransition()`.

### `lib/advance/AdvanceJournalService.ts`
Single journal posting service. Replaces all inline `postEntry()` calls in routes and the 4 functions in `journalMappingService.ts`.

---

## 4. Critical Bugs Fixed

| Location | Bug | Fix |
|---|---|---|
| `advances.ts` void route | `assertCanVoidTransaction({ req, res, entryId, companyId })` — wrong interface | Use `TransactionJournalState` shape: `{ entryId, entryStatus, moneyMoved }` |
| `advances.ts` void route | `createReversalJournal(adv.entry_id, {...})` — wrong signature | Route calls `AdvanceJournalService.postVoidReversal()` which uses correct `CreateReversalJournalInput` |
| `advances.ts` STATUS_MAP | `rejected: "void"` — rejection falsely mapped to void | Fixed to `rejected: "rejected"` |
| `advances.ts` reject route | `lifecycle_status = 'void'` on rejection | Fixed to `lifecycle_status = 'rejected'` |
| `advances.ts` disburse route | `pending_approval` and `draft` allowed to disburse | Only `approved` allowed — prevents approval bypass |
| `advances.ts` LIFECYCLE_STATUSES | Missing `rejected`, `cancelled`, `reversed` | Added all three |
| All catch blocks | `{ error: err?.message }` (inconsistent key) | Replaced with `sendAdvanceError(res, err)` → `{ message, code }` |

---

## 5. Migration Path

`cashAdvances.ts` is deprecated. Migration proceeds in two phases:

**Phase 1 (current):** Legacy endpoints remain active but are marked `@deprecated`. No new features on legacy routes.

**Phase 2 (future):** After BizPortal frontend is migrated to `/api/advances/*`, legacy routes are removed.

---

## 6. Invariants (must not be broken by future changes)

1. **All advance journal postings** go through `AdvanceJournalService` — never `postEntry()` directly from a route.
2. **All status transitions** go through `canTransition()` / `assertTransition()` — never raw string comparisons.
3. **Error responses** always use `{ message: string, code?: string }` — never `{ error: string }`.
4. **Void requires money-not-moved.** Reversal is for money-already-moved.
5. **Disbursement requires `approved` status** — `pending_approval` and `draft` are not allowed.
