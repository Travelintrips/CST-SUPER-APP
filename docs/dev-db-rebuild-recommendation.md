# Rekomendasi: Rebuild DEV Database dari PROD Schema Dump

**Tanggal:** 2026-07-02  
**Status:** REKOMENDASI — belum dieksekusi, butuh persetujuan eksplisit  
**Konteks:** DEV DB tertinggal 83 tabel dari PROD. Setelah migration 0014 diapply hari ini, blocker `mkt_dual_write_log` sudah selesai. Namun DEV masih tidak memiliki schema marketplace, fleet, intel, CMS, WA stack, dan lain-lain.

---

## Kenapa Perlu Rebuild

| Kondisi | Dampak |
|---------|--------|
| `mkt_rfqs`, `mkt_rfq_lines`, `portal_company_members` tidak ada di DEV | Migration 0015/0016 tidak bisa dijalankan ke DEV |
| 83 tabel PROD tidak ada di DEV | Tidak bisa test fitur marketplace, fleet, dsb di dev environment |
| Drizzle migration log hanya 0000–0003 di kedua DB | `pnpm migrate` akan mencoba apply ulang 0013–0016 yang sudah jalan |
| Schema drift semakin lebar setiap sprint | Setiap migration baru perlu workaround DEV sendiri |

**Melanjutkan patching incremental berisiko:** setiap kali ada migration baru yang punya FK ke tabel yang hanya ada di PROD, DEV akan gagal lagi.

---

## Opsi yang Tersedia

### Opsi A — Fresh DEV Supabase Project (DIREKOMENDASIKAN)

Buat project Supabase baru, apply schema dump PROD ke sana, ganti `SUPABASE_DATABASE_URL_DEV`.

**Keuntungan:**
- Schema DEV = PROD sejak hari pertama
- Tidak ada data lama yang bisa bertabrakan
- Clean slate: bisa set up fixture/seed data dengan benar
- Drizzle migration log bisa diset dengan benar dari awal

**Risiko:**
- Data dev yang ada di DEV sekarang hilang (user test accounts, sport center bookings dev, dsb)
- Harus update `SUPABASE_DATABASE_URL_DEV` + `SUPABASE_URL_DEV` di env
- Boot migrations akan create ulang semua tabel — perlu verifikasi tidak ada conflict dengan schema dump

**Estimasi effort:** ~2-3 jam (dump, apply, verifikasi, ganti env, smoke test)

---

### Opsi B — Schema Dump PROD → Apply ke DEV yang Ada (RISIKO TINGGI)

Dump schema PROD, apply ke DEV yang sekarang. DEV sudah punya ~40 tabel — bisa ada conflict.

**Masalah:**
- ERP tables di DEV punya data dev aktif (booking sport center, dsb) — schema dump PROD mungkin ALTER tabel yang ada, bisa corrupt data
- Supabase auth schema (auth.*) tidak boleh di-dump dari PROD ke DEV — mereka punya project-level config berbeda
- Beberapa tabel DEV punya data yang PROD tidak punya (e.g. `mkt_dual_write_log` baru diapply ke PROD hari ini tapi kosong)
- Boot migrations akan conflict dengan schema dump

**Tidak direkomendasikan** kecuali ada kebutuhan spesifik untuk mempertahankan data DEV.

---

### Opsi C — Biarkan DEV Partial (STATUS QUO)

Gunakan PROD untuk testing fitur marketplace/new features, DEV hanya untuk ERP core.

**Keuntungan:** Tidak perlu action sekarang.

**Risiko:** Drift akan semakin jauh. Setiap sprint yang add migration baru ke PROD butuh manual patching ke DEV. Tech debt ini akan terus bertumbuh.

---

## Langkah Eksekusi Opsi A (Fresh DEV Project)

### Persiapan

```bash
# 1. Backup data dev yang penting (sport center bookings, users dev, dsb)
PROD_URL="postgresql://postgres.nzdweipzckfszczzqtuw:AnTXXOl0t1ArQOEU@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"
DEV_DIRECT="postgresql://postgres.xssrfshdrtdfupgqwfdw:nvVEWjiHruxen4cE@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

# Backup tables DEV yang punya data aktif
pg_dump "$DEV_DIRECT" \
  --schema=public \
  --data-only \
  --table=sport_bookings \
  --table=sport_fields \
  --table=sport_members \
  --table=users \
  -f /tmp/dev-data-backup-$(date +%Y%m%d).sql
```

