# DEV Database Rebuild Plan — Final

**Tanggal:** 2026-07-02  
**Status:** SIAP EKSEKUSI — menunggu approval  
**Author:** Audit + Planning run  

---

## Temuan Aktual (Updated dari Audit Hari Ini)

| Metric | Nilai |
|--------|-------|
| Tabel DEV | **576** |
| Tabel PROD | **673** |
| Gap (PROD ada, DEV tidak) | **97 tabel** |
| Tabel DEV-only (DEV ada, PROD tidak) | **0** (bersih) |
| Enum PROD ada, DEV tidak | **8 enum** |
| Extension set | Identik di kedua DB |
| pg_dump local vs server | 16.10 vs 17.6 (versi mismatch — lihat §Pre-Requisite) |

> **Koreksi dari dokumen lama:** DEV bukan "40 tabel yang tersisa" — DEV sudah punya 576 tabel, murni subset PROD. Gap jauh lebih kecil dari yang diperkirakan.

---

## 1. Opsi Rebuild DEV

### Opsi A — Fresh Supabase Project

Buat project Supabase baru, dump schema PROD, apply ke project baru, ganti semua env vars.

**Cocok untuk:** situasi DEV sudah corrupt, atau ingin clean slate total termasuk Supabase auth users.

**Keuntungan:**
- Clean slate — tidak ada residual schema atau data lama
- Drizzle migration log bisa di-seed dari nol dengan benar
- Auth users DEV terisolasi sempurna dari PROD

**Kerugian:**
- **8 env vars harus diubah** — semuanya berubah karena project ref baru
- **~97 auth users DEV hilang** (Supabase auth.users tidak ikut dump)
- Storage bucket DEV harus dibuat ulang manual di Supabase dashboard
- Semua RLS policies dari schema dump harus diverifikasi ulang
- Downtime DEV ~10–15 menit (env update + API restart)
- Memerlukan pembuatan project Supabase baru secara manual (dashboard)

---

### Opsi B — In-Place Schema Upgrade (DIREKOMENDASIKAN ✅)

Tanpa ganti project, tanpa ganti env vars. Dump **hanya 97 tabel + 8 enum yang missing** dari PROD, apply langsung ke DEV yang ada.

**Cocok untuk:** situasi DEV masih sehat (576 tabel sudah ada dan berjalan), hanya perlu menambah objek yang belum ada.

**Keuntungan:**
- **0 env vars berubah** — project ref sama, koneksi string sama
- **0 data loss** — tidak menyentuh tabel yang sudah ada
- **0 downtime** — operasi `CREATE TABLE` dan `CREATE TYPE` tidak memblokir tabel existing
- Tidak perlu membuat project Supabase baru
- Auth users DEV tetap ada
- Storage bucket tidak berubah
- Lebih cepat: hanya apply 97 tabel, bukan full 673

**Kerugian:**
- Dump harus disaring (hanya tabel missing, bukan full schema)
- pg_dump 16.10 tidak bisa dump dari server 17.6 — butuh workaround (lihat §Pre-Requisite)
- RLS policies dari tabel baru perlu diverifikasi

---

## 2. Rekomendasi Terbaik: **Opsi B**

DEV adalah subset murni PROD (0 DEV-only tables). Gap hanya 97 tabel — bukan rebuild dari nol, melainkan **schema extension**. Melakukan fresh project (Opsi A) hanya menambah risiko dan kompleksitas tanpa manfaat nyata.

Opsi B juga lebih aman: jika terjadi masalah, rollback semudah `DROP TABLE` pada tabel yang baru saja dibuat — tidak ada data lama yang tersentuh.

---

## 3. Pre-Requisite: Mengatasi pg_dump Version Mismatch

`pg_dump` di Replit adalah versi **16.10**, sedangkan Supabase PostgreSQL adalah **17.6**. pg_dump menolak koneksi cross-major-version (error sudah terlihat di log backup: *"server version: 17.6; pg_dump version: 16.10"*).

**Solusi yang akan dipakai: Install pg_dump 17 via Nix**

```bash
# Install PostgreSQL 17 client tools (termasuk pg_dump 17)
nix-env -iA nixpkgs.postgresql_17

# Verifikasi versi
pg_dump --version
# Expected: pg_dump (PostgreSQL) 17.x
```

Jika `nix-env` tidak tersedia, alternatif:
```bash
# Fallback: gunakan psql + pg_dumpall workaround
# ATAU: gunakan Supabase Dashboard → Settings → Database → Download SQL Schema
```

