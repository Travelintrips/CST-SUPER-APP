# Supabase Cleanup Phase 2 — Impact Analysis

**Dibuat**: 2026-06-23  
**Status**: DRAFT — code fixes sudah diterapkan; migration belum dieksekusi  
**Scope**: 7 tabel BLOCKED dari Phase 1 + fleet KEEP confirmation

---

## Ringkasan Eksekutif

| Tabel | Final Status | Kode Diubah | Archive Candidate |
|-------|-------------|-------------|-------------------|
| `shipment_stages` | 🔴 KEEP | Tidak | Tidak |
| `sport_center_bookings` | ✅ ARCHIVE | Ya | Ya |
| `sport_center_facilities` | ✅ ARCHIVE | Ya | Ya |
| `sc_payments` | ✅ ARCHIVE | Tidak | Ya |
| `sport_center_memberships` | 🟡 ARCHIVE | Ya | Ya |
| `workflow_events` | ✅ ARCHIVE | Ya | Ya |
| `transaction_datetime_normalized` | 🔴 KEEP | Tidak | Tidak |
| `fleet_partners` | 🔴 KEEP | Tidak | Tidak |
| `fleet_vehicles` | 🔴 KEEP | Tidak | Tidak |
| `fleet_ledger_entries` | 🔴 KEEP | Tidak | Tidak |
| `fleet_outstanding_import_log` | 🔴 KEEP | Tidak | Tidak |

---

## Detail Per Tabel

---

### 1. `shipment_stages` → 🔴 **KEEP**

**Temuan**: Tabel AKTIF — ini adalah tabel canonical untuk stage logistik, bukan legacy.

| File | Line | Jenis Referensi |
|------|------|-----------------|
| `lib/db/src/schema/shipmentStages.ts` | 11 | Drizzle schema (`shipmentStagesTable`) |
| `artifacts/api-server/src/routes/freight.ts` | 555 | `db.select().from(shipmentStagesTable)` — GET stages |
| `artifacts/api-server/src/routes/freight.ts` | 570–594 | `db.update/insert(shipmentStagesTable)` — POST stage upsert |
| `artifacts/api-server/src/lib/contextOrchestrator.ts` | 472–478 | Raw SQL `SELECT FROM shipment_stages` — context AI |

**Analisis**: `contextOrchestrator.ts:474` query ke `shipment_stages` adalah BENAR — bukan referensi ke tabel deprecated. `freight.ts` aktif INSERT/UPDATE ke tabel ini via Drizzle ORM. Tabel ini adalah satu-satunya stage store untuk `freight_shipments`.

**Tindakan**: Tidak ada perubahan. `shipment_stages` dipertahankan sebagai KEEP.  
**Catatan contextOrchestrator**: Query di L474 sudah benar dan tidak perlu diubah.

---

### 2. `sport_center_bookings` → ✅ **ARCHIVE** (code fix diterapkan)

**Referensi sebelum fix**:

| File | Line | Jenis Referensi | Status Setelah Fix |
|------|------|-----------------|-------------------|
| `supabaseSync.ts` | 382–401 | Fallback INSERT (client null) | ✅ Dihapus → skip + log |
| `supabaseSync.ts` | 528–540 | Bulk fallback INSERT (client null) | ✅ Dihapus → skip + log |
| `routes.ts` | 4753 | Sync fallback INSERT (client null) | ✅ Dihapus → skip + log |
| `migration.ts` | 434–464 | 3x ALTER TABLE + ADD CONSTRAINT | ✅ Dihapus |
| `migration.ts` | 334–399 | Legacy data migration (one-time) | ⚠️ Masih ada (guarded by IF EXISTS) |

**Analisis fallback**: Semua fallback menulis ke `sport_center_bookings` hanya saat Supabase client tidak tersedia. Data sudah ada di `sport_bookings` (tabel canonical, sumber dari sync). Menulis balik ke mirror lama tidak diperlukan.

**Analisis migration.ts:334**: Satu-satunya referensi yang tersisa adalah one-time migration yang sudah diproteksi dengan `IF EXISTS (table)` check. Jika tabel diarsip → bernama `zz_deleted_sport_center_bookings` → check `IF EXISTS` akan return false → migration block dilewati secara aman.

**Status**: ✅ Siap di-archive. Migration candidates SQL: `archive-phase-2-candidates.sql`.

---

### 3. `sport_center_facilities` → ✅ **ARCHIVE** (code fix diterapkan — termasuk 2 bug baru yang ditemukan)

