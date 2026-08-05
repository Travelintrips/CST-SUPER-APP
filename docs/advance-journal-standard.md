# Advance Journal Standard

**Source of Truth:** `artifacts/api-server/src/lib/advance/AdvanceJournalService.ts`

---

## Rule

> ALL journal postings for Advance Management go through `AdvanceJournalService`.  
> No advance route may call `postEntry()` directly.

---

## Journal Entry Map

### Disbursement (money leaves company)
```
DR  Advance Receivable  [receivable_account_id]   +amount
CR  Bank / Kas          [cash_bank_account_id]     −amount
```
- Ref: `{advance_number}` (e.g. `ADV-EMP-202407-0001`)
- Source module: `advance_management`
- Triggered by: `PATCH /api/advances/:id/disburse`

### Repayment (money returns to company)
```
DR  Bank / Kas          [source_account_id]        +repay_amount
CR  Advance Receivable  [receivable_account_id]    −repay_amount
```
- Ref: `RPY-{advance_number}` (or `{advance_number}-{suffix}` for partial)
- Triggered by: `POST /api/advances/:id/repay`

### Expense Settlement (Pertanggungjawaban — no cash movement)
```
DR  Expense Account     [expense_account_id]       +amount
CR  Advance Receivable  [receivable_account_id]    −amount
```
- Ref: `{settlement_ref}`
- Triggered by: when `allocation_type === "EXPENSE_JUSTIFICATION"` in settle

### Allocation Settlement (bank receipt + multiple credit lines)
```
DR  Bank                [bank_account_id]           +amount_received
CR  Advance Receivable  [receivable_account_id]     −principal portion
CR  Other COA           [coa_id per line]            −other allocations
```
- Triggered by: `POST /api/advances/:id/settle`
- Journal balanced validated via `validateJournalBalance()` before posting

### Void Reversal (counter-entry)
```
CR  Advance Receivable  [original debit account]   −amount
DR  Bank / Kas          [original credit account]  +amount
```
- Exact mirror of the original disbursement journal
- Created by `createReversalJournal()` from `accountingPostingGuard.ts`
- Triggered by: `POST /api/advances/:id/void` (when `entry_id` exists)

---

## Receivable Account Resolution

| advance_type | COA Prefix |
|---|---|
| `kasbon`, `EMPLOYEE` | `1-1032*` (Piutang Kasbon Karyawan) |
| All others | `1-1033*` (Piutang Advance) |

The function `resolveReceivableAccount()` in `AdvanceJournalService` resolves this automatically.

---

## Balance Invariant

Every journal entry posted through `AdvanceJournalService` must satisfy:
```
SUM(debit lines) === SUM(credit lines)  (tolerance ±0.005)
```
`validateJournalBalance()` is called in `postAllocationSettlement()` and throws `JournalPostingError` if the balance fails.

---

## Legacy Mapping (deprecated)

The functions in `journalMappingService.ts` are retained for backward compatibility but must NOT be used for new code:

| Old function | Replacement |
|---|---|
| `postKasbonJournal()` | `AdvanceJournalService.postDisbursementJournal()` |
| `postTalanganJournal()` | `AdvanceJournalService.postDisbursementJournal()` |
| `postKasbonRepaymentJournal()` | `AdvanceJournalService.postRepaymentJournal()` |
| `postTalanganRepaymentJournal()` | `AdvanceJournalService.postRepaymentJournal()` |