---

## 4. Langkah Backup DEV Existing

Tujuan: preserve data DEV yang punya nilai bisnis sebelum apapun diubah.

> **Catatan:** Opsi B tidak menyentuh data existing. Backup ini adalah safety net jika terjadi hal yang tidak terduga.

### 4.1 Tabel DEV dengan Data Aktif (Top Business Data)

Berdasarkan audit `pg_stat_user_tables`:

| Tabel | Approx Rows | Kategori |
|-------|-------------|----------|
| `sport_bookings` | 35 | ⭐ Business data |
| `sport_payments` | 27 | ⭐ Business data |
| `sport_facilities` | 8 | ⭐ Business data |
| `sport_members` | 8 | ⭐ Business data |
| `sport_customers` | 8 | ⭐ Business data |
| `users` | 62 | ⭐ Test accounts |
| `portal_customers` | 8 | ⭐ Test accounts |
| `accounting_entries` | 101 | Business data |
| `accounting_entry_lines` | 224 | Business data |
| `accounting_payments` | 35 | Business data |
| `bank_disbursements` | 28 | Business data |
| `bank_mutations` | 6 | Business data |
| `companies` | 4 | Config |
| `company_bank_accounts` | 16 | Config |
| `chart_of_accounts` | 301 | Config (seed) |
| `fleet_scheduler_runs` | ~274K | Log — skip |
| `reconciliation_alerts` | ~24K | Log — skip |
| `audit_logs` | ~530 | Log — skip |

### 4.2 Perintah Backup

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"
BACKUP_FILE="/tmp/dev-data-backup-$(date +%Y%m%d-%H%M).sql"

# Backup tabel business data yang penting
pg_dump "$DEV_DIRECT" \
  --schema=public \
  --data-only \
  --no-owner \
  --no-acl \
  --disable-triggers \
  --table=public.sport_bookings \
  --table=public.sport_payments \
  --table=public.sport_facilities \
  --table=public.sport_members \
  --table=public.sport_customers \
  --table=public.users \
  --table=public.portal_customers \
  --table=public.accounting_entries \
  --table=public.accounting_entry_lines \
  --table=public.accounting_payments \
  --table=public.companies \
  --table=public.company_bank_accounts \
  --table=public.chart_of_accounts \
  -f "$BACKUP_FILE"

echo "Backup selesai: $BACKUP_FILE ($(du -sh $BACKUP_FILE | cut -f1))"
```

---

## 5. Langkah Schema-Only Dump dari PROD (97 Tabel Missing)

### 5.1 Daftar Lengkap 97 Tabel Missing

```
air_freight_orders, air_freight_rfqs, ai_task_sync_log, bank_account_balances,
bank_closing_periods, bank_coa_rules, bank_journal_entries, bank_recon_audit_logs,
banners, blast_session_logs, cashier_shifts, categories, cms_blocks, cms_media,
cms_pages, cms_settings, company_modules, company_onboarding_sessions,
conversation_test_cases, conversation_test_results, conversation_test_runs,
customer_document_registry, customer_memory_events, customer_memory_snapshots,
customer_preferences, customer_risk_assessments, draft_agreements_wa_log,
driver_memory_snapshots, executive_refresh_logs, executive_summaries,
fleet_cost_per_km, fleet_fuel_benchmarks, fleet_report_logs, fleet_risk_scores,
fleet_route_profitability, fleet_tire_rotations, fleet_tires, fleet_utilization_logs,
gym_memberships, hr_kasbon, hr_kasbon_installments, intel_customers, intel_profit,
intel_quotations, intel_readiness_scores, intel_refresh_log, intel_routes,
intel_vendors, logistic_purchase_requests, media_library, menu_items, menus,
mkt_company_settings, mkt_purchase_orders, mkt_rfq_guest_claims, mkt_rfq_lines,
mkt_rfqs, mkt_vendor_quote_lines, mkt_vendor_quotes, ocean_freight_rfqs,
otp_tokens, page_products, page_sections, payment_receipts, portal_company_members,
posts, promo_registrations, purchasing_budget_tracker, purchasing_intel_signals,
purchasing_price_benchmarks, purchasing_signals, quality_gate_results,
quality_gate_runs, quality_gate_suites, sc_admin_notes, sc_blocked_schedules,
sc_facility_images, sc_payments, sc_promos, sc_settings, site_settings,
theme_settings, user_site_access, vendor_capabilities, vendor_contract_rates,
vendor_document_registry, vendor_memory_events, vendor_memory_snapshots,
vendor_performance_snapshots, vendor_preferences, vendor_recommendation_outcomes,
vendor_recommendations, vendor_risk_assessments, wa_accounts, wa_api_keys,
wa_devices, wa_messages
```

### 5.2 Daftar 8 Enum Missing (DDL siap pakai, nilai dari PROD)

```sql
-- Enum DDL untuk DEV (dengan IF NOT EXISTS guard)
-- File: /tmp/missing-enums.sql

