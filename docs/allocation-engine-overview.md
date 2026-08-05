# Allocation Engine — Phase 1 Foundation Overview

## Tujuan

Allocation Engine menerima penerimaan bank (bank payment) dan mengalokasikannya ke beberapa destinasi akuntansi secara presisi. Berbeda dengan settlement advance yang hanya menutup satu advance, Allocation Engine mendukung **satu penerimaan → banyak alokasi lintas tipe**.

## Tipe Alokasi yang Didukung

| Tipe                | Label              | Jurnal CR                  |
|---------------------|--------------------|----------------------------|
| `ADVANCE_PRINCIPAL` | Advance Principal  | Piutang Advance / AR       |
| `SALES_INVOICE`     | Invoice AR         | Account Receivable         |
| `DIRECT_REVENUE`    | Direct Revenue     | Pendapatan                 |
| `CUSTOMER_DEPOSIT`  | Customer Deposit   | Kewajiban Deposit Pelanggan|
| `OTHER_RECEIVABLE`  | Other Receivable   | Piutang Lain               |
| `ROUNDING`          | Pembulatan         | COA selisih pembulatan     |
| `ADJUSTMENT`        | Adjustment         | COA koreksi                |

## Lifecycle Status

```
draft → submitted → approved → posted → closed
                             ↘ reversed (dari posted)
        ↙ (reject)
draft ←─
```

## Validasi Kritis

- Σ allocation lines HARUS = received_amount (toleransi < 0.01)
- Over-allocation dan under-allocation **ditolak sistem**
- Posting hanya bisa dilakukan sekali per header (double-posting dicegah via `journal_entry_id`)

## Prinsip Journal

> **SEMUA jurnal melalui `AdvanceJournalService.postAllocationEngineJournal()`**

Pattern:
```
DR  Bank Account        (received_amount)
CR  COA Line 1         (amount baris 1)
CR  COA Line 2         (amount baris 2)
... dst.
```

## File Utama

| Layer     | File                                                          |
|-----------|---------------------------------------------------------------|
| DB        | `artifacts/api-server/src/lib/allocationMigration.ts`        |
| Service   | `artifacts/api-server/src/lib/advance/AdvanceJournalService.ts` (method `postAllocationEngineJournal`) |
| API       | `artifacts/api-server/src/routes/allocation.ts`              |
| Frontend  | `artifacts/bizportal/src/pages/finance/allocation-center.tsx` |
| Create    | `artifacts/bizportal/src/pages/finance/allocation-create.tsx` |
