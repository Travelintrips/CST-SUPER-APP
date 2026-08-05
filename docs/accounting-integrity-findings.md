# Accounting Integrity — Hasil Audit

Dijalankan dengan: `node scripts/audit-accounting-integrity.mjs`
Target: **Supabase DEV** (`SUPABASE_DATABASE_URL_DEV`)
Waktu: 2026-07-05T16:28 UTC
Exit code: `0` (bersih)

## Ringkasan

| # | Pemeriksaan | Hasil |
|---|---|---|
| 1 | Kasbon/Talangan — `entry_id` merujuk jurnal yang hilang | OK — 0 temuan |
| 2 | Kasbon/Talangan — VOID tanpa jurnal pembalik | OK — 0 temuan |
| 3 | `accounting_payments` — VOID tanpa jurnal pembalik | OK — 0 temuan |
| 4 | Jurnal tidak balance (debit ≠ kredit) | OK — 0 temuan |
| 5 | Posted entry tanpa `entry_lines` sama sekali | OK — 0 temuan |
| 6a | `accounting_payments` posted tanpa jurnal | OK — 0 temuan |
| 6b | `vendor_invoices` paid/posted tanpa jurnal valid | OK — 0 temuan |
| 7 | Jurnal kas/bank dengan source tidak valid | OK — 0 temuan |
| 8a | Orphan journal — `source=reversal` → `accounting_entries` | OK — 0 temuan |
| 8b | Orphan journal — `source=sales_invoice` → `sales_documents` | OK — 0 temuan |
| 8c | Orphan journal — `source=purchase_bill` → `purchase_documents` | OK — 0 temuan |

**Total temuan: 0.** Tidak ada pelanggaran "Posted Journal is Immutable" yang
terdeteksi di data DEV saat ini. Tidak ada patch/perbaikan data yang perlu
dijalankan sebagai hasil audit ini.

## Catatan cakupan (bukan bug, tapi batasan audit ini)

- **DEV berbeda skema dari PROD** (lihat memory `dev-prod-schema-drift.md`
  dan gotcha di `replit.md`) — hasil "bersih" di DEV tidak menjamin PROD juga
  bersih. Disarankan menjalankan script yang sama dengan `SUPABASE_DATABASE_URL`
  (prod) secara terpisah sebelum menyimpulkan seluruh sistem aman. Script sudah
  mendukung ini tanpa perubahan kode — cukup jalankan di environment yang
  memiliki `SUPABASE_DATABASE_URL` ter-set.
- **Source tag yang belum dipetakan ke tabel sumber**: `accounting_entries.source`
  punya banyak nilai enum (`sales_payment`, `purchase_payment`, `ecommerce_order`,
  `stock_received`, `pos_sale`, `logistic_vendor_cost`, `tenant_rent_payment`,
  `sport_center_*`, `bank_mutation_import`, `gsheet_import`, `fleet_cash_payment`,
  `marketplace_commission`, dll). Pengecekan "orphan journal" (#8) hanya
  mem-verifikasi `reversal`, `sales_invoice`, dan `purchase_bill` karena hanya
  tiga ini yang tabel sumbernya bisa dipastikan dari skema
  (`accounting_entries`, `sales_documents`, `purchase_documents`) tanpa
  menebak. Menambahkan source tag lain ke `ORPHAN_SOURCE_MAP` di
  `scripts/audit-accounting-integrity.mjs` aman dilakukan begitu nama tabel
  sumbernya dikonfirmasi eksplisit — TIDAK ditambahkan sekarang untuk
  menghindari asumsi skema yang salah (lihat `SCHEMA ASSUMPTION SAFETY` di
  `replit.md`).
- Tidak ditemukan tabel `vendor_payments` di skema (`lib/db/src/schema/`).
  Skrip audit versi sebelumnya mereferensikan tabel ini secara keliru —
  sudah dihapus dari versi yang diperbaiki.
- `vendor_installments` belum punya kolom void (`voided_at`/`void_entry_id`)
  di skema saat ini, jadi pengecekan "void tanpa reversal" untuk modul ini
  belum bisa dijalankan. Ini konsisten dengan status pekerjaan sebelumnya:
  hanya Kasbon (`cash_advances`) yang sudah mengimplementasikan
  DELETE/VOID/REPAYMENT guard secara penuh (lihat
  `docs/accounting-posting-integrity-policy.md`). Bila Vendor Installment
  akan mendapat kemampuan VOID di masa depan, tambahkan kolom
  `voided_at`/`void_entry_id`/`reversal_journal_id` (additive, `ADD COLUMN
  IF NOT EXISTS`) lalu tambahkan pengecekan yang sepadan di script ini.

## Tidak ada patch yang diperlukan

Karena hasil scan bersih (0 temuan) di DEV, tidak ada perubahan data atau
migrasi database yang dijalankan pada sesi ini — sesuai batasan tugas
("hanya patch bug yang ditemukan-dan-aman", tidak ada yang perlu dipatch).

## Cara menjalankan ulang

```bash
# Terhadap DEV (default jika hanya SUPABASE_DATABASE_URL_DEV yang di-set)
node scripts/audit-accounting-integrity.mjs

# Terhadap PROD — pastikan SUPABASE_DATABASE_URL di-set di environment
SUPABASE_DATABASE_URL="<prod-pooler-url>" node scripts/audit-accounting-integrity.mjs
```

Exit code `0` = bersih, `1` = ada temuan (cocok dipakai di CI/cron), `2` =
script gagal jalan (mis. tidak ada DB URL / koneksi gagal).