DO $$ BEGIN
  CREATE TYPE public.freight_service_category AS ENUM (
    'FF_UDARA', 'FF_LAUT', 'PPJK', 'TRUCKING', 'MULTIMODAL', 'GENERAL_FORWARDING'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_claim_status AS ENUM (
    'pending', 'claimed', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_po_status AS ENUM (
    'pending', 'confirmed', 'in_progress', 'delivered', 'completed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_quote_status AS ENUM (
    'invited', 'opened', 'submitted', 'selected', 'rejected', 'expired', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_rfq_priority AS ENUM (
    'low', 'normal', 'high', 'urgent'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_rfq_status AS ENUM (
    'draft', 'submitted', 'quoting', 'quoted', 'awarded', 'cancelled', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_stock_status AS ENUM (
    'available', 'limited', 'backorder', 'unavailable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM (
    'admin', 'super_admin', 'ecommerce', 'customer', 'admin_booking', 'trading',
    'agent', 'logistics', 'staff', 'finance', 'pos', 'pos-kasir',
    'pos-inventory', 'tenant', 'ap2_employee'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### 5.3 Perintah Dump 97 Tabel dari PROD

```bash
PROD_URL="postgresql://postgres.nzdweipzckfszczzqtuw:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

# Pastikan pg_dump 17 tersedia (lihat §Pre-Requisite)
pg_dump --version  # harus 17.x

# Dump schema-only untuk 97 tabel missing
pg_dump "$PROD_URL" \
  --schema=public \
  --schema-only \
  --no-owner \
  --no-acl \
  --table=public.air_freight_orders \
  --table=public.air_freight_rfqs \
  --table=public.ai_task_sync_log \
  --table=public.bank_account_balances \
  --table=public.bank_closing_periods \
  --table=public.bank_coa_rules \
  --table=public.bank_journal_entries \
  --table=public.bank_recon_audit_logs \
  --table=public.banners \
  --table=public.blast_session_logs \
  --table=public.cashier_shifts \
  --table=public.categories \
  --table=public.cms_blocks \
  --table=public.cms_media \
  --table=public.cms_pages \
  --table=public.cms_settings \
  --table=public.company_modules \
  --table=public.company_onboarding_sessions \
  --table=public.conversation_test_cases \
  --table=public.conversation_test_results \
  --table=public.conversation_test_runs \
  --table=public.customer_document_registry \
  --table=public.customer_memory_events \
  --table=public.customer_memory_snapshots \
  --table=public.customer_preferences \
  --table=public.customer_risk_assessments \
  --table=public.draft_agreements_wa_log \
  --table=public.driver_memory_snapshots \
  --table=public.executive_refresh_logs \
  --table=public.executive_summaries \
  --table=public.fleet_cost_per_km \
  --table=public.fleet_fuel_benchmarks \
  --table=public.fleet_report_logs \
  --table=public.fleet_risk_scores \
  --table=public.fleet_route_profitability \
  --table=public.fleet_tire_rotations \
  --table=public.fleet_tires \
  --table=public.fleet_utilization_logs \
  --table=public.gym_memberships \
  --table=public.hr_kasbon \
  --table=public.hr_kasbon_installments \
  --table=public.intel_customers \
  --table=public.intel_profit \
  --table=public.intel_quotations \
  --table=public.intel_readiness_scores \
  --table=public.intel_refresh_log \
  --table=public.intel_routes \
  --table=public.intel_vendors \
  --table=public.logistic_purchase_requests \
  --table=public.media_library \
  --table=public.menu_items \
  --table=public.menus \
  --table=public.mkt_company_settings \
  --table=public.mkt_purchase_orders \
  --table=public.mkt_rfq_guest_claims \
  --table=public.mkt_rfq_lines \
  --table=public.mkt_rfqs \
  --table=public.mkt_vendor_quote_lines \
  --table=public.mkt_vendor_quotes \
  --table=public.ocean_freight_rfqs \
  --table=public.otp_tokens \
  --table=public.page_products \
  --table=public.page_sections \
  --table=public.payment_receipts \
  --table=public.portal_company_members \
  --table=public.posts \
  --table=public.promo_registrations \
  --table=public.purchasing_budget_tracker \
  --table=public.purchasing_intel_signals \
  --table=public.purchasing_price_benchmarks \
  --table=public.purchasing_signals \
  --table=public.quality_gate_results \
  --table=public.quality_gate_runs \
  --table=public.quality_gate_suites \
  --table=public.sc_admin_notes \
  --table=public.sc_blocked_schedules \
  --table=public.sc_facility_images \
  --table=public.sc_payments \
  --table=public.sc_promos \
  --table=public.sc_settings \
  --table=public.site_settings \
  --table=public.theme_settings \
  --table=public.user_site_access \
  --table=public.vendor_capabilities \
  --table=public.vendor_contract_rates \
  --table=public.vendor_document_registry \
  --table=public.vendor_memory_events \
  --table=public.vendor_memory_snapshots \
  --table=public.vendor_performance_snapshots \
  --table=public.vendor_preferences \
  --table=public.vendor_recommendation_outcomes \
  --table=public.vendor_recommendations \
  --table=public.vendor_risk_assessments \
  --table=public.wa_accounts \
  --table=public.wa_api_keys \
  --table=public.wa_devices \
  --table=public.wa_messages \
  -f /tmp/prod-missing-tables-$(date +%Y%m%d).sql

echo "Dump selesai: $(wc -l /tmp/prod-missing-tables-*.sql | tail -1) baris"
```

---

## 6. Langkah Restore ke DEV

### 6.1 Urutan Eksekusi

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

# Step 1: Apply enum types dulu (dependencies tabel)
psql "$DEV_DIRECT" --set ON_ERROR_STOP=0 \
  -f /tmp/missing-enums.sql \
  2>&1 | tee /tmp/enum-apply.log
echo "--- Enum apply selesai ---"
grep -i "error" /tmp/enum-apply.log | grep -v "duplicate_object\|NOTICE"

# Step 2: Apply 97 tabel schema
psql "$DEV_DIRECT" --set ON_ERROR_STOP=0 \
  -f /tmp/prod-missing-tables-YYYYMMDD.sql \
  2>&1 | tee /tmp/tables-apply.log
echo "--- Table apply selesai ---"
grep -i "error" /tmp/tables-apply.log | grep -v "NOTICE"
```

> **Catatan `ON_ERROR_STOP=0`:** Digunakan karena pg_dump schema-only menghasilkan `CREATE TABLE` (bukan `IF NOT EXISTS`). Jika ada tabel yang sudah ada (seharusnya tidak, karena 97 ini semua baru), error akan dilewati tanpa menghentikan proses. Cek log manual untuk error yang unexpected.

### 6.2 Seed Drizzle Migration Log (Penting!)

Setelah tabel applied, update drizzle migration tracker agar `pnpm migrate` tidak mencoba apply ulang:

```sql
-- Jalankan di DEV setelah restore selesai
-- Cek state saat ini
SELECT * FROM __drizzle_migrations ORDER BY created_at;

-- Insert entries untuk migration 0013-0016 yang sudah applied via manual SQL
-- (sesuaikan hash dengan nilai di lib/db/drizzle/meta/_journal.json)
```

> **Catatan:** Ini optional tapi direkomendasikan. Tanpa ini, `pnpm migrate` akan gagal karena tabel sudah ada. Alternatif: tambahkan `IF NOT EXISTS` di semua migration files (sudah dilakukan untuk 0014). Cek migration files lain untuk idempotency.

---

## 7. Secret / Env yang Harus Diubah

### Opsi A (Fresh Project) — 8 vars berubah

| Env Var | Keterangan | Dipakai Oleh |
|---------|------------|--------------|
| `SUPABASE_DATABASE_URL_DEV` | pgBouncer URL (port 6543) | `lib/db`, API server |
| `SUPABASE_URL_DEV` | `https://<new-ref>.supabase.co` | `supabaseAdmin.ts`, `supabaseAdminSportCenter.ts` |
| `SUPABASE_ANON_KEY_DEV` | Anon/public key project baru | `supabaseAdmin.ts`, `supabaseAdminSportCenter.ts` |
| `SUPABASE_SERVICE_ROLE_KEY_DEV` | Service role key project baru | `supabaseAdmin.ts`, `objectStorage.ts` |
| `VITE_SUPABASE_URL_DEV` | Frontend Supabase URL | Customer portal, BizPortal |
| `VITE_SUPABASE_ANON_KEY_DEV` | Frontend anon key | Customer portal, BizPortal |
| `SUPABASE_STORAGE_BUCKET_DEV` | Storage bucket name | `objectStorage.ts` |
| *(opsional)* `SUPABASE_MIGRATION_URL` | Jika ingin DEV juga punya direct conn | Manual migration ke DEV |

### Opsi B (In-Place) — **0 vars berubah**

Tidak ada perubahan env vars. Project ref sama, koneksi string sama, semua credentials tetap.

---

## 8. Risiko

### Opsi A Risks

| Risiko | Kemungkinan | Dampak | Mitigasi |
|--------|-------------|--------|----------|
| pg_dump versi mismatch (16.10 vs 17.6) | **Pasti** | Blocker | Install pg17 via nix dulu |
| Auth users DEV hilang | Pasti | Medium | Buat ulang user test setelah rebuild |
| Storage bucket DEV kosong | Pasti | Low | Buat bucket baru di Supabase dashboard |
| Boot migrations conflict dengan schema dump | Rendah | Low | Semua boot migrations sudah IF NOT EXISTS |
| Lupa update salah satu dari 8 env vars | Medium | High | Checklist env vars wajib diikuti |
| RLS policies tidak ter-apply | Rendah | Medium | Schema dump includes policies |

### Opsi B Risks

| Risiko | Kemungkinan | Dampak | Mitigasi |
|--------|-------------|--------|----------|
| pg_dump versi mismatch (16.10 vs 17.6) | **Pasti** | Blocker | Install pg17 via nix dulu |
| FK constraint ke tabel yang belum ada | Medium | Medium | Urutan dump — pg_dump sudah handles dependency order |
| Enum `user_role` conflict (beberapa schema di PROD) | Rendah | Low | DO $$ EXCEPTION block sudah handle ini |
| Boot migration mencoba create tabel yang baru dibuat | Rendah | Low | Boot migrations IF NOT EXISTS — no-op |
| Schema dump include objects yang tidak compatible | Rendah | Low | Review log apply untuk NOTICE/ERROR |

### Risiko Umum Kedua Opsi

| Risiko | Mitigasi |
|--------|----------|
| pg_dump 16.10 tidak bisa connect ke pg 17.6 | **Pre-req: install pg17 tools** |
| Supabase pgBouncer block DDL (transaction mode) | Gunakan port 5432 (session pooler), bukan 6543 |
| FK references ke `auth.users` di beberapa tabel | pg_dump `--no-owner --no-acl` skip FK ke auth schema; cek manual jika ada FK error |

---

## 9. Rollback

### Opsi A Rollback

Karena Opsi A membuat project baru:
1. Simpan credential project DEV lama (`xssrfshdrtdfupgqwfdw`)
2. Jika gagal: revert env vars ke project lama
3. API server restart — kembali ke DEV lama dalam <2 menit

### Opsi B Rollback

Karena Opsi B hanya menambah objek baru (tidak mengubah yang sudah ada):

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

# Rollback: hapus tabel yang baru dibuat
# Generate DROP TABLE untuk 97 tabel
psql "$DEV_DIRECT" -c "
  DROP TABLE IF EXISTS public.mkt_rfqs CASCADE;
  DROP TABLE IF EXISTS public.mkt_rfq_lines CASCADE;
  DROP TABLE IF EXISTS public.portal_company_members CASCADE;
  -- ... dst (97 tabel)
"

# Rollback enum types
psql "$DEV_DIRECT" -c "
  DROP TYPE IF EXISTS public.mkt_rfq_status CASCADE;
  DROP TYPE IF EXISTS public.mkt_rfq_priority CASCADE;
  -- ... dst (8 enum)
"
```

> **Opsi B rollback adalah yang paling aman** — tidak ada perubahan data existing, hanya DROP objek yang baru ditambahkan.

---

## 10. Checklist Verifikasi Setelah Rebuild

Jalankan semua query ini setelah apply selesai:

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"
PROD_URL="postgresql://postgres.nzdweipzckfszczzqtuw:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

echo "=== 1. Hitung tabel DEV vs PROD ==="
echo "DEV:"
psql "$DEV_DIRECT" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
echo "PROD:"
psql "$PROD_URL" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
echo "(Harus sama atau DEV mendekati PROD)"

echo ""
echo "=== 2. Tabel kritis marketplace ada di DEV ==="
psql "$DEV_DIRECT" -c "
SELECT tablename FROM pg_tables
WHERE schemaname='public'
  AND tablename IN (
    'mkt_rfqs','mkt_rfq_lines','mkt_vendor_quotes','mkt_vendor_quote_lines',
    'mkt_purchase_orders','portal_company_members','mkt_dual_write_log',
    'mkt_company_settings','mkt_rfq_guest_claims'
  )
ORDER BY tablename;"

echo ""
echo "=== 3. Enum types marketplace ada ==="
psql "$DEV_DIRECT" -c "
SELECT typname FROM pg_type
WHERE typname IN (
  'mkt_rfq_status','mkt_rfq_priority','mkt_quote_status',
  'mkt_po_status','mkt_stock_status','mkt_claim_status',
  'mkt_dual_write_status','freight_service_category','user_role'
)
ORDER BY typname;"

echo ""
echo "=== 4. Tidak ada tabel di PROD yang masih missing dari DEV ==="
psql "$PROD_URL" -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname='public'" > /tmp/post_prod.txt
psql "$DEV_DIRECT" -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname='public'" > /tmp/post_dev.txt
STILL_MISSING=$(comm -23 <(sort /tmp/post_prod.txt) <(sort /tmp/post_dev.txt) | wc -l)
echo "Tabel masih missing: $STILL_MISSING (harus 0)"
comm -23 <(sort /tmp/post_prod.txt) <(sort /tmp/post_dev.txt)

echo ""
echo "=== 5. Data DEV existing tidak berubah ==="
psql "$DEV_DIRECT" -t -c "
SELECT
  (SELECT count(*) FROM sport_bookings) AS sport_bookings,
  (SELECT count(*) FROM users) AS users,
  (SELECT count(*) FROM accounting_entries) AS accounting_entries,
  (SELECT count(*) FROM companies) AS companies;"
echo "(Harus sama dengan sebelum rebuild)"

echo ""
echo "=== 6. API server startup setelah restart ==="
echo "Restart Gateway, lalu grep log untuk:"
echo "  - '[dualWrite:validate] Tabel OK — reliability layer AKTIF'"
echo "  - Tidak ada boot migration error untuk tabel baru"
echo "  - 'Pre-start schema migrations applied'"

echo ""
echo "=== 7. Endpoint smoke test ==="
BASE="https://\$REPLIT_DEV_DOMAIN"
curl -s -w "HTTP %{http_code}" "\$BASE/api/mkt/admin/dual-write/stats" | tail -1
echo "(Harus 401, bukan 500)"
```

---

## 11. Estimasi Downtime DEV

### Opsi A (Fresh Project)

| Fase | Durasi | DEV Status |
|------|--------|------------|
| Backup DEV data | 2 menit | ✅ Online |
| Dump PROD schema | 3 menit | ✅ Online |
| Setup Supabase project baru (manual di browser) | 10 menit | ✅ Online |
| Apply schema ke project baru | 5 menit | ✅ Online |
| **Update 8 env vars + restart API** | **5 menit** | ❌ **Offline** |
| Verifikasi + smoke test | 15 menit | ✅ Online |
| **Total downtime DEV** | **~5 menit** | |
| **Total waktu end-to-end** | **~40 menit** | |

### Opsi B (In-Place) ← Recommended

| Fase | Durasi | DEV Status |
|------|--------|------------|
| Install pg17 via nix | 3 menit | ✅ Online |
| Backup DEV data (safety net) | 2 menit | ✅ Online |
| Dump PROD 97 tabel missing | 3 menit | ✅ Online |
| Apply enum DDL ke DEV | 1 menit | ✅ Online |
| Apply 97 tabel schema ke DEV | 3 menit | ✅ Online |
| Verifikasi tabel count | 2 menit | ✅ Online |
| Restart API + smoke test | 5 menit | ✅ Online (hot restart) |
| **Total downtime DEV** | **0 menit** | |
| **Total waktu end-to-end** | **~20 menit** | |

---

## Keputusan yang Diperlukan Sebelum Eksekusi

1. **Opsi mana yang dipilih?** A (fresh project) atau B (in-place)
2. **Approval eksekusi?** Plan ini sudah siap dijalankan setelah approval.

---

*Dokumen ini menggantikan `docs/dev-db-rebuild-recommendation.md` sebagai plan final.*
