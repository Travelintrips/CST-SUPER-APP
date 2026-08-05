# Allocation Engine — Database Schema

## Tabel: `allocation_headers`

| Kolom               | Tipe           | Deskripsi                                              |
|---------------------|----------------|--------------------------------------------------------|
| `id`                | SERIAL PK      | Primary key                                            |
| `company_id`        | INTEGER NN     | Company owner                                          |
| `allocation_no`     | TEXT UNIQUE    | Nomor allocation (format: `ALLOC-YYYYMM-XXXX`)         |
| `bank_transaction_id` | INTEGER      | FK ke `bank_mutations` (opsional)                      |
| `bank_account_id`   | INTEGER        | FK ke `company_bank_accounts` (wajib saat posting)     |
| `currency`          | TEXT           | Default `IDR`                                          |
| `exchange_rate`     | NUMERIC(14,6)  | Default 1                                              |
| `received_amount`   | NUMERIC(14,2)  | Total penerimaan bank                                  |
| `allocated_amount`  | NUMERIC(14,2)  | Σ allocation lines                                     |
| `remaining_amount`  | NUMERIC(14,2)  | received - allocated (harus ≈ 0 saat submit)           |
| `status`            | TEXT           | draft/submitted/approved/posted/closed/reversed        |
| `reference_no`      | TEXT           | No. bukti / referensi eksternal                        |
| `customer_id`       | INTEGER        | FK ke customer (opsional)                              |
| `vendor_id`         | INTEGER        | FK ke vendor (opsional)                                |
| `project_id`        | TEXT           | ID proyek (opsional)                                   |
| `notes`             | TEXT           | Catatan bebas                                          |
| `allocation_date`   | DATE           | Tanggal alokasi                                        |
| `created_by`        | TEXT           | Email aktor                                            |
| `approved_by`       | TEXT           | Email approver                                         |
| `posted_by`         | TEXT           | Email poster                                           |
| `journal_entry_id`  | INTEGER        | FK ke `accounting_entries` (anti double-post guard)    |
| `created_at`        | TIMESTAMPTZ    |                                                        |
| `updated_at`        | TIMESTAMPTZ    |                                                        |

## Tabel: `allocation_lines`

| Kolom                  | Tipe          | Deskripsi                                             |
|------------------------|---------------|-------------------------------------------------------|
| `id`                   | SERIAL PK     |                                                       |
| `allocation_header_id` | INTEGER NN    | FK ke `allocation_headers`                            |
| `allocation_type`      | TEXT NN       | ADVANCE_PRINCIPAL / SALES_INVOICE / DIRECT_REVENUE / dll |
| `reference_type`       | TEXT          | Tipe referensi (`advance` / `invoice` / dll)          |
| `reference_id`         | INTEGER       | ID dokumen referensi                                  |
| `coa_id`               | INTEGER       | FK ke `chart_of_accounts` (CR account)                |
| `amount`               | NUMERIC(14,2) | Jumlah alokasi baris ini                              |
| `remarks`              | TEXT          | Keterangan baris                                      |
| `sort_order`           | INTEGER       | Urutan tampilan                                       |
| `allocation_status`    | TEXT          | pending / posted / reversed                           |
| `created_at`           | TIMESTAMPTZ   |                                                       |

## Tabel: `allocation_audit_logs`

| Kolom                  | Tipe        | Deskripsi                                              |
|------------------------|-------------|--------------------------------------------------------|
| `id`                   | SERIAL PK   |                                                        |
| `allocation_header_id` | INTEGER NN  | FK ke `allocation_headers`                             |
| `action`               | TEXT NN     | create / edit / submit / approve / reject / post / reverse |
| `actor`                | TEXT        | Email aktor                                            |
| `actor_id`             | INTEGER     | User ID aktor                                          |
| `from_status`          | TEXT        | Status sebelum aksi                                    |
| `to_status`            | TEXT        | Status setelah aksi                                    |
| `notes`                | TEXT        | Keterangan aksi                                        |
| `snapshot`             | JSONB       | Snapshot data (opsional)                               |
| `created_at`           | TIMESTAMPTZ |                                                        |

## Indexes

```sql
-- allocation_headers
UNIQUE idx_alloc_headers_no     (allocation_no)
INDEX  idx_alloc_headers_company (company_id)
INDEX  idx_alloc_headers_status  (status)
INDEX  idx_alloc_headers_date    (allocation_date)
INDEX  idx_alloc_headers_bank    (bank_account_id)

-- allocation_lines
INDEX  idx_alloc_lines_header    (allocation_header_id)
INDEX  idx_alloc_lines_type      (allocation_type)
INDEX  idx_alloc_lines_ref       (reference_type, reference_id)

-- allocation_audit_logs
INDEX  idx_alloc_audit_header    (allocation_header_id)
INDEX  idx_alloc_audit_action    (action)
```