**Referensi sebelum fix**:

| File | Line | Jenis Referensi | Status Setelah Fix |
|------|------|-----------------|-------------------|
| `supabaseSync.ts` | 246 | Supabase client → `.from("sport_center_facilities")` (public schema — BUG) | ✅ Diubah → `.schema("sport_center").from("facilities")` |
| `supabaseSync.ts` | 251 | Fallback UPDATE (client null) | ✅ Sudah benar → `UPDATE sport_facilities` |
| `routes.ts` | 4699 | Supabase client → `.from("sport_center_facilities")` (public schema — BUG) | ✅ Diubah → `.schema("sport_center").from("facilities")` |

**Analisis bug**: `supabaseSync.ts:246` dan `routes.ts:4699` memakai `.from("sport_center_facilities")` yang mengakses **public schema Supabase** — salah. Komentar di `supabaseSync.ts:306` sudah memperingatkan: "Must query sport_center.facilities (same schema as bookings FK target), NOT public.sport_center_facilities". Kedua baris sudah diperbaiki ke `.schema("sport_center").from("facilities")`.

**Fallback lokal** (client null) sudah benar — memakai `sport_facilities` (tabel lokal canonical).

**Status**: ✅ Siap di-archive.

---

### 4. `sc_payments` → ✅ **ARCHIVE** (tidak perlu code fix)

**Temuan**: Tidak ada SQL query ke tabel lokal `sc_payments` di seluruh codebase.

| File | Line | Jenis Referensi |
|------|------|-----------------|
| `routes.ts` | 4141, 4160 | Variabel `scPayments` (bukan tabel) — diisi dari Supabase `sport_center.payments` |
| `routes.ts` | 4935–4936 | Response key `supabase_sc_payments` (bukan tabel) |
| `supabaseSync.ts` | 748, 764 | Variabel `scPayments` (bukan tabel) |

**Analisis**: Semua referensi adalah **variabel lokal** dengan nama yang mirip, bukan query SQL ke tabel `sc_payments`. Akses ke payments dilakukan via Supabase client ke schema `sport_center.payments` (remote), bukan ke tabel lokal `public.sc_payments`.

**Status**: ✅ Siap di-archive segera — zero code dependency.

---

### 5. `sport_center_memberships` → 🟡 **ARCHIVE** (code fix diterapkan, perlu verifikasi data)

**Referensi sebelum fix**:

| File | Line | Jenis Referensi | Status Setelah Fix |
|------|------|-----------------|-------------------|
| `routes.ts` | 1349–1357 | UNION ALL SELECT (GET /members) | ✅ Dihapus |
| `routes.ts` | 1369–1371 | COUNT subquery | ✅ Dihapus |

**Analisis**: `sport_center_memberships` hanya dipakai sebagai sumber data READ di endpoint GET /members (UNION ALL dengan `sport_members`). Tidak ada write path. Data ini adalah legacy gym memberships sebelum migrasi ke `sport_members`.

**⚠️ Perhatian data**: Tidak ditemukan one-time migration dari `sport_center_memberships` → `sport_members` di `migration.ts`. Data lama di tabel ini mungkin belum di-migrate. Sebelum mengeksekusi archive:
1. Cek row count: `SELECT COUNT(*) FROM sport_center_memberships;`
2. Jika ada data → jalankan one-time migration INSERT ke `sport_members`
3. Verifikasi data terduplikasi dari phase 1 audit (phase 1 audit menunjukkan rows count untuk tabel ini)

**Status**: ✅ Code fix sudah diterapkan. Eksekusi archive setelah verifikasi data.

---

### 6. `workflow_events` → ✅ **ARCHIVE** (tidak perlu code fix)

**Temuan**: Tabel dibuat oleh boot migration tapi tidak pernah dipakai.

| File | Line | Jenis Referensi |
|------|------|-----------------|
| `artifacts/api-server/src/lib/phase1Migration.ts` | 9–30 | `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX` |

**Tidak ada** INSERT, SELECT, UPDATE, atau DELETE ke `workflow_events` di seluruh codebase — tabel dibuat sebagai infrastruktur yang belum diimplementasi.

**Perilaku setelah archive**: Boot migration menjalankan `CREATE TABLE IF NOT EXISTS workflow_events`. Setelah tabel diarsip (rename → `zz_deleted_workflow_events`), boot migration akan CREATE tabel baru yang kosong. Self-healing — tidak menyebabkan error.

