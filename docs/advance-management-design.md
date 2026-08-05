# Advance Management — System Design

## Overview

Advance Management adalah **Unified Advance Engine** yang menggantikan dua sistem lama yang terpisah:
- **Kasbon Karyawan** (`/expense/kasbon`) → `advance_type = EMPLOYEE`
- **Dana Talangan** (tab di Bank Disbursement) → `advance_type = VENDOR` atau `OPERATIONAL`

Sistem baru menyatukan kedua flow dalam satu lifecycle engine yang konsisten dengan delapan tipe advance, sembilan status lifecycle, dan engine alokasi settlement yang fleksibel.

---

## Tipe Advance

| Kode          | Label                  | Prefix Nomor | Keterangan                              |
|---------------|------------------------|--------------|------------------------------------------|
| `EMPLOYEE`    | Kasbon Karyawan        | `ADV-EMP`    | Uang muka karyawan sebelum pertanggungjawaban |
| `VENDOR`      | Uang Muka Vendor       | `ADV-VND`    | Advance untuk pembayaran ke vendor       |
| `CUSTOMER`    | Uang Muka Pelanggan    | `ADV-CST`    | Deposit / uang muka dari customer        |
| `PROJECT`     | Dana Proyek            | `ADV-PRJ`    | Advance untuk kebutuhan proyek           |
| `PURCHASE`    | Uang Muka Pembelian    | `ADV-PUR`    | Down payment untuk PO                    |
| `TRAVEL`      | Dana Perjalanan        | `ADV-TRV`    | Per diem dan biaya perjalanan dinas      |
| `OPERATIONAL` | Dana Talangan          | `ADV-OPR`    | Dana talangan operasional                |
| `OTHER`       | Lainnya                | `ADV-OTH`    | Tipe tidak terdefinisi lainnya           |

---

## Lifecycle Status

```
draft
  ↓ [submit]
pending_approval
  ↓ [approve]
approved
  ↓ [disburse]         ← jurnal DISBURSEMENT di-posting di sini
outstanding
  ↓ [settle partial]
partially_settled
  ↓ [settle full]
settled
  ↓ [close]
closed

(dari status apapun sebelum disbursed)
  → void               ← jurnal REVERSAL di-posting otomatis
```

---

## Tabel Database

### `cash_advances` (Extended)
Tabel utama yang diperluas dengan kolom baru:

| Kolom               | Tipe           | Keterangan                                      |
|---------------------|----------------|-------------------------------------------------|
| `advance_type`      | TEXT           | Salah satu dari 8 ADVANCE_TYPES                 |
| `lifecycle_status`  | TEXT           | Salah satu dari 9 LIFECYCLE_STATUSES            |
| `counterparty_type` | TEXT           | 'employee', 'vendor', 'customer', dll            |
| `party_name`        | TEXT           | Nama penerima advance                           |
| `settled_amount`    | NUMERIC(14,2)  | Total pokok yang sudah dilunasi                 |
| `remaining_amount`  | NUMERIC(14,2)  | Sisa pokok yang belum dilunasi                  |
| `approved_by`       | TEXT           | User ID yang approve                            |
| `approved_at`       | TIMESTAMP      | Waktu approval                                  |
| `disbursed_by`      | TEXT           | User ID yang disburse                           |
| `currency`          | TEXT           | Default 'IDR'                                   |
| `exchange_rate`     | NUMERIC(12,6)  | Default 1                                       |
| `source_system`     | TEXT           | 'advance_management' atau 'legacy'              |

### `advance_settlements`
Header untuk setiap pembayaran/settlement terhadap sebuah advance.

| Kolom               | Tipe           | Keterangan                                      |
|---------------------|----------------|-------------------------------------------------|
| `id`                | SERIAL PK      |                                                 |
| `company_id`        | INTEGER        | Multi-tenant isolation                          |
| `advance_id`        | INTEGER FK     | → cash_advances.id                              |
| `settlement_number` | TEXT           | Format: `ADV-STL-YYYYMM-NNNN`                  |
| `date`              | DATE           | Tanggal settlement                              |
| `bank_account_id`   | INTEGER        | → chart_of_accounts.id (akun bank terima)       |
| `amount_received`   | NUMERIC(14,2)  | Total uang yang diterima dari counterparty       |
| `currency`          | TEXT           | Default 'IDR'                                   |
| `exchange_rate`     | NUMERIC(12,6)  | Default 1                                       |
| `journal_id`        | INTEGER        | → accounting_entries.id (jurnal settlement)     |
| `reference`         | TEXT           | No. referensi eksternal                         |
| `counterparty_name` | TEXT           | Nama pihak yang membayar                        |
| `notes`             | TEXT           | Catatan settlement                              |

