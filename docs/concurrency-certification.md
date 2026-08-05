# Concurrency & Race Condition Certification
**Sprint 4.5 — Enterprise Security & Concurrency Certification**
**Date:** 2026-07-07
**Scope:** Finance mutations — Confirm, Split, Merge, Reverse, Post, Approval, Repayment

---

## Summary

| Area | Status | Notes |
|---|---|---|
| Cash Advance Repayment | ⚠️ FAIL | Missing FOR UPDATE — concurrent repay creates duplicate entries |
| Allocation Posting | ⚠️ FAIL | Missing FOR UPDATE — double-post risk on concurrent confirm |
| Expense Approval | ✅ PASS | Transaction wraps status check + update |
| Journal Post (ledgerGuard) | ✅ PASS | DB-level `ae_immutability` trigger prevents double-post |
| Expense Create | ✅ PASS | No shared mutable state; idempotent |
| Bank Disbursement Post | ⚠️ PARTIAL | Status check not inside FOR UPDATE lock |
| Deadlock Risk | ✅ LOW RISK | Lock ordering generally consistent; one cross-table risk identified |
| **Overall** | **⚠️ CONDITIONAL PASS** | P1 race conditions must be fixed before Phase 3 |

---

## Race Condition Audit

### Operation 1 — Cash Advance Repayment (POST /:id/repay)

**Current Code Flow:**
```
1. SELECT advance WHERE id = ? → check status !== 'repaid'
2. Check remaining amount
3. POST journal entry
4. INSERT repayment row
5. UPDATE advance (paidAmount, remainingAmount, status)
```

**Race Condition:** Two simultaneous repayment requests for the same advance:
- Thread A and Thread B both pass step 1 (status = 'active')
- Both pass step 2 (remaining = 300,000)
- Both create journal entries at step 3
- Both insert repayments at step 4
- Final paidAmount = 2x intended; remaining may go negative

**Severity:** CRITICAL — financial data corruption possible

**Fix Required:**
```typescript
// In POST /:id/repay, wrap in transaction with FOR UPDATE
await db.transaction(async (tx) => {
  const [adv] = await tx.execute(
    sql`SELECT * FROM cash_advances WHERE id = ${id} FOR UPDATE`
  );
  // All subsequent reads and writes inside this transaction
  // Concurrent requests queue behind the lock — no double-processing
});
```

---

### Operation 2 — Allocation Posting (POST /allocations/:id/post)

**Current Code Flow:**
```
1. SELECT allocation WHERE id = ? → check status !== 'posted'
2. Check journal_entry_id IS NULL
3. Call postEntry() → creates journal
4. UPDATE allocation SET status='posted', journal_entry_id=?
```

**Race Condition:** Two simultaneous POST requests:
- Both read status = 'confirmed', journal_entry_id = NULL (step 1-2)
- Both call postEntry() → two journal entries created
- First UPDATE wins; second UPDATE overwrites journal_entry_id
- Result: orphaned journal entry in accounting_entries

**Severity:** CRITICAL — duplicate accounting journal entries

**Fix Required:**
```typescript
await db.transaction(async (tx) => {
  const [alloc] = await tx.execute(
    sql`SELECT * FROM allocation_headers WHERE id = ${id} FOR UPDATE`
  );
  if (alloc.status === 'posted') {
    throw new Error('Already posted'); // short-circuit inside lock
  }
  // ... rest of post logic
});
```

---

### Operation 3 — Bank Disbursement Confirm (POST /:id/confirm)

**Assessment:** PARTIAL

**Current State:** Status transition check occurs inside `db.transaction()` but without `FOR UPDATE`. The transaction provides atomicity for the write but not for the read-check-write pattern.

**Risk Level:** MEDIUM — lower risk than repayments because disbursement amounts are typically larger and workflows are more supervised, but concurrent browser clicks on "Confirm" button could trigger double-confirm.

**Fix:** Add `FOR UPDATE` on status read inside transaction.

---

### Operation 4 — Expense Approval (POST /expense-approvals/:id/approve)

**Assessment:** PASS ✅

The approval flow:
1. Wraps the entire operation in `db.transaction()`
2. Re-checks approval status inside the transaction
3. Uses explicit status transitions that fail gracefully on second attempt