**Rekomendasi**: Hapus juga CREATE TABLE dari `phase1Migration.ts` untuk kebersihan (opsional, tidak blocking).

**Status**: ✅ Siap di-archive segera.

---

### 7. `transaction_datetime_normalized` → 🔴 **KEEP**

**Temuan**: Inline migration v7 di `fleetIntelligence.ts:268–271` membuat tabel ini setiap boot (jika belum ada) + active DML.

| File | Line | Jenis Referensi |
|------|------|-----------------|
| `fleetIntelligence.ts` | 250 | Listed in v7 tables check |
| `fleetIntelligence.ts` | 268–271 | `CREATE TABLE` (inline migration) |
| `fleetIntelligence.ts` | 1115 | `DELETE FROM transaction_datetime_normalized WHERE report_id = ...` |
| `fleetIntelligence.ts` | 1166 | `DELETE FROM transaction_datetime_normalized WHERE company_id = ...` |

**Status**: KEEP — aktif dipakai oleh fleet intelligence module.

---

### 8–11. Fleet Tables → 🔴 **KEEP** (semua)

| Tabel | Referensi Aktif |
|-------|----------------|
| `fleet_partners` | `fleetIntelligence.ts` inline migration + CRUD routes (L737, L753, L771) + `fleetNotificationWorker.ts:35` |
| `fleet_vehicles` | `fleetIntelligence.ts` inline migration + CRUD routes (L2369, L2429) + `reconciliation.ts` FK JOIN |
| `fleet_ledger_entries` | `ledger.ts` CRUD, `reconciliation.ts` source of truth, `accounting.ts:490`, `financialClosingMigration.ts` period lock trigger |
| `fleet_outstanding_import_log` | `fleetIntelligence.ts` inline migration v14 + INSERT L3117 + SELECT L3144 |

---

## Code Changes Applied

### `artifacts/api-server/src/modules/sport-center/supabaseSync.ts`
| Lokasi | Perubahan |
|--------|-----------|
| L246 | `.from("sport_center_facilities")` (public schema BUG) → `.schema("sport_center").from("facilities")` |
| L251 | Fallback UPDATE (client null) → `UPDATE sport_facilities` (sudah benar sebelumnya) |
| L382–401 | Fallback INSERT `sport_center_bookings` → skip + log |
| L528–540 | Bulk fallback INSERT `sport_center_bookings` → skip + log |

### `artifacts/api-server/src/modules/sport-center/routes.ts`
| Lokasi | Perubahan |
|--------|-----------|
| L1345–1370 | Hapus UNION ALL branch `sport_center_memberships` dari GET /members |
| L1362–1372 | Sederhanakan COUNT query (hapus `+ COUNT(sport_center_memberships)`) |
| L4699 | `.from("sport_center_facilities")` (public schema BUG) → `.schema("sport_center").from("facilities")` |
| L4753 | Fallback INSERT `sport_center_bookings` → skip + log |

### `artifacts/api-server/src/modules/sport-center/migration.ts`
| Lokasi | Perubahan |
|--------|-----------|
| L433–464 | Hapus 3x ALTER TABLE `sport_center_bookings` + ADD CONSTRAINT block |

---

## Archive Execution Order

Gunakan `migrations/archive-phase-2-candidates.sql`. Eksekusi berurutan:

```
1. sc_payments             ← zero dependencies, safe immediately
2. workflow_events         ← zero dependencies, safe immediately
3. sport_center_facilities ← code fix sudah diterapkan
4. sport_center_bookings   ← code fix sudah diterapkan
5. sport_center_memberships ← verifikasi data migration ke sport_members dulu
```

---

## Pre-Execution Checklist

- [ ] `SELECT COUNT(*) FROM sc_payments;` — harus 0
- [ ] `SELECT COUNT(*) FROM workflow_events;` — catat jumlah (kemungkinan 0)
- [ ] `SELECT COUNT(*) FROM sport_center_facilities;` — harus 0
- [ ] `SELECT COUNT(*) FROM sport_center_bookings;` — catat jumlah
- [ ] `SELECT COUNT(*) FROM sport_center_memberships;` — jika > 0, migrate ke `sport_members` dulu
- [ ] API Server restart setelah code changes (sudah: migration.ts + supabaseSync.ts + routes.ts)
- [ ] Verifikasi GET /api/sport-center/members masih berfungsi setelah UNION ALL removal
- [ ] pg_dump production sebelum eksekusi migration
