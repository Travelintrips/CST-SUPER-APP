# Runbook: Opsi B — In-Place DEV Schema Upgrade

**Tanggal dibuat:** 2026-07-02  
**Status:** SIAP EKSEKUSI — menunggu approval eksplisit  
**Estimasi waktu:** ~20 menit  
**Estimasi downtime DEV:** 0 menit (non-destructive — hanya menambah objek baru)  

---

## Konteks

DEV memiliki **576 tabel**, PROD memiliki **673 tabel**. Gap: **97 tabel + 8 enum type** missing di DEV. DEV adalah subset murni PROD (0 tabel DEV-only). Opsi B menambah objek yang belum ada tanpa menyentuh yang sudah ada.

---

## Koneksi Database

```bash
# DEV — Session Pooler port 5432 (WAJIB untuk DDL, bukan 6543)
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:$(printenv SUPABASE_DATABASE_URL_DEV | grep -oP '(?<=:)[^@]+(?=@)'| head -1)@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

# PROD — Session Pooler port 5432
PROD_URL="$(printenv SUPABASE_MIGRATION_URL)"
```

> **Catatan:** Gunakan port **5432** (session pooler) untuk semua DDL. Port 6543 adalah pgBouncer transaction mode yang menolak multi-statement DDL.

---

## BASELINE DATA DEV (Dicatat 2026-07-02 sebelum rebuild)

Baseline ini dipakai di **Step 9 — Verifikasi data tidak berubah**.

| Tabel | Row Count |
|-------|-----------|
| `sport_bookings` | **35** |
| `sport_payments` | **27** |
| `sport_facilities` | **8** |
| `sport_members` | **8** |
| `users` | **62** |
| `accounting_entries` | **100** |
| `accounting_payments` | **35** |
| `companies` | **4** |
| `portal_customers` | **8** |
| `bank_disbursements` | **28** |

---

## STOP CONDITIONS

**Hentikan eksekusi dan rujuk ke Rollback Plan jika:**

| Kondisi | Kapan | Action |
|---------|-------|--------|
| `nix-env` gagal install pg17 AND fallback tidak tersedia | Step 3 | Stop — minta panduan manual |
| Apply enum menghasilkan error selain `duplicate_object` | Step 4 | Stop + rollback enum |
| Apply tabel menghasilkan error FK/dependency | Step 6 | Stop + drop tabel yang sudah applied |
| Row count tabel existing BERUBAH dari baseline | Step 9 | STOP SEGERA — rollback semua |
| API server crash loop setelah restart | Step 10 | Revert: lihat rollback §11 |

---

## STEP 1 — Pre-Check

Jalankan semua pengecekan ini. Semua harus hijau sebelum lanjut.

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:$(printenv SUPABASE_DATABASE_URL_DEV | grep -oP '(?<=:)[^@]+(?=@)' | head -1)@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"
PROD_URL="$(printenv SUPABASE_MIGRATION_URL)"

echo "=== [1.1] Koneksi DEV ==="
psql "$DEV_DIRECT" -t -c "SELECT 'DEV OK' AS status;" 2>&1

echo ""
echo "=== [1.2] Koneksi PROD ==="
psql "$PROD_URL" -t -c "SELECT 'PROD OK' AS status;" 2>&1

echo ""
echo "=== [1.3] Tabel count DEV (harus 576) ==="
psql "$DEV_DIRECT" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';" 2>&1

echo ""
echo "=== [1.4] Tabel count PROD (harus 673) ==="
psql "$PROD_URL" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';" 2>&1

echo ""
echo "=== [1.5] Konfirmasi 97 tabel benar-benar missing di DEV ==="
psql "$PROD_URL" -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname='public'" > /tmp/pre_prod_tables.txt
psql "$DEV_DIRECT" -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname='public'" > /tmp/pre_dev_tables.txt
MISSING=$(comm -23 <(sort /tmp/pre_prod_tables.txt) <(sort /tmp/pre_dev_tables.txt) | wc -l)
echo "Tabel missing: $MISSING (harus 97)"
echo ""
echo "=== [1.6] Konfirmasi 8 enum missing di DEV ==="
psql "$PROD_URL" -t -A -c "SELECT typname FROM pg_type WHERE typtype='e' ORDER BY typname" > /tmp/pre_prod_enums.txt
psql "$DEV_DIRECT" -t -A -c "SELECT typname FROM pg_type WHERE typtype='e' ORDER BY typname" > /tmp/pre_dev_enums.txt
MISSING_ENUM=$(comm -23 <(sort /tmp/pre_prod_enums.txt) <(sort /tmp/pre_dev_enums.txt) | wc -l)
echo "Enum missing: $MISSING_ENUM (harus 8)"

