# Changelog: Fleet Table Routing Fix

**Tanggal**: 2026-06-20  
**Scope**: DEV (PROD belum disentuh)

## Masalah yang Diperbaiki

### 1. Data Drop pada Upload CSV Berulang
**Bug**: Baris CSV tanpa `gopay_transaction_reference_id` (contoh: "Rental fee due") tidak memiliki constraint dedup di `gojek_raw_transactions`. Jika CSV yang sama diupload dua kali, baris-baris ini masuk duplikat → outstanding dihitung dobel.

**Fix**: Tambah unique index `gojek_raw_no_ref_dedup` pada `(company_id, driver_external_id, date_iso, amount, transaction_type) WHERE gopay_ref IS NULL OR = ''`.

**Perubahan**: `migrations/fleet-index-fix.sql`, `artifacts/api-server/src/routes/fleetIntelligence.ts` (migration v15)

### 2. ON CONFLICT Tidak Cover Semua Unique Constraints
**Bug**: INSERT ke `gojek_raw_transactions` menggunakan `ON CONFLICT (company_id, gopay_transaction_reference_id) WHERE ...` — hanya menarget satu index, mengabaikan index lain.

**Fix**: Ganti ke `ON CONFLICT DO NOTHING` (tanpa target spesifik) — PostgreSQL akan check semua unique constraints.

**Perubahan**: `artifacts/api-server/src/routes/fleetIntelligence.ts` line ~1317-1353

### 3. `vehicle_plate` dan `driver_phone` Tidak Disimpan di Raw
**Bug**: INSERT ke `gojek_raw_transactions` tidak mengisi kolom `vehicle_plate` dan `driver_phone` (meski kolom sudah ada). Kolom `vehicle` diisi, tapi `vehicle_plate` (kolom terpisah) dibiarkan NULL.

**Fix**: Tambah `vehicle_plate` dan `driver_phone` ke INSERT statement. Backfill kolom lama via SQL.

**Perubahan**: `migrations/fleet-index-fix.sql` (backfill), `artifacts/api-server/src/routes/fleetIntelligence.ts` (INSERT columns)

### 4. Tabel `fleet_cash_payments` Belum Ada
**Bug**: Rekonsiliasi pembayaran tunai driver tidak bisa dicatat secara terstruktur.

**Fix**: Buat tabel `fleet_cash_payments` dengan kolom: `company_id`, `outstanding_id`, `driver_id`, `driver_name`, `driver_external_id`, `driver_phone`, `vehicle_plate`, `payment_date`, `amount`, `payment_method`, `reference_no`, `notes`, `recorded_by`, `status`.

**Perubahan**: `migrations/fleet-index-fix.sql`, `lib/db/src/schema/fleetIntelligence.ts`, `artifacts/api-server/src/routes/fleetIntelligence.ts` (migration v15 + endpoint)

### 5. Nama Tabel User vs DB Tidak Sesuai
**Klarifikasi**:  
- `fleet_raw_transactions` (user) → `fleet_transactions` (DB) = data TRANSFORMED, bukan raw  
- `fleet_outstanding_balances` (user) → `fleet_outstanding` (DB)  
- `fleet_reconciliation_batches` (user) → `fleet_reconciliation_reports` (DB)  
- `fleet_cash_payments` → DIBUAT BARU  

**Fix**: Buat VIEW `fleet_outstanding_balances` dan `fleet_reconciliation_batches` sebagai alias.

**Dokumen**: `docs/fleet-table-routing.md`, `docs/fleet-keep-list.md`

### 6. recalculateOutstanding SQL Bug (dari sesi sebelumnya)
**Bug**: `id ASC` (harusnya `id DESC`) + `date_time_jkt::date` (harusnya `date_iso`).

**Fix**: Sudah diperbaiki di sesi sebelumnya. Outstanding sekarang mengambil row TERBARU per driver dengan benar.

## Status PROD
- PROD **belum disentuh**
- Semua perubahan hanya di DEV
- Tabel KEEP tidak ada yang di-rename atau drop
- Setelah DEV valid, jalankan `migrations/fleet-index-fix.sql` di PROD secara manual

## Test yang Diperlukan (DEV)
- [ ] Upload CSV Gojek → row count tidak drop dari 1152
- [ ] Upload CSV yang sama dua kali → tidak ada duplikasi baris no-ref
- [ ] Outstanding per driver → cocok dengan CSV (Rp 10.286.169)
- [ ] Cash payment reconciliation → bisa catat pembayaran via `POST /cash-payments`
- [ ] Journal generation → `fleet_ledger_entries` terisi
- [ ] Alerts → generate alert berjalan
