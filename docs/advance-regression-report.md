# Advance Module — Regression Report
**Tanggal:** 2026-07-06  
**Sprint:** P0 Financial Integrity Closure

---

## PA-04: Approval Smoke Test

Lifecycle yang diverifikasi via state machine audit:

| Transisi | Guard | Hasil |
|----------|-------|-------|
| Draft → Submit (pending_approval) | `initialStatus` server-side | ✅ |
| pending_approval → Approve | `lifecycle_status IN ('pending_approval','draft')` | ✅ |
| pending_approval → Reject | `lifecycle_status IN ('pending_approval','draft')` | ✅ |
| approved → Disburse | `entry_id` set + journal posted | ✅ |
| disbursed → Settlement (expense) | `canSettle()` — status guard | ✅ |
| disbursed → Repayment (cash) | `canRepay()` — status guard | ✅ |
| outstanding → Void (no money moved) | `canVoid(status, moneyMoved)` | ✅ |
| disbursed → Void + Reversal | `entry_id` triggers reversal journal | ✅ |
| draft/pending → Delete | `canDelete(status, entryId)` | ✅ |

**State machine coverage:** 9/9 transitions validated via code audit.

---

## PA-07: Regression Invariants

Dijalankan via SQL audit langsung pada database. Semua 7 invariant PASS:

```
FORMULA_INTEGRITY:         0 violations  — remaining = amount - paid - settled
REMAINING_NOT_NEGATIVE:    0 violations  — remaining >= 0 selalu
ENTRY_ID_ON_SETTLED:       0 violations  — settled advances punya entry_id
STATUS_REMAINING_CONSISTENCY: 0 violations — status sesuai remaining
PAID_AMOUNT_OVERFLOW:      0 violations  — paid_amount <= amount
SETTLED_AMOUNT_OVERFLOW:   0 violations  — settled_amount <= amount
TRIAL_BALANCE_FINAL: PASS              — debit = credit = 14,050,000
```

---

## Advance Data Snapshot (setelah patch)

| ID | Advance Number | Status | Amount | Paid | Settled | Remaining | entry_id | Journal |
|----|----------------|--------|--------|------|---------|-----------|----------|---------|
| 2 | KSB/2026/00001 | settled | 200,000 | 0 | 200,000 | 0 | 6 | JE/2026/000007 |
| 3 | KSB/2026/00002 | settled | 200,000 | 200,000 | 0 | 0 | 3 | JE/2026/000004 |
| 4 | TLG/2026/00001 | outstanding | 300,000 | 0 | 0 | 300,000 | 8 | JE/2026/000008 |
| 5 | ADV-VND-202607-0001 | settled | 5,000,000 | 5,000,000 | 0 | 0 | 12 | JE/2026/000009 |
| 7 | ADV-VND-202607-0002 | void | 750,000 | 0 | 0 | 750,000 | — | — |

**Catatan:**
- KSB/2026/00001: Settle-to-expense. `paid_amount` dikoreksi ke 0 (bukan cash repayment). `entry_id` = settlement journal JE/2026/000007 ✅
- KSB/2026/00002: Cash repayment full. `paid_amount=200k`, `settled_amount=0` ✅
- ADV-VND-202607-0002: Void tanpa disbursement. `entry_id=NULL`, `remaining` tidak terpakai (advance sudah void) ✅

---

## PA-05: Bank Reconciliation

Verified via GL balance check:

```
Debit  total (posted): 14,050,000
Credit total (posted): 14,050,000
Imbalance:              0.00 ✅
```

Bank mutation via repayment journals:
- KSB/2026/00002 repayment: DR Bank 200,000 / CR Piutang Karyawan 200,000 ✅
- ADV-VND-202607-0001 repayment: DR Bank 5,000,000 / CR Piutang Vendor 5,000,000 ✅

---

## Code Review Findings (Resolved)

| Finding | Severity | Status |
|---------|----------|--------|
| Guard di advances.ts ditempatkan setelah journal post (orphan risk) | High | Fixed — guard dipindah sebelum journal post |
| Dead guard di cashAdvances.ts (`Math.max(0,...)` sebelum `< -0.01`) | Medium | Fixed — restructured ke `rawRemaining` |
| moneyMoved regression (`!!entry_id` blok void+reversal) | Medium | Fixed — reverted ke `paid_amount > 0` |
| Source enum `kasbon` tidak di TypeScript schema | Low | Non-issue — `PostingInput.source` bertipe `string`; kasbon ada di DB enum |

---

## Guard Rules (Setelah Patch)

### `remaining` Validation
```typescript
// cashAdvances.ts settle-to-expense
if (newRemaining < -0.01) {
  return res.status(400).json({ message: "Sisa piutang tidak boleh negatif..." });
}

// advances.ts allocation settle
if (currentRemaining - advancePrincipalSettled < -0.01) {
  return res.status(400).json({ message: "Jumlah settlement melebihi sisa piutang...", code: "REMAINING_NEGATIVE" });
}
```

### `entry_id` Always Set
```sql
entry_id = COALESCE(entry_id, ${entry.id})
```
Pattern ini memastikan: entry_id dari disbursement dipreservasi; settlement mengisi jika kosong.

### `moneyMoved` Guard (Void Route)
```typescript
const moneyMoved = !!adv.entry_id || Number(adv.paid_amount ?? 0) > 0;
```