### `advance_allocation_lines`
Detail alokasi per settlement, menjelaskan "uang ini dialokasikan ke mana".

| Kolom               | Tipe           | Keterangan                                      |
|---------------------|----------------|-------------------------------------------------|
| `id`                | SERIAL PK      |                                                 |
| `settlement_id`     | INTEGER FK     | → advance_settlements.id                        |
| `advance_id`        | INTEGER        | → cash_advances.id                              |
| `allocation_type`   | TEXT           | Lihat Allocation Types di bawah                 |
| `coa_id`            | INTEGER        | → chart_of_accounts.id (akun CR)                |
| `reference_doc_id`  | INTEGER        | Optional: ID dokumen terkait (invoice, dll)     |
| `reference_doc_type`| TEXT           | Optional: 'sales_invoice', dll                  |
| `amount`            | NUMERIC(14,2)  | Jumlah alokasi baris ini                        |
| `remarks`           | TEXT           | Keterangan baris                                |
| `journal_id`        | INTEGER        | → accounting_entries.id                         |

---

## Tipe Alokasi (Allocation Types)

| Kode                 | Keterangan                                                  |
|----------------------|-------------------------------------------------------------|
| `ADVANCE_PRINCIPAL`  | Pelunasan pokok advance (CR Advance Receivable)             |
| `SALES_INVOICE`      | Kelebihan dilunaskan ke AR Invoice Penjualan (CR AR)        |
| `DIRECT_REVENUE`     | Kelebihan dicatat sebagai pendapatan (CR Revenue)           |
| `CUSTOMER_DEPOSIT`   | Kelebihan menjadi deposit customer (CR Deposit)             |
| `OTHER_RECEIVABLE`   | Alokasi ke piutang lain (CR Receivable lain)                |
| `ROUNDING`           | Selisih pembulatan (CR Akun selisih)                        |
| `OTHER`              | Alokasi lainnya                                             |

---

## Endpoint API

| Method | Path                      | Keterangan                              |
|--------|---------------------------|-----------------------------------------|
| GET    | `/api/advances/dashboard` | Stats: outstanding, pending, settled    |
| GET    | `/api/advances/aging`     | Laporan aging per bucket hari           |
| GET    | `/api/advances/accounts`  | COA akun cocok untuk advance            |
| GET    | `/api/advances`           | List advances dengan pagination + filter|
| POST   | `/api/advances`           | Buat advance baru                       |
| GET    | `/api/advances/:id`       | Detail advance + settlement history     |
| PATCH  | `/api/advances/:id/approve`  | Approve advance                      |
| PATCH  | `/api/advances/:id/reject`   | Reject advance → status void         |
| PATCH  | `/api/advances/:id/disburse` | Disburse + posting jurnal            |
| POST   | `/api/advances/:id/settle`   | Settlement dengan allocation engine  |
| POST   | `/api/advances/:id/void`     | Void + auto-reversal jurnal          |

---

## Frontend

- **Route**: `/finance/advances`
- **File**: `artifacts/bizportal/src/pages/finance/advance-management.tsx`
- **Menu**: Finance → Advance Management (icon Wallet)
- **Tabs**: Daftar Advance | Laporan Aging | Rekapitulasi

---

## Migrasi dari Sistem Lama

| Sistem Lama      | Sistem Baru         | Mapping                                    |
|------------------|---------------------|--------------------------------------------|
| Kasbon Karyawan  | `advance_type=EMPLOYEE`    | Data lama dimapping otomatis via migration |
| Dana Talangan (vendor) | `advance_type=VENDOR` | Jika ada vendor_id                    |
| Dana Talangan (ops)    | `advance_type=OPERATIONAL` | Jika tidak ada vendor_id          |
| Status `active`  | `lifecycle_status=outstanding` |                                   |
| Status `partial` | `lifecycle_status=partially_settled` |                             |
| Status `repaid`  | `lifecycle_status=settled` |                                      |
| Status `void`    | `lifecycle_status=void` |                                         |

Data lama **tidak dihapus** — hanya di-UPDATE untuk mengisi kolom baru. Record dengan `source_system='legacy'` adalah data lama.