### Dump Schema dari PROD

```bash
# Dump SCHEMA ONLY dari PROD (tidak include data, tidak include auth schema)
pg_dump "$PROD_URL" \
  --schema=public \
  --schema-only \
  --no-owner \
  --no-acl \
  -f /tmp/prod-schema-$(date +%Y%m%d).sql

# Verifikasi ukuran dump
wc -l /tmp/prod-schema-*.sql
```

### Buat Project Supabase DEV Baru

1. Login ke [supabase.com/dashboard](https://supabase.com/dashboard)
2. New Project → pilih region `ap-southeast-2` (sama dengan PROD)
3. Catat: project ref, DB password, API URL
4. Tunggu project ready (~2 menit)

### Apply Schema ke DEV Baru

```bash
NEW_DEV_URL="postgresql://postgres.<new-project-ref>:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"

# Apply PROD schema ke DEV baru
psql "$NEW_DEV_URL" -f /tmp/prod-schema-YYYYMMDD.sql 2>&1 | tee /tmp/schema-apply.log

# Cek error
grep -i "error" /tmp/schema-apply.log | grep -v "NOTICE"
```

### Update Environment Variables

```bash
# Ganti di Replit environment:
# SUPABASE_DATABASE_URL_DEV → URL baru dengan port 6543 (pgBouncer)
# SUPABASE_URL_DEV → https://<new-project-ref>.supabase.co
# SUPABASE_ANON_KEY_DEV → anon key project baru (dari Supabase dashboard)
# SUPABASE_SERVICE_ROLE_KEY_DEV → service role key project baru
```

### Verifikasi Post-Apply

```bash
# Hitung tabel di DEV baru — harus mendekati jumlah PROD
psql "$NEW_DEV_URL" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"

# Bandingkan dengan PROD
psql "$PROD_URL" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"

# Verifikasi tabel kritis ada
psql "$NEW_DEV_URL" -c "
SELECT tablename FROM pg_tables
WHERE schemaname='public'
  AND tablename IN ('mkt_rfqs','mkt_rfq_lines','portal_company_members','mkt_dual_write_log','portal_customers')
ORDER BY tablename;
"
```

### Restart dan Smoke Test

```bash
# Setelah env vars diupdate, restart gateway
# Cek API health
curl -s https://$REPLIT_DEV_DOMAIN/api/health
```

---

## Catatan Penting

1. **Auth schema tidak di-dump.** `auth.*` tables (Supabase managed) tidak termasuk dalam schema dump. User yang register di DEV lama tidak akan ada di DEV baru — ini expected behavior.

2. **Boot migrations akan jalan ulang.** Saat API server start dengan DEV baru, boot migrations akan try to create tables yang sudah ada (dari schema dump). Semua boot migration sudah `IF NOT EXISTS` — ini aman.

3. **Drizzle migration log perlu di-seed.** Setelah schema apply, insert rows ke `drizzle.__drizzle_migrations` untuk merepresentasikan state yang sudah applied. Kalau tidak, `pnpm migrate` akan coba apply dari 0000 dan gagal karena tabel sudah ada.

4. **`mkt_dual_write_log` sudah ada di PROD schema dump.** Migration 0014 yang baru saja diapply hari ini sudah include di schema dump. DEV baru tidak perlu patching tambahan.

5. **Jangan lupa update `SUPABASE_URL_DEV`** (bukan hanya `DATABASE_URL_DEV`). File `supabaseAdminSportCenter.ts` dan `ocrTempCleanup.ts` pakai `SUPABASE_URL_DEV` untuk Supabase JS client.

---

## Estimasi Waktu

| Langkah | Estimasi |
|---------|----------|
| Backup data DEV | 5 menit |
| Dump schema PROD | 2 menit |
| Setup project Supabase baru | 10 menit |
| Apply schema | 5 menit |
| Update env vars | 5 menit |
| Verifikasi + smoke test | 30 menit |
| **Total** | **~1 jam** |

---

## Keputusan yang Dibutuhkan

Sebelum eksekusi, perlu jawaban:

1. **Data DEV yang mana yang perlu dipreserve?** (sport bookings, test users, dsb — atau tidak perlu?)
2. **Apakah DEV Supabase project baru atau replace yang lama?** (replace = project ref berubah, semua storage/auth dev hilang)
3. **Kapan waktu yang aman?** (rebuild ini akan membuat DEV offline beberapa menit)
