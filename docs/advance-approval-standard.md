# Advance Approval Standard

---

## Approval Flow

```
┌──────────────┐    submit     ┌────────────────────┐
│    draft     │──────────────►│  pending_approval  │
└──────────────┘               └──────────┬─────────┘
                                          │
                     ┌────────────────────┤
                     │                    │
                     ▼                    ▼
              ┌──────────┐         ┌──────────────┐
              │ approved │         │   rejected   │
              └──────────┘         └──────────────┘
                                   (terminal)
```

---

## Endpoints

| Action | Method | URL | Allowed from |
|---|---|---|---|
| Submit for approval | `POST` | `/api/advances` | (initial create) |
| Approve | `PATCH` | `/api/advances/:id/approve` | `pending_approval`, `draft` |
| Reject | `PATCH` | `/api/advances/:id/reject` | `pending_approval`, `draft` |

---

## Approval Rules

1. **Only `pending_approval` and `draft` can be approved or rejected.** Any other status returns `400 INVALID_TRANSITION`.

2. **Rejection sets `lifecycle_status = 'rejected'`**, not `'void'`. These are distinct states.
   - `rejected` = the approver said No.
   - `void` = the accounting entry was cancelled.

3. **Approval sets `lifecycle_status = 'approved'`** and `status = 'active'` (for backward compat).

4. **Auto-approve** (`auto_approve: true` in create body): sets initial status to `approved` or `disbursed` directly — skips the approval queue. Only available for trusted admin-level operations.

5. **Disbursement requires `approved`** — if auto_approve is not set, the advance must pass through the approval endpoint before disburse is allowed. `pending_approval` → disburse is blocked.

---

## expenseApprovals.ts Integration

The `routes/expenseApprovals.ts` file handles the approval queue for kasbon/talangan via the `activateCashAdvance` callback. This is the legacy approval channel.

**Do not add new approval logic there.** New approval flows use `PATCH /api/advances/:id/approve` directly.

---

## Audit Trail

Every approval and rejection records an audit entry:
```json
{
  "action": "advance_approved" | "advance_rejected",
  "module": "advance_management",
  "newData": { "id": 123 }
}
```

---

## Rejection Reason

`rejection_reason` (text) is stored in `cash_advances` when rejecting. It is required to be passed by the frontend but the backend treats it as optional (nullable).