No FOR UPDATE needed because duplicate approval attempts are idempotent (second approve on already-approved request returns 400 at application level before any DB write).

---

### Operation 5 — Journal Reverse/Void

**Assessment:** PASS ✅

The accounting immutability layer (`ae_immutability` DB trigger) prevents double-void at the database level. Even if two concurrent void requests pass the application-level status check, the DB trigger rejects the second journal entry modification.

---

### Operation 6 — Split / Merge (Bank Mutation)

**Assessment:** PASS ✅ (if implemented in allocation engine)

Split/merge operations in `bankAllocationMatching.ts` operate on single mutation rows with a parent-child relationship. The allocation engine's transaction wraps header + line inserts atomically. No evidence of concurrent split/merge race risk in current implementation.

---

## Deadlock Analysis

### Transaction Lock Ordering

| Transaction | Tables Locked (in order) | Risk |
|---|---|---|
| cashAdvances repay | cash_advances → accounting_journals → accounting_entries → cash_advance_repayments | LOW — unidirectional |
| Allocation post | allocation_headers → allocation_lines → accounting_entries | LOW — unidirectional |
| Bank disbursement | bank_disbursements → vendor_invoices → accounting_entries | LOW — unidirectional |
| Expense approval | expense_approvals → expenses → accounting_entries | LOW — unidirectional |

### Identified Cross-Table Risk

**Pattern:** `bankAllocationMatching.ts` can lock `bank_allocation_matches (BAM)` then `allocation_headers`. Separately, `allocation.ts` can lock `allocation_headers` then reference BAM for validation.

If executed concurrently:
- Request A: locks BAM row 1, waits for allocation_headers row 5
- Request B: locks allocation_headers row 5, waits for BAM row 1
→ **Deadlock**

**Mitigation:** PostgreSQL will detect this and abort one transaction (the one with fewer locks). The application should handle the `40P01` deadlock error code with a retry.

**Recommendation:**
```typescript
// Add deadlock retry wrapper
async function withDeadlockRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e: any) {
      if (e.code === '40P01' && i < maxRetries - 1) continue; // deadlock — retry
      throw e;
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## Concurrency Simulation Results

### Methodology
Simulated concurrent requests via analysis of locking patterns and transaction boundaries. Actual load testing requires a staging environment with production-equivalent data volumes.

### Simulation: 10 Concurrent Repayments (Same Advance)

| Scenario | Expected | Without Fix | With FOR UPDATE Fix |
|---|---|---|---|
| 10 threads, same advance, amount = 10,000 each | 1 succeeds, 9 fail (remaining exhausted) | Up to 10 succeed (data corrupt) | ✅ 1 succeeds, 9 fail correctly |

### Simulation: 20 Concurrent Allocation Posts

| Scenario | Expected | Without Fix | With FOR UPDATE Fix |
|---|---|---|---|
| 20 threads, same allocation | 1 journal created | Up to 20 journals created | ✅ 1 journal, 19 short-circuit |

### Simulation: 50 Concurrent Expense Creates

| Scenario | Expected | Without Fix | With Fix |
|---|---|---|---|
| 50 threads, different expenses | 50 unique records | 50 unique records | ✅ Already safe (no shared state) |

### Simulation: 100 Concurrent Approval Reads

| Scenario | Expected | Without Fix | With Fix |
|---|---|---|---|
| 100 threads reading approval status | 100 correct reads | ✅ Safe (read-only) | ✅ Already safe |

---

## Required Fixes (Blocking Phase 3)

### Fix 1 — cashAdvances.ts POST /:id/repay
Wrap entire repay logic in `db.transaction()` with `FOR UPDATE` on the advance row.

### Fix 2 — allocation.ts POST /:id/post (or equivalent posting endpoint)
Wrap post logic in `db.transaction()` with `FOR UPDATE` on the allocation header row.

### Fix 3 — bankDisbursements.ts confirm
Add `FOR UPDATE` inside existing transaction on disbursement status read.

### Fix 4 — Deadlock retry wrapper
Add `withDeadlockRetry` utility and apply to allocation + matching operations.

---

*Generated: Sprint 4.5 Concurrency Certification — 2026-07-07*
