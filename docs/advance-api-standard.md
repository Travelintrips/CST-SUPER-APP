# Advance API Standard

**Base URL:** `/api/advances`  
**Auth:** All endpoints require authentication. Admin-only actions require `requireAdmin`.

---

## Response Shape

All endpoints return JSON. Error responses always use:
```json
{ "message": "...", "code": "ADVANCE_NOT_FOUND | INVALID_TRANSITION | ..." }
```

Success responses use:
```json
{ "success": true, ... }
```

⚠️ **Never use `{ "error": "..." }`** — this was the old inconsistent format and has been removed.

---

## Endpoints

### List
```
GET /api/advances
  ?company_id=1
  &lifecycle_status=outstanding
  &advance_type=EMPLOYEE
  &q=search_term
  &page=1
  &limit=20
```

### Detail
```
GET /api/advances/:id
```
Returns advance + settlements array + repayments array.

### Create
```
POST /api/advances
Body: {
  advance_type: "EMPLOYEE" | "VENDOR" | "PROJECT" | "TRAVEL" | "OPERATIONAL" | "PURCHASE" | "CUSTOMER" | "OTHER",
  party_name: string,         // required
  amount: number,             // required, > 0
  date: string,               // required, ISO date
  purpose?: string,
  notes?: string,
  payment_method?: "bank" | "cash",
  receivable_account_id?: number,
  cash_bank_account_id?: number,
  counterparty_type?: string,
  vendor_id?: number,
  user_id?: number,
  project_id?: number,
  department_id?: number,
  division_id?: number,
  auto_approve?: boolean,     // admin only: skip approval queue
  auto_disburse?: boolean,    // admin only: post disbursement journal at creation
}
```
Returns 201 with the created advance object.

### Approve
```
PATCH /api/advances/:id/approve
```
Allowed from: `pending_approval`, `draft`.

### Reject
```
PATCH /api/advances/:id/reject
Body: { reason?: string }
```
Allowed from: `pending_approval`, `draft`.  
Sets `lifecycle_status = 'rejected'` (not `void`).

### Disburse
```
PATCH /api/advances/:id/disburse
Body: { date?: string }
```
**Requires** `lifecycle_status = 'approved'`.  
Posts disbursement journal. Sets status to `outstanding`.

### Repay
```
POST /api/advances/:id/repay
Body: {
  date: string,
  amount: number,             // partial or full
  source_account_id?: number, // bank/kas account receiving the money
  payment_method?: "bank" | "cash",
  notes?: string,
}
```
Allowed from: `disbursed`, `outstanding`, `partially_settled`.

### Settle (Allocation Engine)
```
POST /api/advances/:id/settle
Body: {
  date: string,
  bank_account_id?: number,
  amount_received: number,
  allocation_lines: Array<{
    allocation_type: "ADVANCE_PRINCIPAL" | "EXPENSE_JUSTIFICATION" | "INTEREST" | "PENALTY" | ...
    coa_id?: number,          // required for non-ADVANCE_PRINCIPAL types
    amount: number,
    remarks?: string,
  }>,
  reference?: string,
  notes?: string,
  currency?: string,
  exchange_rate?: number,
}
```
`SUM(allocation_lines.amount)` must equal `amount_received`.

### Void
```
POST /api/advances/:id/void
Body: { reason?: string }
```
Allowed when: `lifecycle_status` in `[draft, pending_approval, approved]` AND `paid_amount = 0`.  
If a journal was previously posted, creates a reversal entry.

### Delete
```
DELETE /api/advances/:id
```
Allowed only if: no journal posted (`entry_id = null`) AND `lifecycle_status` in `[draft, pending_approval, rejected, cancelled]`.

---

## Dashboard & Analytics
```
GET /api/advances/dashboard
GET /api/advances/aging
GET /api/advances/accounts
```

---

## Legacy API (deprecated)
```
/api/cash-advances/*   ← DEPRECATED — do not add features here
```
All new features use `/api/advances/*`.