echo ""
echo "=== [1.7] Cek pg_dump version ==="
pg_dump --version
echo "(Jika 16.x → pg17 harus diinstall di Step 3)"
echo "(Jika 17.x → Step 3 bisa dilewati)"
```

**Expected output:**
- `DEV OK`, `PROD OK`
- DEV count: `576`, PROD count: `673`
- Missing tables: `97`, Missing enums: `8`
- pg_dump version: `16.10` (memerlukan Step 3)

---

## STEP 2 — Backup DEV (Safety Net)

Opsi B tidak menyentuh data existing. Backup ini adalah jaring pengaman jika terjadi hal yang tidak terduga.

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:$(printenv SUPABASE_DATABASE_URL_DEV | grep -oP '(?<=:)[^@]+(?=@)' | head -1)@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"
BACKUP_FILE="/tmp/dev-data-backup-$(date +%Y%m%d-%H%M).sql"

echo "Backup ke: $BACKUP_FILE"

pg_dump "$DEV_DIRECT" \
  --schema=public \
  --data-only \
  --no-owner \
  --no-acl \
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
  --table=public.bank_disbursements \
  --table=public.bank_disbursement_items \
  -f "$BACKUP_FILE" 2>&1

echo "Status: $?"
echo "Ukuran: $(du -sh $BACKUP_FILE 2>/dev/null | cut -f1)"
echo "Baris: $(wc -l < $BACKUP_FILE)"
```

> **Catatan:** pg_dump 16.10 dapat dump **FROM** server 17.6 untuk data-only ke tabel yang SAMA versinya. Backup ini berjalan dari DEV (pg_dump → DEV), bukan dari PROD — tidak ada version mismatch.

**Verifikasi backup:**
```bash
# Pastikan backup tidak kosong
wc -l "$BACKUP_FILE"
grep -c "^INSERT\|^COPY" "$BACKUP_FILE"
echo "(Harus ada minimal beberapa INSERT/COPY rows)"
```

**STOP jika:** backup gagal (exit code != 0) atau file kosong. Jangan lanjut tanpa backup.

---

## STEP 3 — Install pg_dump 17 via Nix

Diperlukan karena pg_dump 16.10 ditolak oleh Supabase PostgreSQL 17.6.

### Opsi 3A — Via nix-env (Primer)

```bash
echo "=== Install PostgreSQL 17 client tools ==="
nix-env -iA nixpkgs.postgresql_17

echo ""
echo "=== Verifikasi ==="
# Nix installs ke ~/.nix-profile/bin — pastikan ada di PATH
export PATH="$HOME/.nix-profile/bin:$PATH"
pg_dump --version
# Expected: pg_dump (PostgreSQL) 17.x

# Simpan path pg_dump baru untuk dipakai di step berikutnya
PG_DUMP_CMD="$(which pg_dump)"
echo "pg_dump yang akan dipakai: $PG_DUMP_CMD"
```

**Expected output:** `pg_dump (PostgreSQL) 17.x`

### Opsi 3B — Fallback jika nix-env gagal

Jika `nix-env -iA nixpkgs.postgresql_17` timeout atau error:

```bash
# Cek apakah ada pg_dump 17 di nix store langsung
PG17_PATH=$(find /nix/store -name "pg_dump" -path "*/postgresql-17*" 2>/dev/null | head -1)
if [ -n "$PG17_PATH" ]; then
  echo "Ditemukan: $PG17_PATH"
  PG_DUMP_CMD="$PG17_PATH"
  $PG_DUMP_CMD --version
else
  echo "Tidak ditemukan di nix store"
  echo "FALLBACK: Download schema manual dari Supabase Dashboard"
  echo "  1. Login ke supabase.com/dashboard"
  echo "  2. Project PROD (nzdweipzckfszczzqtuw)"
  echo "  3. Settings → Database → Database Backups"
  echo "  4. Download → pilih 'Schema only'"
  echo "  5. Upload file ke /tmp/prod-schema-manual.sql"
  echo "  6. Lanjut ke Step 5B (apply dari file manual)"
fi
```

### Opsi 3C — Fallback Ultimate: psql workaround

Jika pg_dump tidak bisa didapat, gunakan `psql` untuk introspect dan generate DDL via `information_schema`. Ini lebih kompleks — hanya jika Opsi 3A dan 3B gagal. Minta panduan sebelum menggunakan opsi ini.

---

## STEP 4 — Apply 8 Enum Missing ke DEV

**WAJIB dilakukan sebelum dump tabel.** 6 dari 97 tabel missing memiliki kolom bertipe enum ini:
- `mkt_rfqs` → `mkt_rfq_status`, `mkt_rfq_priority`
- `mkt_vendor_quotes` → `mkt_quote_status`
- `mkt_vendor_quote_lines` → `mkt_stock_status`
- `mkt_purchase_orders` → `mkt_po_status`
- `mkt_rfq_guest_claims` → `mkt_claim_status`

