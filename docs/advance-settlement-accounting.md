# Advance Settlement — Accounting Treatment

## Prinsip Dasar

Semua transaksi advance menggunakan **Double-Entry Bookkeeping** yang diposting melalui `postEntry()` dari `lib/accounting.ts`. Tidak ada kolom keuntungan/profit tunggal — semua surplus dicatat sebagai credit ke akun revenue atau AR yang sesuai.

---

## 1. Disbursement Journal

**Trigger**: `PATCH /api/advances/:id/disburse` (atau `auto_disburse=true` saat create)

**Pola**:
```
DR Advance Receivable   Rp [amount]
  CR Bank / Kas           Rp [amount]
```

**Akun**:
- DR: `cash_advances.receivable_account_id` — akun piutang advance (asset)
- CR: `cash_advances.cash_bank_account_id` — akun bank/kas (asset)

**Referensi**: `advance_number` (contoh: `ADV-EMP-202607-0001`)

**Catatan**: Hanya bisa diposting SATU KALI. Jika `entry_id` sudah terisi, endpoint menolak dengan 400.

---

## 2. Settlement Journal — Principal Only

**Trigger**: `POST /api/advances/:id/settle` dengan `allocation_type = "ADVANCE_PRINCIPAL"`

**Pola**:
```
DR Bank / Kas           Rp [amount_received]
  CR Advance Receivable   Rp [amount_received]
```

**Akun**:
- DR: `settlement.bank_account_id` — akun bank penerimaan
- CR: `cash_advances.receivable_account_id` — akun piutang advance yang sama saat disbursement

---

## 3. Settlement Journal — Dengan Invoice Penjualan

**Trigger**: `POST /api/advances/:id/settle` dengan baris `ADVANCE_PRINCIPAL` + `SALES_INVOICE`

**Contoh**: Advance Rp 10jt, settlement Rp 15jt (kelebihan Rp 5jt offset ke AR Invoice)

```
DR Bank / Kas                    Rp 15.000.000
  CR Advance Receivable            Rp 10.000.000   ← ADVANCE_PRINCIPAL
  CR Piutang Dagang / AR           Rp  5.000.000   ← SALES_INVOICE (coa_id)
```

**Akun**:
- DR: `settlement.bank_account_id`
- CR Advance: `cash_advances.receivable_account_id`
- CR AR: `allocation_line.coa_id` (COA piutang dagang)

---

## 4. Settlement Journal — Pendapatan Langsung Multi-Layanan

**Trigger**: `POST /api/advances/:id/settle` dengan baris `DIRECT_REVENUE` per layanan

**Contoh**: Advance Rp 5jt, settlement Rp 7jt dari CST dengan 2 jenis jasa

```
DR Bank / Kas                    Rp  7.000.000
  CR Advance Receivable            Rp  5.000.000   ← ADVANCE_PRINCIPAL
  CR Pendapatan Freight             Rp  1.500.000   ← DIRECT_REVENUE (coa_id_freight)
  CR Pendapatan Warehouse           Rp    500.000   ← DIRECT_REVENUE (coa_id_warehouse)
```

**Akun**:
- DR: `settlement.bank_account_id`
- CR Advance: `cash_advances.receivable_account_id`
- CR Revenue: `allocation_line.coa_id` (per baris pendapatan)

---

## 5. Void Journal (Sebelum Disbursed)

**Trigger**: `POST /api/advances/:id/void` pada advance yang belum di-disburse

**Pola**: Tidak ada jurnal diposting (status langsung ke `void`)

---

## 6. Void Journal (Setelah Disbursed)

**Trigger**: `POST /api/advances/:id/void` pada advance yang sudah memiliki `entry_id`

**Pola** (Reversal otomatis dari jurnal disbursement):
```
DR Bank / Kas           Rp [amount]   ← reversal
  CR Advance Receivable   Rp [amount]  ← reversal
```

Reversal diposting via `createReversalJournal()` yang memutar balik seluruh entry.

---

## Invariant Akuntansi

1. **Setiap disbursement = tepat satu accounting entry** — tidak ada double posting
2. **Setiap settlement = tepat satu accounting entry** — satu header, banyak CR lines
3. **Total DR = Total CR** — divalidasi oleh `postEntry()` sebelum insert
4. **Tidak ada kolom profit/keuntungan tunggal** — surplus selalu masuk ke akun revenue/AR yang tepat
5. **Void setelah disburse = wajib reversal** — tidak ada penghapusan entry yang sudah diposting

---

## Mapping COA yang Direkomendasikan

| Jenis Akun               | Account Type | Subtype        | Contoh Nama             |
|--------------------------|--------------|----------------|-------------------------|
| Advance Receivable       | asset        | receivable     | Piutang Kasbon Karyawan |
| Bank / Kas               | asset        | bank/cash      | Bank BCA Operasional    |
| Pendapatan Freight       | revenue      | service        | Pendapatan Jasa Freight |
| Pendapatan Warehouse     | revenue      | service        | Pendapatan Warehouse    |
| Piutang Dagang           | asset        | receivable     | Piutang Dagang - CST    |
| Selisih Pembulatan       | expense/rev  | other          | Selisih Pembulatan      |

---

## Source Module Identifier

Semua jurnal advance menggunakan `sourceModule = "advance_management"` agar dapat difilter di General Ledger untuk audit.
