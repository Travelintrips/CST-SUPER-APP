# KEEP ARCHIVED Resolution — Phase 1 & Phase 2

**Tanggal**: 2026-06-23  
**Referensi**: `docs/supabase-final-cleanup-audit.md`  
**Status Eksekusi**: Cleanup kode sudah dijalankan; SQL TIDAK dieksekusi otomatis

---

## Ringkasan Status

| Tabel | Status Awal | Status Sekarang | Tindakan |
|---|---|---|---|
| `workflow_events` | KEEP ARCHIVED (cleanup kode) | ✅ **RESOLVED** | Kode dihapus; tabel tidak ada di DB |
| `sport_center_memberships` | KEEP ARCHIVED (verifikasi data) | 🟡 **SAFE AFTER 30 DAYS** | Tabel tidak ada di DB, row count = 0 |
| `sport_center_bookings` | KEEP ARCHIVED (cooling period) | 🟡 **COOLING PERIOD** | Tabel tidak ada di DB; batas akhir 2026-07-23 |

---

## 1. `workflow_events` — ✅ RESOLVED

### Temuan DB
```sql
SELECT COUNT(*) FROM information_schema.tables
WHERE table_name = 'workflow_events';
-- Result: 0 — tabel tidak ada di DB manapun (public, sport_center, dll.)
```

Tabel tidak pernah ada di DB production atau sudah dihilangkan sebelumnya. `phase1Migration.ts` yang recreate tabel ini pada setiap boot sudah dihapus.

### Perubahan Kode yang Dilakukan (2026-06-23)

| File | Perubahan | Status |
|---|---|---|
| `lib/db/src/schema/workflowEvents.ts` | **File dihapus** seluruhnya | ✅ Done |
| `lib/db/src/schema/index.ts` | Hapus `export * from "./workflowEvents"` (baris 75) | ✅ Done |
| `artifacts/api-server/src/lib/phase1Migration.ts` | Hapus blok `CREATE TABLE IF NOT EXISTS workflow_events` (lines 8–30) dan `CREATE INDEX workflow_events_status_idx` | ✅ Done |
| `artifacts/api-server/src/lib/phase1Migration.ts` | Update log message — hapus mention `workflow_events` | ✅ Done |

### Verifikasi
```bash
grep -rn "workflowEventsTable\|workflow_events" artifacts/ lib/ \
  --include="*.ts" --include="*.tsx" --include="*.mjs" \
  | grep -v "phase1Migration\|next-release\|cleanup\|audit"
# Result: 0 baris — bersih
```

### Status Akhir
- **Kode**: ✅ Bersih — tidak ada schema, tidak ada export, tidak ada boot migration
- **DB**: ✅ Tabel tidak ada — tidak perlu DROP
- **Referensi aktif**: 0
- **Tindakan selanjutnya**: Tidak ada — SELESAI

---

## 2. `sport_center_memberships` — 🟡 SAFE AFTER 30 DAYS

### Temuan DB
```sql
-- Cek di semua schema:
SELECT table_schema, table_name FROM information_schema.tables
WHERE table_name IN ('sport_center_memberships', 'zz_deleted_sport_center_memberships');
-- Result: 0 baris — tabel tidak ada di DB manapun
```

**Tabel tidak ada** di semua schema (public, sport_center, dll.). Tidak ada data yang perlu dimigrasikan ke `sport_members`.

### Analisis

- Tidak ada referensi kode aktif ke `sport_center_memberships`
- Tidak ada Drizzle schema untuk tabel ini
- Tidak ada data di DB (tabel tidak ada)
- Tabel `sport_members` sudah aktif dan berfungsi sebagai pengganti

### Status Akhir
- **Kode**: ✅ Bersih — tidak ada referensi aktif
- **DB**: ✅ Tabel tidak ada — tidak perlu DROP atau migrasi data
- **Tindakan selanjutnya**: Marking otomatis sebagai SAFE setelah 30 hari (batas: **2026-07-23**)
- **Tindakan yang perlu dilakukan**: Tidak ada — hapus entry ini dari tracking setelah 2026-07-23

---

## 3. `sport_center_bookings` — 🟡 COOLING PERIOD (batas: 2026-07-23)

### Temuan DB
```sql
SELECT table_schema, table_name FROM information_schema.tables
WHERE table_name IN ('sport_center_bookings', 'zz_deleted_sport_center_bookings');
-- Result: 0 baris — tabel tidak ada di DB manapun
```

**Tabel tidak ada** di semua schema. Data booking lama tidak ada. Tabel aktif adalah `sport_bookings`.

### Status Kode

| File | Referensi | Status |
|---|---|---|
| `artifacts/api-server/src/modules/sport-center/migration.ts` baris 334 | Conditional block dengan `IF EXISTS` guard | ✅ Aman — block dilewati otomatis jika tabel tidak ada |

Tidak ada perubahan kode yang diperlukan untuk tabel ini.

### Status Akhir
- **Kode**: ✅ Bersih — satu referensi dilindungi IF EXISTS guard
- **DB**: ✅ Tabel tidak ada — tidak perlu DROP atau migrasi data
- **Cooling period**: Berakhir **2026-07-23**
- **Tindakan selanjutnya**: Setelah 2026-07-23, konfirmasi tidak ada keluhan data hilang → hapus entry dari tracking

---

## Checklist Pre-Restart (workflow_events)

Setelah cleanup kode `workflow_events`, pastikan API Server dapat restart tanpa error:

- [ ] `pnpm build` di `artifacts/api-server/` tidak ada TypeScript error terkait `workflowEventsTable`
- [ ] API Server restart sukses tanpa error di log `phase1Migration`
- [ ] Log startup menampilkan: `"Phase 1 migration: ok (intelligence_alerts, order_stage_logs, new columns)"`
- [ ] Tidak ada `Cannot find module './workflowEvents'` di log

---

## SQL Verifikasi (jalankan manual untuk konfirmasi)

```sql
-- Konfirmasi workflow_events tidak ada:
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name='workflow_events';
-- Expected: 0 rows

-- Konfirmasi indexes workflow_events tidak ada:
SELECT indexname FROM pg_indexes
WHERE tablename='workflow_events';
-- Expected: 0 rows

-- Konfirmasi tabel pengganti sport_members aktif:
SELECT COUNT(*) FROM sport_members;
-- Expected: angka >= 0 (tabel ada dan sehat)

-- Konfirmasi tabel pengganti sport_bookings aktif:
SELECT COUNT(*) FROM sport_bookings;
-- Expected: angka >= 0 (tabel ada dan sehat)
```

---

## Update ke Final Audit

`docs/supabase-final-cleanup-audit.md` perlu update:

- `workflow_events`: KEEP ARCHIVED → **RESOLVED** (kode sudah bersih, tabel tidak ada di DB)
- `sport_center_memberships`: KEEP ARCHIVED → **SAFE AFTER 30 DAYS** (tidak ada data, tidak ada tabel)
- `sport_center_bookings`: KEEP ARCHIVED → **COOLING PERIOD** (tabel tidak ada di DB, tunggu 2026-07-23)

Lihat `migrations/resolve-keep-archived.sql` untuk SQL idempotent jika diperlukan eksekusi manual.
