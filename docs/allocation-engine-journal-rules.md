# Allocation Engine — Journal Rules

## Aturan Utama

> **SEMUA journal dari Allocation Engine harus melalui `AdvanceJournalService.postAllocationEngineJournal()`.**
>
> Dilarang membuat jurnal inline di route handler.

## Pattern Jurnal Saat Posting

```
DR  Bank Account (bankAccountId)     = received_amount
CR  COA Line 1                       = lines[0].amount
CR  COA Line 2                       = lines[1].amount
... (seterusnya sesuai jumlah baris)
```

Contoh:
```
DR  Bank BCA (ID 1001)    5.000.000
CR  Piutang Advance       3.000.000   [ADVANCE_PRINCIPAL]
CR  Revenue Service       2.000.000   [DIRECT_REVENUE]
```

## Resolusi COA Otomatis

Jika `coa_id` tidak diisi pada sebuah baris, sistem akan mencoba resolve dari `accounting_settings`:

| allocation_type       | Fallback COA                          |
|-----------------------|---------------------------------------|
| `ADVANCE_PRINCIPAL`   | `accounting_settings.ar_account_id`   |
| `SALES_INVOICE`       | `accounting_settings.ar_account_id`   |
| `OTHER_RECEIVABLE`    | `accounting_settings.ar_account_id`   |
| `DIRECT_REVENUE`      | `accounting_settings.revenue_account_id` |
| `CUSTOMER_DEPOSIT`    | COA dengan code `2-2%` atau nama `%deposit%` |
| `ROUNDING`/`ADJUSTMENT` | Wajib diisi manual                  |

Jika resolusi gagal → API mengembalikan error 400.

## Validasi Balance

```typescript
const sum = lines.reduce((acc, l) => acc + Number(l.amount), 0);
const diff = Math.abs(sum - receivedAmount);
if (diff >= 0.01) throw Error("Tidak balance");
```

Validasi dijalankan pada: **create**, **update**, **submit**, dan **post**.

## Anti Double-Posting

```sql
-- Di kolom journal_entry_id:
-- Null = belum pernah diposting
-- Non-null = sudah diposting → tolak jika coba post lagi
IF h.journal_entry_id IS NOT NULL → HTTP 400
```

## Reversal

Reversal menggunakan `createReversalJournal` dari `accountingPostingGuard.ts` — pattern yang sama dengan void advance dan bank receipt reversal.

```
POST posted reversal:
DR  COA Line 1          (mirror debit)
DR  COA Line 2          ...
CR  Bank Account        (mirror credit)
```

## Source Module Tag

Semua entry dari Allocation Engine diberi tag:
```
source: "manual"
sourceModule: "allocation_engine"
```