Jika enum belum ada saat tabel di-CREATE, FK gagal dengan error `type does not exist`.

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:$(printenv SUPABASE_DATABASE_URL_DEV | grep -oP '(?<=:)[^@]+(?=@)' | head -1)@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

cat > /tmp/missing-enums.sql << 'ENUMSQL'
-- Missing enum types: DEV rebuild 2026-07-02
-- Semua dibungkus DO $$ EXCEPTION $$ untuk idempotency

DO $$ BEGIN
  CREATE TYPE public.freight_service_category AS ENUM (
    'FF_UDARA', 'FF_LAUT', 'PPJK', 'TRUCKING', 'MULTIMODAL', 'GENERAL_FORWARDING'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'freight_service_category sudah ada, dilewati';
END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_claim_status AS ENUM (
    'pending', 'claimed', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'mkt_claim_status sudah ada, dilewati';
END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_po_status AS ENUM (
    'pending', 'confirmed', 'in_progress', 'delivered', 'completed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'mkt_po_status sudah ada, dilewati';
END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_quote_status AS ENUM (
    'invited', 'opened', 'submitted', 'selected', 'rejected', 'expired', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'mkt_quote_status sudah ada, dilewati';
END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_rfq_priority AS ENUM (
    'low', 'normal', 'high', 'urgent'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'mkt_rfq_priority sudah ada, dilewati';
END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_rfq_status AS ENUM (
    'draft', 'submitted', 'quoting', 'quoted', 'awarded', 'cancelled', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'mkt_rfq_status sudah ada, dilewati';
END $$;

DO $$ BEGIN
  CREATE TYPE public.mkt_stock_status AS ENUM (
    'available', 'limited', 'backorder', 'unavailable'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'mkt_stock_status sudah ada, dilewati';
END $$;

DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM (
    'admin', 'super_admin', 'ecommerce', 'customer', 'admin_booking', 'trading',
    'agent', 'logistics', 'staff', 'finance', 'pos', 'pos-kasir',
    'pos-inventory', 'tenant', 'ap2_employee'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'user_role sudah ada, dilewati';
END $$;

ENUMSQL

echo "=== Apply enum ke DEV ==="
psql "$DEV_DIRECT" -f /tmp/missing-enums.sql 2>&1 | tee /tmp/enum-apply.log

echo ""
echo "=== Verifikasi enum terbentuk ==="
psql "$DEV_DIRECT" -t -A -c "SELECT typname FROM pg_type WHERE typtype='e' ORDER BY typname" > /tmp/post_enum_dev.txt
comm -23 <(sort /tmp/pre_prod_enums.txt) <(sort /tmp/post_enum_dev.txt)
STILL_MISSING_ENUM=$(comm -23 <(sort /tmp/pre_prod_enums.txt) <(sort /tmp/post_enum_dev.txt) | wc -l)
echo "Enum masih missing: $STILL_MISSING_ENUM (harus 0)"
```

**Expected output:**
- Setiap enum: `DO` (sukses) atau `NOTICE: ... sudah ada, dilewati`
- Tidak ada `ERROR` di log
- `Enum masih missing: 0`

**STOP jika:** ada `ERROR` selain `duplicate_object` di `/tmp/enum-apply.log`.

---

## STEP 5 — Dump 97 Tabel Missing dari PROD

Gunakan `pg_dump` versi 17 dari Step 3.

```bash
PROD_URL="$(printenv SUPABASE_MIGRATION_URL)"
DUMP_FILE="/tmp/prod-missing-tables-$(date +%Y%m%d-%H%M).sql"

# Pastikan menggunakan pg_dump 17 dari Step 3
export PATH="$HOME/.nix-profile/bin:$PATH"

echo "pg_dump version: $(pg_dump --version)"
echo "Output: $DUMP_FILE"
echo ""

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
  -f "$DUMP_FILE" 2>&1

DUMP_EXIT=$?
echo ""
echo "Exit code: $DUMP_EXIT (harus 0)"
echo "Baris dump: $(wc -l < $DUMP_FILE)"
echo "Ukuran: $(du -sh $DUMP_FILE | cut -f1)"
```

**Verifikasi dump:**
```bash
echo "=== Spot-check: mkt_rfqs ada di dump ==="
grep -c "CREATE TABLE public.mkt_rfqs" "$DUMP_FILE"
echo "(Harus: 1)"

echo "=== Spot-check: portal_company_members ada di dump ==="
grep -c "CREATE TABLE public.portal_company_members" "$DUMP_FILE"
echo "(Harus: 1)"

echo "=== Cek tidak ada referensi ke auth schema ==="
grep -c "auth\." "$DUMP_FILE" || echo "0 (baik — tidak ada FK ke auth schema)"
```

**STOP jika:** `DUMP_EXIT != 0` atau file dump kosong (0 baris).

---

## STEP 6 — Restore Schema-Only ke DEV

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:$(printenv SUPABASE_DATABASE_URL_DEV | grep -oP '(?<=:)[^@]+(?=@)' | head -1)@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"
DUMP_FILE=$(ls -t /tmp/prod-missing-tables-*.sql | head -1)

echo "Apply dari: $DUMP_FILE"
echo ""

# ON_ERROR_STOP=0: lanjut jika ada error tidak kritis
# (pg_dump menghasilkan CREATE TABLE tanpa IF NOT EXISTS; jika ada tabel yang
# sudah ada secara tidak terduga, error akan di-log tapi proses lanjut)
psql "$DEV_DIRECT" \
  --set ON_ERROR_STOP=0 \
  -f "$DUMP_FILE" \
  2>&1 | tee /tmp/tables-apply.log

echo ""
echo "=== Error yang perlu diperhatikan (bukan NOTICE) ==="
grep -i "^psql\|ERROR" /tmp/tables-apply.log | grep -v "NOTICE" | head -20
echo ""
echo "=== Error total (excluding NOTICE) ==="
grep -c "^ERROR" /tmp/tables-apply.log || echo "0 errors"
```

**Yang diharapkan di log:**
- `CREATE TABLE` — sukses
- `CREATE INDEX` — sukses
- `ALTER TABLE` — sukses (FK, constraints)
- `CREATE SEQUENCE` — sukses
- **Tidak ada:** `ERROR: type does not exist` (sudah dicegah di Step 4)
- **Tidak ada:** `ERROR: relation already exists` (ini tabel baru semua)

**STOP jika:** ada `ERROR: type does not exist` atau `ERROR: column ... references` atau error FK yang tidak terduga.

---

## STEP 7 — Verifikasi Table Count DEV = PROD

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:$(printenv SUPABASE_DATABASE_URL_DEV | grep -oP '(?<=:)[^@]+(?=@)' | head -1)@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"
PROD_URL="$(printenv SUPABASE_MIGRATION_URL)"

echo "=== Table count post-apply ==="
DEV_COUNT=$(psql "$DEV_DIRECT" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';" | tr -d ' ')
PROD_COUNT=$(psql "$PROD_URL" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';" | tr -d ' ')
echo "DEV:  $DEV_COUNT"
echo "PROD: $PROD_COUNT"

if [ "$DEV_COUNT" -eq "$PROD_COUNT" ]; then
  echo "✅ PASS — DEV = PROD ($DEV_COUNT tabel)"
elif [ "$DEV_COUNT" -ge $((PROD_COUNT - 2)) ]; then
  echo "⚠️  NEAR MATCH — selisih $((PROD_COUNT - DEV_COUNT)) tabel (acceptable jika PROD baru dapat tabel saat proses)"
else
  echo "❌ FAIL — masih ada selisih besar: $((PROD_COUNT - DEV_COUNT)) tabel"
fi

echo ""
echo "=== Tabel yang masih missing di DEV ==="
psql "$PROD_URL" -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname='public'" > /tmp/post_prod_tables.txt
psql "$DEV_DIRECT" -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname='public'" > /tmp/post_dev_tables.txt
comm -23 <(sort /tmp/post_prod_tables.txt) <(sort /tmp/post_dev_tables.txt)
STILL_MISSING=$(comm -23 <(sort /tmp/post_prod_tables.txt) <(sort /tmp/post_dev_tables.txt) | wc -l)
echo "Tabel masih missing: $STILL_MISSING (harus 0)"
```

**Expected:** DEV count = PROD count = 673, still missing = 0.

**STOP jika:** masih ada tabel missing yang kritis (mkt_rfqs, portal_company_members, dll).

---

## STEP 8 — Verifikasi Marketplace Tables Ada

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:$(printenv SUPABASE_DATABASE_URL_DEV | grep -oP '(?<=:)[^@]+(?=@)' | head -1)@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

echo "=== Tabel marketplace kritis ==="
psql "$DEV_DIRECT" -c "
SELECT tablename,
       CASE WHEN tablename IS NOT NULL THEN '✅' ELSE '❌' END AS status
FROM (VALUES
  ('mkt_rfqs'),
  ('mkt_rfq_lines'),
  ('mkt_vendor_quotes'),
  ('mkt_vendor_quote_lines'),
  ('mkt_purchase_orders'),
  ('portal_company_members'),
  ('mkt_dual_write_log'),
  ('mkt_company_settings'),
  ('mkt_rfq_guest_claims')
) AS expected(tablename)
WHERE tablename IN (
  SELECT tablename FROM pg_tables WHERE schemaname = 'public'
)
ORDER BY tablename;" 2>&1

echo ""
echo "=== Enum marketplace kritis ==="
psql "$DEV_DIRECT" -c "
SELECT typname,
       '✅' AS status
FROM pg_type
WHERE typtype = 'e'
  AND typname IN (
    'mkt_rfq_status', 'mkt_rfq_priority', 'mkt_quote_status',
    'mkt_po_status', 'mkt_stock_status', 'mkt_claim_status',
    'mkt_dual_write_status', 'freight_service_category', 'user_role'
  )
ORDER BY typname;" 2>&1

echo ""
echo "=== Kolom portal_customer_id di mkt_rfqs (dari migration 0015) ==="
psql "$DEV_DIRECT" -t -c "
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'mkt_rfqs'
  AND column_name IN ('portal_customer_id','buyer_role','buyer_department','buyer_cost_center','buyer_approval_level')
ORDER BY column_name;" 2>&1
echo "(Harus ada: portal_customer_id, buyer_role, buyer_department, buyer_cost_center, buyer_approval_level)"
```

**Expected:** Semua 9 tabel marketplace terlist, semua enum ada, 5 kolom mkt_rfqs ada.

---

## STEP 9 — Verifikasi Data DEV Existing Tidak Berubah

Bandingkan dengan baseline yang dicatat di awal runbook.

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:$(printenv SUPABASE_DATABASE_URL_DEV | grep -oP '(?<=:)[^@]+(?=@)' | head -1)@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

echo "=== Row count tabel existing — bandingkan dengan baseline ==="
psql "$DEV_DIRECT" -c "
SELECT
  'sport_bookings'     AS tabel,   count(*) AS actual, 35  AS baseline,
  CASE WHEN count(*) = 35  THEN '✅' ELSE '❌ BERUBAH' END AS status
FROM sport_bookings
UNION ALL SELECT 'sport_payments',      count(*), 27,  CASE WHEN count(*) = 27  THEN '✅' ELSE '❌ BERUBAH' END FROM sport_payments
UNION ALL SELECT 'sport_facilities',    count(*), 8,   CASE WHEN count(*) = 8   THEN '✅' ELSE '❌ BERUBAH' END FROM sport_facilities
UNION ALL SELECT 'sport_members',       count(*), 8,   CASE WHEN count(*) = 8   THEN '✅' ELSE '❌ BERUBAH' END FROM sport_members
UNION ALL SELECT 'users',               count(*), 62,  CASE WHEN count(*) = 62  THEN '✅' ELSE '❌ BERUBAH' END FROM users
UNION ALL SELECT 'accounting_entries',  count(*), 100, CASE WHEN count(*) >= 100 THEN '✅' ELSE '❌ BERUBAH' END FROM accounting_entries
UNION ALL SELECT 'accounting_payments', count(*), 35,  CASE WHEN count(*) = 35  THEN '✅' ELSE '❌ BERUBAH' END FROM accounting_payments
UNION ALL SELECT 'companies',           count(*), 4,   CASE WHEN count(*) = 4   THEN '✅' ELSE '❌ BERUBAH' END FROM companies
UNION ALL SELECT 'portal_customers',    count(*), 8,   CASE WHEN count(*) >= 8  THEN '✅' ELSE '❌ BERUBAH' END FROM portal_customers
UNION ALL SELECT 'bank_disbursements',  count(*), 28,  CASE WHEN count(*) = 28  THEN '✅' ELSE '❌ BERUBAH' END FROM bank_disbursements
ORDER BY tabel;" 2>&1
```

**Expected:** Semua baris menunjukkan `✅`.

**STOP SEGERA jika:** ada baris `❌ BERUBAH`. Ini berarti data existing terdampak — rollback semua (lihat Step 11).

---

## STEP 9B — Seed Drizzle Migration Log

Setelah tabel restored, update `__drizzle_migrations` agar `pnpm migrate` tidak mencoba apply ulang migration 0013–0016.

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:$(printenv SUPABASE_DATABASE_URL_DEV | grep -oP '(?<=:)[^@]+(?=@)' | head -1)@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

echo "=== State drizzle migration sebelum seed ==="
psql "$DEV_DIRECT" -c "SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at;" 2>&1

echo ""
echo "=== Insert entries 0013-0016 ==="
psql "$DEV_DIRECT" << 'DRIZZSQL'
INSERT INTO __drizzle_migrations (hash, created_at)
VALUES
  ('0013_add_password_hash_to_users',     extract(epoch from now()) * 1000),
  ('0014_mkt_dual_write_log',             extract(epoch from now()) * 1000 + 1),
  ('0015_mkt_rfqs_buyer_identity',        extract(epoch from now()) * 1000 + 2),
  ('0016_portal_company_members',         extract(epoch from now()) * 1000 + 3)
ON CONFLICT DO NOTHING;
DRIZZSQL

echo ""
echo "=== Verifikasi semua 9 entries ada ==="
psql "$DEV_DIRECT" -c "SELECT id, hash FROM __drizzle_migrations ORDER BY created_at;" 2>&1
echo "(Harus ada: 5 lama + 4 baru = 9 total)"
```

---

## STEP 10 — Smoke Test API

**Tidak perlu restart** — tabel baru ditambah ke DB yang sudah running. API server tidak perlu restart untuk membaca schema baru. Namun, verifikasi endpoint marketplace yang sebelumnya mungkin return 500 karena tabel tidak ada.

```bash
BASE="https://$REPLIT_DEV_DOMAIN"

echo "=== Login sebagai admin ==="
curl -s -c /tmp/admin_cookies.txt -b /tmp/admin_cookies.txt \
  -X POST "$BASE/api/auth/dev-login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admcst001@gmail.com"}' \
  -w "\nHTTP %{http_code}" | tail -3

echo ""
echo "=== Dual-write stats (harus 200) ==="
curl -s -c /tmp/admin_cookies.txt -b /tmp/admin_cookies.txt \
  "$BASE/api/mkt/admin/dual-write/stats" \
  -w "\nHTTP %{http_code}" | tail -3

echo ""
echo "=== Dual-write integrity (harus 200) ==="
curl -s -c /tmp/admin_cookies.txt -b /tmp/admin_cookies.txt \
  "$BASE/api/mkt/admin/integrity" \
  -w "\nHTTP %{http_code}" | tail -3

echo ""
echo "=== Reliability summary (harus 200, reliabilityEnabled: true) ==="
curl -s -c /tmp/admin_cookies.txt -b /tmp/admin_cookies.txt \
  "$BASE/api/mkt/admin/reliability/summary" \
  -w "\nHTTP %{http_code}" | python3 -c "
import sys, json
lines = sys.stdin.read().split('\n')
http = lines[-1]
try:
  data = json.loads('\n'.join(lines[:-1]))
  print(f'reliabilityEnabled: {data.get(\"data\",{}).get(\"reliabilityEnabled\", \"N/A\")}')
except:
  pass
print(f'HTTP: {http}')
"

echo ""
echo "=== Health check umum (harus 200) ==="
curl -s "$BASE/api/health" -w "\nHTTP %{http_code}" | tail -3
```

**Expected:**
- Login: HTTP 200
- Semua endpoint: HTTP 200
- `reliabilityEnabled: true`
- Health: HTTP 200

**STOP jika:** ada endpoint yang return 500. Cek logs untuk error. Bisa jadi ada tabel yang masih missing atau FK yang belum resolved.

---

## STEP 11 — Rollback Plan

Karena Opsi B hanya **menambah objek baru**, rollback sesederhana DROP tabel yang baru dibuat.

### Rollback Enum (jika Step 4 perlu dibatalkan)

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:$(printenv SUPABASE_DATABASE_URL_DEV | grep -oP '(?<=:)[^@]+(?=@)' | head -1)@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

psql "$DEV_DIRECT" << 'ROLLBACK_ENUM'
DROP TYPE IF EXISTS public.freight_service_category CASCADE;
DROP TYPE IF EXISTS public.mkt_claim_status CASCADE;
DROP TYPE IF EXISTS public.mkt_po_status CASCADE;
DROP TYPE IF EXISTS public.mkt_quote_status CASCADE;
DROP TYPE IF EXISTS public.mkt_rfq_priority CASCADE;
DROP TYPE IF EXISTS public.mkt_rfq_status CASCADE;
DROP TYPE IF EXISTS public.mkt_stock_status CASCADE;
DROP TYPE IF EXISTS public.user_role CASCADE;
ROLLBACK_ENUM
```

### Rollback Tabel (jika Step 6 perlu dibatalkan)

```bash
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:$(printenv SUPABASE_DATABASE_URL_DEV | grep -oP '(?<=:)[^@]+(?=@)' | head -1)@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

psql "$DEV_DIRECT" << 'ROLLBACK_TABLES'
-- DROP dalam urutan terbalik dependency (FK-safe)
DROP TABLE IF EXISTS public.mkt_rfq_lines CASCADE;
DROP TABLE IF EXISTS public.mkt_vendor_quote_lines CASCADE;
DROP TABLE IF EXISTS public.mkt_vendor_quotes CASCADE;
DROP TABLE IF EXISTS public.mkt_rfq_guest_claims CASCADE;
DROP TABLE IF EXISTS public.mkt_purchase_orders CASCADE;
DROP TABLE IF EXISTS public.mkt_rfqs CASCADE;
DROP TABLE IF EXISTS public.portal_company_members CASCADE;
DROP TABLE IF EXISTS public.mkt_company_settings CASCADE;
DROP TABLE IF EXISTS public.air_freight_orders CASCADE;
DROP TABLE IF EXISTS public.air_freight_rfqs CASCADE;
DROP TABLE IF EXISTS public.ai_task_sync_log CASCADE;
DROP TABLE IF EXISTS public.bank_account_balances CASCADE;
DROP TABLE IF EXISTS public.bank_closing_periods CASCADE;
DROP TABLE IF EXISTS public.bank_coa_rules CASCADE;
DROP TABLE IF EXISTS public.bank_journal_entries CASCADE;
DROP TABLE IF EXISTS public.bank_recon_audit_logs CASCADE;
DROP TABLE IF EXISTS public.banners CASCADE;
DROP TABLE IF EXISTS public.blast_session_logs CASCADE;
DROP TABLE IF EXISTS public.cashier_shifts CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.cms_blocks CASCADE;
DROP TABLE IF EXISTS public.cms_media CASCADE;
DROP TABLE IF EXISTS public.cms_pages CASCADE;
DROP TABLE IF EXISTS public.cms_settings CASCADE;
DROP TABLE IF EXISTS public.company_modules CASCADE;
DROP TABLE IF EXISTS public.company_onboarding_sessions CASCADE;
DROP TABLE IF EXISTS public.conversation_test_cases CASCADE;
DROP TABLE IF EXISTS public.conversation_test_results CASCADE;
DROP TABLE IF EXISTS public.conversation_test_runs CASCADE;
DROP TABLE IF EXISTS public.customer_document_registry CASCADE;
DROP TABLE IF EXISTS public.customer_memory_events CASCADE;
DROP TABLE IF EXISTS public.customer_memory_snapshots CASCADE;
DROP TABLE IF EXISTS public.customer_preferences CASCADE;
DROP TABLE IF EXISTS public.customer_risk_assessments CASCADE;
DROP TABLE IF EXISTS public.draft_agreements_wa_log CASCADE;
DROP TABLE IF EXISTS public.driver_memory_snapshots CASCADE;
DROP TABLE IF EXISTS public.executive_refresh_logs CASCADE;
DROP TABLE IF EXISTS public.executive_summaries CASCADE;
DROP TABLE IF EXISTS public.fleet_cost_per_km CASCADE;
DROP TABLE IF EXISTS public.fleet_fuel_benchmarks CASCADE;
DROP TABLE IF EXISTS public.fleet_report_logs CASCADE;
DROP TABLE IF EXISTS public.fleet_risk_scores CASCADE;
DROP TABLE IF EXISTS public.fleet_route_profitability CASCADE;
DROP TABLE IF EXISTS public.fleet_tire_rotations CASCADE;
DROP TABLE IF EXISTS public.fleet_tires CASCADE;
DROP TABLE IF EXISTS public.fleet_utilization_logs CASCADE;
DROP TABLE IF EXISTS public.gym_memberships CASCADE;
DROP TABLE IF EXISTS public.hr_kasbon_installments CASCADE;
DROP TABLE IF EXISTS public.hr_kasbon CASCADE;
DROP TABLE IF EXISTS public.intel_customers CASCADE;
DROP TABLE IF EXISTS public.intel_profit CASCADE;
DROP TABLE IF EXISTS public.intel_quotations CASCADE;
DROP TABLE IF EXISTS public.intel_readiness_scores CASCADE;
DROP TABLE IF EXISTS public.intel_refresh_log CASCADE;
DROP TABLE IF EXISTS public.intel_routes CASCADE;
DROP TABLE IF EXISTS public.intel_vendors CASCADE;
DROP TABLE IF EXISTS public.logistic_purchase_requests CASCADE;
DROP TABLE IF EXISTS public.media_library CASCADE;
DROP TABLE IF EXISTS public.menu_items CASCADE;
DROP TABLE IF EXISTS public.menus CASCADE;
DROP TABLE IF EXISTS public.ocean_freight_rfqs CASCADE;
DROP TABLE IF EXISTS public.otp_tokens CASCADE;
DROP TABLE IF EXISTS public.page_products CASCADE;
DROP TABLE IF EXISTS public.page_sections CASCADE;
DROP TABLE IF EXISTS public.payment_receipts CASCADE;
DROP TABLE IF EXISTS public.posts CASCADE;
DROP TABLE IF EXISTS public.promo_registrations CASCADE;
DROP TABLE IF EXISTS public.purchasing_budget_tracker CASCADE;
DROP TABLE IF EXISTS public.purchasing_intel_signals CASCADE;
DROP TABLE IF EXISTS public.purchasing_price_benchmarks CASCADE;
DROP TABLE IF EXISTS public.purchasing_signals CASCADE;
DROP TABLE IF EXISTS public.quality_gate_results CASCADE;
DROP TABLE IF EXISTS public.quality_gate_runs CASCADE;
DROP TABLE IF EXISTS public.quality_gate_suites CASCADE;
DROP TABLE IF EXISTS public.sc_admin_notes CASCADE;
DROP TABLE IF EXISTS public.sc_blocked_schedules CASCADE;
DROP TABLE IF EXISTS public.sc_facility_images CASCADE;
DROP TABLE IF EXISTS public.sc_payments CASCADE;
DROP TABLE IF EXISTS public.sc_promos CASCADE;
DROP TABLE IF EXISTS public.sc_settings CASCADE;
DROP TABLE IF EXISTS public.site_settings CASCADE;
DROP TABLE IF EXISTS public.theme_settings CASCADE;
DROP TABLE IF EXISTS public.user_site_access CASCADE;
DROP TABLE IF EXISTS public.vendor_capabilities CASCADE;
DROP TABLE IF EXISTS public.vendor_contract_rates CASCADE;
DROP TABLE IF EXISTS public.vendor_document_registry CASCADE;
DROP TABLE IF EXISTS public.vendor_memory_events CASCADE;
DROP TABLE IF EXISTS public.vendor_memory_snapshots CASCADE;
DROP TABLE IF EXISTS public.vendor_performance_snapshots CASCADE;
DROP TABLE IF EXISTS public.vendor_preferences CASCADE;
DROP TABLE IF EXISTS public.vendor_recommendation_outcomes CASCADE;
DROP TABLE IF EXISTS public.vendor_recommendations CASCADE;
DROP TABLE IF EXISTS public.vendor_risk_assessments CASCADE;
DROP TABLE IF EXISTS public.wa_accounts CASCADE;
DROP TABLE IF EXISTS public.wa_api_keys CASCADE;
DROP TABLE IF EXISTS public.wa_devices CASCADE;
DROP TABLE IF EXISTS public.wa_messages CASCADE;
ROLLBACK_TABLES
```

### Rollback Drizzle Migration Log

```bash
psql "$DEV_DIRECT" -c "
DELETE FROM __drizzle_migrations
WHERE hash IN (
  '0013_add_password_hash_to_users',
  '0014_mkt_dual_write_log',
  '0015_mkt_rfqs_buyer_identity',
  '0016_portal_company_members'
);" 2>&1
```

### Verifikasi Rollback

```bash
echo "=== Tabel count setelah rollback (harus kembali ke 576) ==="
psql "$DEV_DIRECT" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';" 2>&1

echo "=== Data existing aman ==="
psql "$DEV_DIRECT" -t -c "
SELECT count(*) FROM sport_bookings;
SELECT count(*) FROM users;" 2>&1
```

---

## Ringkasan Urutan Eksekusi

```
Step 1  Pre-Check             → Semua koneksi OK, gap 97/8 confirmed
Step 2  Backup DEV            → /tmp/dev-data-backup-YYYYMMDD-HHMM.sql
Step 3  Install pg_dump 17    → nix-env -iA nixpkgs.postgresql_17
Step 4  Apply 8 enum → DEV    → /tmp/missing-enums.sql
Step 5  Dump 97 tabel ← PROD  → /tmp/prod-missing-tables-YYYYMMDD-HHMM.sql
Step 6  Restore schema → DEV  → psql --set ON_ERROR_STOP=0 -f dump.sql
Step 7  Verif table count     → DEV = PROD = 673
Step 8  Verif mkt tables      → mkt_rfqs, portal_company_members, dsb ✅
Step 9  Verif data existing   → Baseline counts match ✅
Step 9B Seed drizzle log      → 0013-0016 inserted ke __drizzle_migrations
Step 10 Smoke test API        → All endpoints 200, reliabilityEnabled: true
```

---

## Setelah Rebuild Selesai

Langkah yang bisa dilanjutkan (bukan bagian dari runbook ini, perlu approval terpisah):

1. **Jalankan migration 0015 + 0016 ke DEV** — keduanya idempotent, akan no-op karena tabel + kolom sudah ada dari schema dump PROD
2. **Test Phase 2C development di DEV** — `mkt_rfqs` sudah ada, 0015/0016 sudah applied
3. **Pertimbangkan PROD migration untuk 0015 + 0016** jika belum diapply ke PROD

---

*Runbook ini menggantikan langkah-langkah di `docs/dev-rebuild-plan-final.md` sebagai panduan eksekusi final.*
