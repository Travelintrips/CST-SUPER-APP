# Advance State Machine

**Source of Truth:** `artifacts/api-server/src/lib/advance/AdvanceStateMachine.ts`

---

## Status Definitions

| Status | Meaning | Money Moved? |
|---|---|---|
| `draft` | Created but not yet submitted | No |
| `pending_approval` | Submitted, awaiting approval | No |
| `approved` | Approved, ready to disburse | No |
| `rejected` | Approval rejected (terminal) | No |
| `disbursed` | Journal posted, funds being transferred | Yes (committed) |
| `outstanding` | Fully disbursed, awaiting settlement | Yes |
| `partially_settled` | Partially repaid/settled | Yes |
| `settled` | Fully repaid or expense-justified | Yes (returned) |
| `closed` | Accounting closed out | Yes |
| `void` | Cancelled before money moved; journal reversed | No |
| `reversed` | Counter-entry posted after disbursement (terminal) | Zeroed |
| `cancelled` | Cancelled before any activity (terminal) | No |

---

## Transition Graph

```
                  ┌─────────────────┐
                  │      draft      │──── cancelled ──► (terminal)
                  └────────┬────────┘
                           │ submit
                           ▼
               ┌───────────────────────┐
               │   pending_approval    │──── rejected ──► (terminal)
               └────────────┬──────────┘
                            │ approve
                            ▼
               ┌───────────────────────┐
               │       approved        │──── void ──► void ──► reversed (terminal)
               └────────────┬──────────┘
                            │ disburse + post journal
                            ▼
               ┌───────────────────────┐
               │       disbursed       │
               └────────────┬──────────┘
                            │ confirm outstanding
                            ▼
               ┌───────────────────────┐
               │      outstanding      │◄──────────────────────┐
               └────────────┬──────────┘                        │
                            │ partial repayment/settlement       │
                            ▼                                    │
               ┌───────────────────────┐                        │
               │  partially_settled    │────────────────────────┘
               └────────────┬──────────┘
                            │ full repayment/settlement
                            ▼
               ┌───────────────────────┐
               │        settled        │
               └────────────┬──────────┘
                            │ accounting close
                            ▼
               ┌───────────────────────┐
               │        closed         │  (terminal)
               └───────────────────────┘
```

**VOID path** (no money moved):
```
draft / pending_approval / approved ──► void ──► reversed
```
The `reversed` terminal means a counter-entry exists in the GL.

---

## Guard Functions

```typescript
canVoid(status, moneyMoved): boolean
// Only draft/pending_approval/approved, AND moneyMoved=false

canReverse(status): boolean
// Only disbursed/outstanding/partially_settled (money already out)

canRepay(status): boolean
// disbursed/outstanding/partially_settled

canSettle(status): boolean
// disbursed/outstanding/partially_settled

canDelete(status, entryId): boolean
// Only if entryId=null AND status in [draft/pending_approval/rejected/cancelled]

deriveStatusAfterPayment(remaining): LifecycleStatus
// remaining ≤ 0.005 → "settled"; else "partially_settled"
```

---

## Status Mapping (legacy ↔ unified)

| Legacy `status` | Unified `lifecycle_status` |
|---|---|
| `active` | `outstanding` |
| `partial` | `partially_settled` |
| `repaid` | `settled` |
| `accounted` | `settled` |
| `void` | `void` |
| `pending_approval` | `pending_approval` |
| `rejected` | `rejected` ← FIX (was mapped to `void`) |
| `approved` | `approved` |
| `disbursed` | `disbursed` |

---

## Key Rules

1. **Disbursement requires `approved`** — not `pending_approval` or `draft`.
2. **Void ≠ Reversal.** Void: no money moved. Reversal: money was out, counter-entry created.
3. **Terminal statuses** (`rejected`, `cancelled`, `closed`, `reversed`) have no outbound transitions.
4. **`rejected` is NOT `void`.** Rejected = approval decision. Void = accounting cancellation.
