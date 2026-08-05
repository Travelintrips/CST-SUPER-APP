# DB DEV/PROD Safety Guide

**Dibuat**: 2026-06-23  
**Tujuan**: Memastikan semua refactor tabel dilakukan aman di DEV terlebih dahulu, lalu PROD setelah tervalidasi.

---

## 1. Aturan Environment

| Environment | URL Wajib | URL Dilarang |
|-------------|-----------|--------------|
| `development` | `SUPABASE_DATABASE_URL_DEV` | `SUPABASE_DATABASE_URL` (PROD) |
| `production` | `SUPABASE_DATABASE_URL` | `SUPABASE_DATABASE_URL_DEV` |

### Env Vars per Environment

**DEV:**
```
SUPABASE_DATABASE_URL_DEV    = postgres://postgres.<dev-ref>:...@...
SUPABASE_URL_DEV             = https://<dev-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY_DEV
SUPABASE_ANON_KEY_DEV
```

**PROD:**
```
SUPABASE_DATABASE_URL        = postgres://postgres.nzdweipzckfszczzqtuw:...@...
SUPABASE_URL                 = https://nzdweipzckfszczzqtuw.supabase.co
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
```

---

## 2. Guard yang Dipasang

### `artifacts/api-server/src/lib/envGuard.ts`

Dipanggil saat startup API server dan saat menjalankan migration script. Guard:

1. **Extract project ref** dari URL koneksi aktif
2. **Log project ref** di startup (terlihat di console)
3. **Throw** jika `NODE_ENV=development` + URL mengarah ke PROD ref + `SUPABASE_DATABASE_URL_DEV` sudah di-set
4. **Warn** jika dev menggunakan shared PROD DB (karena belum punya DB DEV terpisah)
5. **Throw** jika `NODE_ENV=production` + URL kosong

### `lib/db/src/index.ts` (kandidat URL)

| Mode | Kandidat (urut prioritas) |
|------|--------------------------|
| DEV | `SUPABASE_DATABASE_URL_DEV` → `SUPABASE_DATABASE_URL` (warn) → `DATABASE_URL` |
| PROD | `SUPABASE_DATABASE_URL` → `DATABASE_URL` → `SUPABASE_PG_URL` |

**Catatan**: `SUPABASE_DATABASE_URL_DEV` dihapus dari kandidat PROD agar prod tidak pernah fallback ke dev.

---

## 3. Verify Commands

```bash
# Verifikasi target DEV sebelum migration
npm run db:verify:dev

# Verifikasi target PROD sebelum migration
npm run db:verify:prod
```

Output contoh:
```
============================================================
[verify-db] Target env  : development
[verify-db] URL source  : SUPABASE_DATABASE_URL_DEV
[verify-db] URL (masked): postgresql://***@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres
[verify-db] Project ref : <dev-ref>
[verify-db] Is PROD ref : false (PROD ref: nzdweipzckfszczzqtuw)
============================================================
[verify-db] Koneksi OK
[verify-db]   database : postgres
[verify-db]   user     : postgres
[verify-db]   pg ver   : PostgreSQL 15
============================================================
[verify-db] ✓ Target DEVELOPMENT DB terverifikasi.
[verify-db] Aman untuk melanjutkan migration pada target ini.
============================================================
```

---

## 4. Urutan Eksekusi Migration yang Aman

```
1. DEV DULU
   ├─ npm run db:verify:dev          ← pastikan target benar
   ├─ psql "$SUPABASE_DATABASE_URL_DEV" -f migrations/<file>.sql
   └─ smoke test manual / automated

2. BACKUP PROD
   └─ pg_dump "$SUPABASE_DATABASE_URL" > backups/prod_$(date +%Y%m%d_%H%M%S).dump

3. PROD (maintenance window)
   ├─ npm run db:verify:prod          ← pastikan target benar
   ├─ psql "$SUPABASE_DATABASE_URL" -f migrations/<file>.sql
   └─ monitor 7 hari → jika error jalankan rollback

4. ROLLBACK (jika perlu)
   └─ psql "$SUPABASE_DATABASE_URL" -f migrations/<file>-rollback.sql
```

---

## 5. Referensi Project

| Env | Project Ref | Host |
|-----|-------------|------|
| PROD (BizPortal) | `nzdweipzckfszczzqtuw` | `aws-1-ap-southeast-2.pooler.supabase.com:6543` |
| DEV (jika ada) | *(sesuai SUPABASE_DATABASE_URL_DEV)* | *(sesuai URL)* |
| Sport Center | `xssrfshdrtdfupgqwfdw` | `xssrfshdrtdfupgqwfdw.supabase.co` |

**Catatan**: Sport Center Supabase adalah project terpisah yang diakses via `supabaseAdminSportCenter.ts`, **bukan** untuk ERP tables.

---

## 6. FAQ

**Q: Saat ini dev dan prod menggunakan DB yang sama. Apa yang terjadi?**  
A: Guard akan WARN (bukan throw) karena `SUPABASE_DATABASE_URL_DEV` belum di-set. Ini adalah _shared-DB mode_. Migration tetap harus diuji di dev environment (bisa pakai schema terpisah atau branch Supabase).

**Q: Bagaimana setup DB DEV terpisah?**  
A: Buat project baru di Supabase → copy schema dari prod → set `SUPABASE_DATABASE_URL_DEV` di env → `npm run db:verify:dev`.

**Q: Bagaimana cara pastikan saya tidak salah target saat migration?**  
A: Selalu jalankan `npm run db:verify:dev` atau `db:verify:prod` sebelum `psql ... -f migration.sql`. Script akan exit dengan code 1 jika target salah.
