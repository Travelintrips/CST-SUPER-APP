# Migration Plan: 0013–0016 — Safe Application Guide

**Tanggal:** 2026-07-02  
**Status:** DRAFT — belum dieksekusi  
**Author:** Audit run

---

## Ringkasan Temuan

| Migration | DEV | PROD | Action |
|-----------|-----|------|--------|
| 0013 `users.password_hash` | ✅ Applied (via boot) | ✅ Applied (via boot) | Tidak perlu action. Sudah idempotent. |
| 0014 `mkt_dual_write_log` | ⚠️ Partial (7 kolom hilang, status=TEXT) | ❌ MISSING | Jalankan ke DEV + PROD |
| 0015 `mkt_rfqs_buyer_identity` | ❌ N/A (mkt_rfqs tidak ada di DEV) | ✅ Applied | Jalankan ke DEV setelah mkt_rfqs ada |
| 0016 `portal_company_members` | ❌ Missing | ✅ Applied | Jalankan ke DEV setelah dependencies ada |

---

## Kondisi Saat Ini

### DEV DB
- `mkt_dual_write_log` **ADA** tapi schema lawas (Phase 2A.1 boot migration):
  - Kolom hilang: `buyer_name`, `buyer_company`, `qty`, `unit`, `shipping_address`, `retry_started_at`, `retry_completed_at`
  - `status` column: TEXT (bukan enum `mkt_dual_write_status`)
  - Enum `mkt_dual_write_status` belum dibuat
- `mkt_rfqs` **TIDAK ADA** (DEV tertinggal ~83 tabel dari PROD)
- `portal_company_members` **TIDAK ADA**

### PROD DB
- `mkt_dual_write_log` **TIDAK ADA**
- `mkt_rfqs` ✅ ada, lengkap (termasuk 0015 dan 0016 columns)
- `portal_company_members` ✅ ada

---

## Migration 0014: `mkt_dual_write_log`

### File
`lib/db/drizzle/0014_mkt_dual_write_log.sql`

### PROD — Action Required: CREATE TABLE

Migration ini idempotent. Aman dijalankan.

```bash
# PROD
psql "$SUPABASE_DATABASE_URL" -f lib/db/drizzle/0014_mkt_dual_write_log.sql
```

Apa yang terjadi di PROD:
1. Enum `mkt_dual_write_status` dibuat (baru)
2. Tabel `mkt_dual_write_log` dibuat dengan semua kolom
3. ALTER TABLE blocks → no-op (kolom sudah ada di CREATE TABLE)
4. Status TEXT → enum migration → no-op (kolom baru sudah enum)
5. 5 index dibuat

### DEV — Action Required: ALTER TABLE (schema upgrade)

```bash
# DEV
psql "$SUPABASE_DATABASE_URL_DEV" -f lib/db/drizzle/0014_mkt_dual_write_log.sql
```

Apa yang terjadi di DEV:
1. Enum `mkt_dual_write_status` dibuat (baru)
2. CREATE TABLE IF NOT EXISTS → no-op (tabel sudah ada)
3. ALTER TABLE ADD COLUMN IF NOT EXISTS → menambah 7 kolom yang hilang
4. Step 4 (DO $$): detect `status` = TEXT → migrate ke enum `mkt_dual_write_status`
5. 5 index dibuat (IF NOT EXISTS → aman)

### Verifikasi Setelah Run

```sql
-- Cek tabel dan kolom lengkap
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'mkt_dual_write_log' AND table_schema = 'public'
ORDER BY ordinal_position;

-- Cek enum ada
SELECT typname FROM pg_type WHERE typname = 'mkt_dual_write_status';

-- Cek index
SELECT indexname FROM pg_indexes WHERE tablename = 'mkt_dual_write_log';
```

Expected: 20 kolom, enum ada, 5 index (mdwl_status_idx, mdwl_mkt_rfq_id_idx, mdwl_created_at_idx, mdwl_portal_order_id_idx, mdwl_buyer_email_idx).

---

## Migration 0015: `mkt_rfqs_buyer_identity`

### File
`lib/db/drizzle/0015_mkt_rfqs_buyer_identity.sql`

### PROD — Sudah Applied
Kolom `portal_customer_id` sudah ada di `mkt_rfqs`. **Tidak perlu action.**

### DEV — Blocked: `mkt_rfqs` tidak ada
Migration 0015 membutuhkan tabel `mkt_rfqs` yang tidak ada di DEV.

**DEV sangat tertinggal dari PROD (~83 tabel hilang).** Untuk sinkronisasi DEV butuh schema dump dari PROD yang terpisah dari scope migration ini.

**Rekomendasi:** Jangan jalankan 0015 ke DEV sampai ada keputusan explicit soal sinkronisasi DEV DB. Gunakan PROD untuk testing fitur marketplace baru.

---

## Migration 0016: `portal_company_members`

### File
`lib/db/drizzle/0016_portal_company_members.sql`

### PROD — Sudah Applied
Tabel `portal_company_members` sudah ada. Kolom buyer_role/department/cost_center/approval_level sudah ada di `mkt_rfqs`. **Tidak perlu action.**

### DEV — Blocked: `portal_customers` ada, tapi `mkt_rfqs` tidak ada
- Step 1 (CREATE TABLE portal_company_members): bisa jalan (portal_customers ada di DEV)
- Step 2 (ALTER TABLE mkt_rfqs): **akan GAGAL** karena mkt_rfqs tidak ada

**Rekomendasi:** Jangan jalankan 0016 ke DEV sampai mkt_rfqs ada.

---

## Action Checklist

### IMMEDIATE — PROD

```bash
# 1. Backup check: pastikan ada recent backup
# 2. Test koneksi
psql "$SUPABASE_DATABASE_URL" -c "SELECT current_database();"

# 3. Jalankan 0014 (SATU-SATUNYA migration yang perlu dijalankan ke PROD)
psql "$SUPABASE_DATABASE_URL" -f lib/db/drizzle/0014_mkt_dual_write_log.sql

# 4. Verifikasi
psql "$SUPABASE_DATABASE_URL" -c "
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_name = 'mkt_dual_write_log' AND table_schema = 'public'
  ORDER BY ordinal_position;
"
```

### IMMEDIATE — DEV

```bash
# Jalankan 0014 (upgrade schema partial → full)
psql "$SUPABASE_DATABASE_URL_DEV" -f lib/db/drizzle/0014_mkt_dual_write_log.sql
```

### DEFERRED — DEV Schema Sync

DEV tertinggal sangat jauh dari PROD (83 tabel). Butuh keputusan terpisah:
- Option A: Dump schema dari PROD → apply ke DEV (risiko: data test ikut)
- Option B: Buat DEV Supabase project baru dari scratch dengan schema terkini
- Option C: Biarkan DEV sebagai "partial env" dan gunakan PROD untuk testing fitur baru

**Rekomendasi: Option B** — buat DEV project baru. Schema drift sudah terlalu jauh untuk di-patch incremental.

---

## Catatan Penting

1. **Jangan gunakan boot migration** untuk tabel baru. Semua DDL harus via file SQL resmi di `lib/db/drizzle/`.
2. Migration 0013–0016 **belum masuk drizzle migration log** (`drizzle.__drizzle_migrations`). Ini artinya `pnpm migrate` tidak tahu mereka sudah ada. Jika `pnpm migrate` dijalankan, drizzle akan mencoba apply ulang. Pastikan semua migration file bersifat idempotent (sudah `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
3. Setelah migration dijalankan manual, pertimbangkan insert manual ke `drizzle.__drizzle_migrations` untuk sinkronisasi state tracker.
