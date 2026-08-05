# Panduan Deployment Migration — DEV/PROD Sync
Tanggal: 2026-07-07

## File yang dihasilkan

| File | Tujuan |
|------|--------|
| `migration_01_dev_to_prod.sql` | Jalankan di **PROD** — tambah kolom & tabel dari DEV |
| `migration_02_prod_to_dev.sql` | Jalankan di **DEV** — tambah kolom & tabel dari PROD |
| `migration_03_indexes.sql`     | Jalankan di kedua DB setelah migration utama |
| `migration_04_rollback.sql`    | Hanya jika terjadi masalah (tabel baru saja, data kosong) |
| `migration_validate.sql`       | Verifikasi hasil migration |
| `schema_new_tables.ts`         | Drizzle ORM schema untuk tabel baru |

---

## Urutan Deployment yang Aman

### LANGKAH 0 — Backup (WAJIB sebelum apapun)
```bash
pg_dump "$SUPABASE_MIGRATION_URL"    --schema-only -f backup_prod_$(date +%Y%m%d).sql
pg_dump "$SUPABASE_DATABASE_URL_DEV" --schema-only -f backup_dev_$(date +%Y%m%d).sql
```

### LANGKAH 1 — Apply ke DEV dulu
```bash
psql "$SUPABASE_DATABASE_URL_DEV" -f migrations/migration_02_prod_to_dev.sql
psql "$SUPABASE_DATABASE_URL_DEV" -f migrations/migration_03_indexes.sql
psql "$SUPABASE_DATABASE_URL_DEV" -f migrations/migration_validate.sql
```
Pastikan semua baris ekspektasi terpenuhi sebelum lanjut.

### LANGKAH 2 — Test aplikasi di DEV
- Cek halaman yang menyentuh kolom baru (pos_orders, purchase_documents, sport_bookings, dll.)
- Pastikan tidak ada error 500 atau "column does not exist" di browser console

### LANGKAH 3 — Apply ke PROD
```bash
psql "$SUPABASE_MIGRATION_URL" -f migrations/migration_01_dev_to_prod.sql
psql "$SUPABASE_MIGRATION_URL" -f migrations/migration_03_indexes.sql
psql "$SUPABASE_MIGRATION_URL" -f migrations/migration_validate.sql
```

### LANGKAH 4 — Re-deploy aplikasi
```bash
pnpm run build
# Lalu deploy via Replit / trigger deployment
```
Re-deploy penting karena boot migrations di kode juga perlu berjalan ulang di PROD.

### LANGKAH 5 — Monitor
- Pantau logs API server 5 menit pertama: `artifacts/api-server: API Server` workflow
- Cek `/system/health` endpoint
- Verifikasi browser console BizPortal tidak ada error

---

## Ringkasan Perubahan

### Migration 01 — DEV → PROD

**Kolom baru di 14 tabel (total 22 kolom):**

| Tabel | Kolom |
|-------|-------|
| `public.companies` | `industry`, `legal_name`, `updated_at` |
| `public.expenses` | `cost_center_id` |
| `public.chart_of_accounts` | `subtype` |
| `public.financial_periods` | `period_status` |
| `public.sport_payments` | `journal_id`, `posted_to_accounting_at`, `posting_error` |
| `public.tenant_payments` | `journal_id`, `posted_to_accounting_at`, `posting_error` |
| `public.task_attachments` | `customer_id`, `is_reusable`, `reuse_notes` |
| `public.cash_advance_installment_schedules` | `accounting_entry_id`, `payroll_item_id` |
| `public.salary_payments` | `bank_account_code`, `bank_account_name` |
| `public.fleet_ledger_entries` | `currency` |
| `public.fixed_assets` | `payment_account_id` |
| `public.departments` | `deleted_at` |
| `public.bank_reconciliation_matches` | `customer_name`, `order_ref` |
| `sport_center.sport_bookings` | `wa_customer_notif_sent_at` |

**Tabel baru (20 tabel):**
- AI Intelligence: 14 tabel
- Sport Center: 6 tabel

### Migration 02 — PROD → DEV

**Kolom baru di 15 tabel (total 26 kolom):**

| Tabel | Kolom |
|-------|-------|
| `public.pos_orders` | `customer_note`, `source`, `table_number` |
| `public.pos_products` | `company_id`, `linked_product_id`, `product_type` |
| `public.purchase_documents` | `logistic_order_id`, `mkt_purchase_order_id` |
| `public.drivers` | `driver_type` |
| `public.driver_jobs` | `vendor_id` |
| `public.vendor_responses` | `vendor_id` |
| `public.customers` | `typical_cargo_types`, `typical_routes` |
| `public.uom` | `code` |
| `public.payroll_runs` | `payment_entry_id` |
| `public.rfq_vendor_links` | `reminded_at` |
| `public.logistic_order_items` | `template_snapshot` |
| `public.driver_portal_tokens` | `used_at` |
| `sport_center.sport_bookings` | `booking_group_id`, `promo_id`, `sub_total` |
| `sport_center.sport_payments` | `payment_channel`, `reference_number`, `verified_at`, `verified_by` |
| `sport_center.promos` | `current_uses`, `minimum_booking_amount`, `promo_type` |

**Tabel baru (15 tabel):**
- HR Kasbon: 5 tabel
- Sales Delivery: 2 tabel
- TravelInTrips: 8 tabel (schema baru)

---

## Aturan Penting

1. **JANGAN jalankan di PROD sebelum sukses di DEV**
2. **JANGAN jalankan tanpa backup**
3. Semua script idempotent — aman dijalankan ulang
4. `ALTER TABLE ADD COLUMN` tidak bisa di-rollback (kolom sudah ada = tidak merusak data)
5. Rollback hanya tersedia untuk tabel baru yang masih kosong (`migration_04_rollback.sql`)
6. Jika ada error di tengah — PostgreSQL `BEGIN/COMMIT` otomatis rollback transaksi

---

## Kenapa DEV dan PROD tidak sinkron?

Proyek ini menggunakan **boot migrations** — kolom baru ditambahkan via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` otomatis saat API server restart. Di DEV ini berjalan setiap restart. Di PROD, server hanya restart saat re-deploy, sehingga kolom yang ditambahkan ke kode setelah deploy terakhir belum ada di PROD.

**Solusi jangka panjang:** Gunakan migration file eksplisit dengan drizzle-kit (bukan hanya boot migrations) agar ada rekam jejak yang bisa di-replay ke environment manapun.
