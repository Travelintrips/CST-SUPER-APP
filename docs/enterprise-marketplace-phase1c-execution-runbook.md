# Enterprise Marketplace — Phase 1C Execution Runbook

**Status:** Phase 1C Migration Completed — 2026-07-02
**Tanggal dibuat:** 2026-07-02
**Tanggal eksekusi:** 2026-07-02
**Referensi:**
- `docs/enterprise-marketplace-blueprint-v1.1.1.md`
- `migrations/enterprise-marketplace-p0.review.sql`
- `migrations/enterprise-marketplace-p0-rollback.sql`
- Schema source: `lib/db/src/schema/mktRfqs.ts`, `mktRfqLines.ts`, `mktVendorQuotes.ts`, `mktVendorQuoteLines.ts`, `mktPurchaseOrders.ts`, `mktRfqGuestClaims.ts`, `mktCompanySettings.ts`

> Dokumen ini adalah **runbook manual** — berisi instruksi langkah demi langkah untuk operator yang akan mengeksekusi migration secara manual di kemudian hari. **Tidak ada SQL yang dieksekusi, tidak ada koneksi DB yang dibuka, dan tidak ada kode yang diubah saat membuat dokumen ini.**

---

## ⚠️ WARNING BESAR — BACA SEBELUM EKSEKUSI

```
╔══════════════════════════════════════════════════════════════════════════╗
║ 1. ALTER TYPE ... ADD VALUE HARUS DIJALANKAN DI LUAR TRANSACTION BLOCK.   ║
║    PostgreSQL melarang ALTER TYPE ADD VALUE di dalam transaksi yang      ║
║    sama dengan statement lain. Jalankan sebagai statement TUNGGAL,       ║
║    TERPISAH, dengan autocommit ON.                                       ║
║                                                                            ║
║ 2. ENUM VALUE 'marketplace_commission' PADA accounting_entry_source      ║
║    TIDAK BISA DIHAPUS SAAT ROLLBACK. PostgreSQL tidak mendukung DROP     ║
║    VALUE dari enum. Sekali ditambahkan, value ini permanen ada di        ║
║    enum type — rollback hanya bisa memastikan value ini TIDAK DIPAKAI    ║
║    oleh data manapun, bukan menghapusnya.                                ║
║                                                                            ║
║ 3. JANGAN JALANKAN MIGRATION INI LEWAT `drizzle-kit push` ATAU           ║
║    `drizzle-kit push --force`. Proses ini murni manual SQL via psql      ║
║    session pooler. drizzle-kit push bisa membuat keputusan schema-diff   ║
║    otomatis yang tidak sesuai urutan Group A–D di runbook ini.           ║
║                                                                            ║
║ 4. JANGAN KONEK KE TRANSACTION POOLER (PORT 6543). Transaction pooler    ║
║    (pgBouncer transaction mode) MENOLAK multi-statement per call dan     ║
║    MENOLAK ALTER TYPE ADD VALUE di luar transaksi eksplisit. WAJIB       ║
║    pakai SESSION POOLER (PORT 5432).                                     ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## 1. Pre-Check Sebelum Eksekusi

Jalankan checklist ini sebelum membuka koneksi apapun ke database.

- [ ] Blueprint v1.1.1 sudah berstatus "Architecture Locked" dan disetujui user.
- [ ] Drizzle schema Phase 1A (`lib/db/src/schema/mkt*.ts`) sudah lolos `pnpm run typecheck:libs` tanpa error.
- [ ] Migration draft Phase 1B (`migrations/enterprise-marketplace-p0.review.sql`) sudah direview manual baris per baris oleh operator yang akan eksekusi.
- [ ] Tidak ada perubahan schema lain yang sedang berjalan bersamaan (cek dengan tim/log aktivitas — hindari migration race).
- [ ] Operator yang eksekusi punya akses `psql` langsung (bukan lewat aplikasi/API server) dan kredensial Supabase session pooler.
- [ ] Waktu eksekusi dijadwalkan di luar jam sibuk (maintenance window) — `activity_logs` dan `purchase_documents` adalah tabel produksi aktif.
- [ ] Tim/owner terkait sudah diberi tahu ada maintenance window singkat untuk ALTER TABLE di 2 tabel produksi tersebut.

**Stop condition di tahap ini:** Jika salah satu item di atas belum terpenuhi, **JANGAN LANJUT** ke Section 2.

---

## 2. Backup / Snapshot Checklist

- [ ] Ambil snapshot/backup penuh Supabase project (`nzdweipzckfszczzqtuw`) melalui dashboard Supabase (Database → Backups) SEBELUM eksekusi apapun.
- [ ] Catat timestamp backup dan simpan referensinya (nama snapshot / backup ID) di tiket/dokumen tracking migration ini.
- [ ] Jalankan query verifikasi row count untuk tabel yang akan diubah (`activity_logs`, `purchase_documents`) — simpan hasilnya sebagai baseline pembanding pasca-migration:
  ```sql
  SELECT 'activity_logs' AS tbl, COUNT(*) FROM activity_logs
  UNION ALL
  SELECT 'purchase_documents', COUNT(*) FROM purchase_documents;
  ```
- [ ] Konfirmasi tidak ada proses lain yang sedang menulis besar-besaran ke `activity_logs`/`purchase_documents` saat snapshot diambil (hindari backup yang tidak konsisten).

**Stop condition:** Jika backup gagal diambil atau tidak bisa diverifikasi ada, **JANGAN LANJUT**.

---

## 3. Memastikan Koneksi Pakai Session Pooler (Port 5432)

Transaction pooler (6543) **tidak boleh** dipakai untuk migration ini.

### Cara verifikasi sebelum eksekusi:

1. Cek connection string yang akan dipakai — port **harus** `5432`, bukan `6543`.
   ```
   postgresql://<user>:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres
   ```
2. Setelah connect via `psql`, jalankan query berikut untuk mengonfirmasi mode pooler:
   ```sql
   SHOW port;
   SELECT current_setting('port');
   ```
   — nilai harus `5432`.
3. Sebagai pengecekan tambahan, jalankan:
   ```sql
   SELECT version();
   SELECT pg_backend_pid();
   ```
   Backend PID yang stabil antar-statement (tidak berubah tiap query) mengindikasikan session pooler / direct connection, bukan transaction pooler yang bisa membuka koneksi backend berbeda tiap statement.
4. **Jangan** pakai environment variable yang menunjuk ke pooler 6543 (`SUPABASE_DATABASE_URL` runtime aplikasi biasanya pakai 6543) — gunakan connection string session pooler terpisah untuk sesi migration manual ini.

**Stop condition:** Jika `SHOW port` mengembalikan `6543` atau connection string mengandung `:6543`, **STOP** — jangan lanjutkan eksekusi apapun. Ganti connection string ke session pooler dulu.

---

## 4. Urutan Eksekusi — Group A, B, C, D

> Setiap statement dalam Group A dijalankan **satu per satu**, bukan sebagai satu batch/transaction. Group B, C, D bisa dijalankan sebagai batch per group (idempotent, aman diulang), tapi tetap disarankan step-by-step untuk observability.

### GROUP A — CREATE TYPE (enum) + ALTER TYPE existing

Jalankan **satu per satu**, autocommit ON, di luar transaction block:

1. `CREATE TYPE mkt_rfq_status ...` (via DO $$ block idempotent, lihat file review)
2. `CREATE TYPE mkt_rfq_priority ...`
3. `CREATE TYPE mkt_quote_status ...`
4. `CREATE TYPE mkt_stock_status ...`
5. `CREATE TYPE mkt_po_status ...`
6. `CREATE TYPE mkt_claim_status ...`
7. **(TERAKHIR, SENDIRIAN)** `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'marketplace_commission';`
   - ⚠️ Statement ini WAJIB dijalankan sendiri, tidak digabung dengan statement lain di sesi/transaksi yang sama.

### GROUP B — CREATE TABLE 7 tabel P0

Urutan wajib mengikuti dependency FK (parent → child):

1. `mkt_rfqs`
2. `mkt_rfq_lines`
3. `mkt_vendor_quotes`
4. `mkt_vendor_quote_lines`
5. `mkt_purchase_orders`
6. `mkt_rfq_guest_claims`
7. `mkt_company_settings`

### GROUP C — CREATE INDEX / UNIQUE INDEX

Jalankan setelah semua tabel Group B berhasil dibuat. Total 26 index (lihat `migrations/enterprise-marketplace-p0.review.sql` Group C untuk daftar lengkap per tabel).

### GROUP D — ALTER TABLE ke tabel ERP existing

1. `ALTER TABLE purchase_documents ADD COLUMN IF NOT EXISTS mkt_purchase_order_id ...`
2. `CREATE INDEX ... purchase_documents_mkt_po_idx`
3. `ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS mkt_rfq_id ...`
4. `ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS mkt_vendor_quote_id ...`
5. `ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS mkt_purchase_order_id ...`
6. 3x `CREATE INDEX` pendukung di `activity_logs`

---

## 5. SQL Verifikasi Setelah Setiap Group + 6. Expected Result

### Setelah Group A (enum)

```sql
SELECT typname FROM pg_type
WHERE typname IN (
  'mkt_rfq_status', 'mkt_rfq_priority', 'mkt_quote_status',
  'mkt_stock_status', 'mkt_po_status', 'mkt_claim_status'
)
ORDER BY typname;
```
**Expected:** 6 baris, semua nama enum muncul.

```sql
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'accounting_entry_source'::regtype
ORDER BY enumsortorder;
```
**Expected:** daftar value existing + `marketplace_commission` di akhir daftar.

### Setelah Group B (tabel)

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'mkt_%'
ORDER BY table_name;
```
**Expected:** 7 baris — `mkt_company_settings`, `mkt_purchase_orders`, `mkt_rfq_guest_claims`, `mkt_rfq_lines`, `mkt_rfqs`, `mkt_vendor_quote_lines`, `mkt_vendor_quotes`.

```sql
SELECT COUNT(*) FROM mkt_rfqs;
SELECT COUNT(*) FROM mkt_rfq_lines;
SELECT COUNT(*) FROM mkt_vendor_quotes;
SELECT COUNT(*) FROM mkt_vendor_quote_lines;
SELECT COUNT(*) FROM mkt_purchase_orders;
SELECT COUNT(*) FROM mkt_rfq_guest_claims;
SELECT COUNT(*) FROM mkt_company_settings;
```
**Expected:** semua `0` (tabel baru, belum ada data).

### Setelah Group C (index)

```sql
SELECT indexname, tablename FROM pg_indexes
WHERE tablename LIKE 'mkt_%'
ORDER BY tablename, indexname;
```
**Expected:** 26 baris index (7 primary key index otomatis dari SERIAL PK tidak termasuk hitungan 26 — jadi total baris query ini akan lebih dari 26 karena PK index ikut muncul; fokus verifikasi ke index yang dibuat manual di Group C sesuai daftar file review).

```sql
SELECT indexname FROM pg_indexes WHERE indexname = 'mkt_company_settings_company_key_uniq';
```
**Expected:** 1 baris (unique index ada).

### Setelah Group D (alter table existing)

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'purchase_documents' AND column_name = 'mkt_purchase_order_id';
```
**Expected:** 1 baris, `data_type = integer`.

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'activity_logs' AND column_name LIKE 'mkt_%'
ORDER BY column_name;
```
**Expected:** 3 baris — `mkt_purchase_order_id`, `mkt_rfq_id`, `mkt_vendor_quote_id`, semua `data_type = integer`.

```sql
SELECT 'activity_logs' AS tbl, COUNT(*) FROM activity_logs
UNION ALL
SELECT 'purchase_documents', COUNT(*) FROM purchase_documents;
```
**Expected:** row count harus **identik** dengan baseline yang dicatat di Section 2 (ADD COLUMN nullable tidak boleh mengubah jumlah baris).

---

## 7. Stop Condition Jika Ada Error

- **Error di Group A (CREATE TYPE / ALTER TYPE):** STOP total. Jangan lanjut ke Group B. Enum adalah dependency untuk semua tabel — kegagalan di sini berarti struktur dasar belum siap. Laporkan error exact message sebelum mencoba ulang.
- **Error di Group B (CREATE TABLE):** STOP. Jangan lanjut ke tabel berikutnya dalam urutan jika satu tabel gagal (kemungkinan besar tabel berikutnya akan gagal juga karena FK ke tabel yang belum ada). Cek apakah tabel dependency (`companies`, `suppliers`, `vendor_catalog_items`, `accounting_taxes`, `sales_documents`) benar-benar ada dan nama kolom `id` sesuai.
- **Error di Group C (CREATE INDEX):** Boleh STOP dan investigasi index yang gagal secara spesifik — index lain yang sudah berhasil dibuat sebelumnya TIDAK perlu di-rollback (index tambahan yang belum lengkap tidak merusak data). Tapi tetap jangan lanjut ke Group D sampai semua index Group C dikonfirmasi lengkap.
- **Error di Group D (ALTER TABLE ke `activity_logs`/`purchase_documents`):** STOP SEGERA. Ini tabel produksi aktif — error di sini butuh investigasi penuh sebelum retry, termasuk cek apakah ada lock/long-running query yang menahan ALTER TABLE.
- **Kondisi umum:** Jika muncul error yang TIDAK dikenali/tidak ada di dokumentasi PostgreSQL standar, **STOP total**, jangan coba-coba statement lain, eskalasi ke tim/DBA sebelum melanjutkan.

---

## 8. Rollback Procedure

Jika migration harus dibatalkan (baik karena error di tengah jalan maupun keputusan bisnis setelah migration selesai):

1. Jalankan `migrations/enterprise-marketplace-p0-rollback.sql` **secara berurutan sesuai isi file** (Group D → C → B → A, sudah urut di file tersebut).
2. **PENTING:** Sebelum menjalankan bagian DROP TABLE, pastikan tidak ada data penting yang sudah masuk ke tabel `mkt_*` (jika migration sudah berjalan lama dan dipakai aplikasi). Ambil backup data dulu jika perlu.
3. **PENTING (lihat WARNING #2 di atas):** Bagian rollback untuk `accounting_entry_source` **TIDAK** melakukan DROP VALUE — itu tidak mungkin di PostgreSQL. Rollback file hanya mengingatkan untuk verifikasi tidak ada baris `accounting_entries` dengan `source = 'marketplace_commission'` sebelum melanjutkan rollback tabel lain. Value enum akan tetap ada permanen di `accounting_entry_source` meski tidak dipakai — ini bukan bug, tapi limitasi PostgreSQL.
4. Setelah rollback selesai, jalankan verifikasi pasca-rollback (sudah ada di komentar akhir file rollback):
   ```sql
   SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'mkt_%';
   -- Expected: 0 baris

   SELECT column_name FROM information_schema.columns
   WHERE table_name IN ('activity_logs','purchase_documents') AND column_name LIKE 'mkt_%';
   -- Expected: 0 baris
   ```
5. Bandingkan row count `activity_logs`/`purchase_documents` dengan baseline Section 2 — harus identik (rollback ADD COLUMN tidak mengubah data existing).

---

## 9. Post-Migration Verification (Full Checklist)

Setelah semua Group A–D berhasil dan seluruh verifikasi per-group PASS:

- [ ] 6 enum baru + 1 value baru di `accounting_entry_source` terkonfirmasi ada (Section 5).
- [ ] 7 tabel `mkt_*` terkonfirmasi ada, semua kosong (0 baris).
- [ ] Semua index Group C terkonfirmasi ada, termasuk unique index.
- [ ] 3 kolom baru di `activity_logs` + 1 kolom baru di `purchase_documents` terkonfirmasi ada dengan tipe `integer`.
- [ ] Row count `activity_logs` dan `purchase_documents` **tidak berubah** dari baseline pra-migration.
- [ ] Tidak ada error/warning di log Supabase selama proses eksekusi.
- [ ] `pnpm run typecheck:libs` dijalankan ulang di kode aplikasi — harus tetap PASS (schema Drizzle sudah cocok dengan struktur DB yang baru dibuat).
- [ ] Tidak ada endpoint/API yang tiba-tiba berubah behavior (karena tidak ada kode endpoint yang diubah di Phase 1A/1B/1C — ini murni DDL).
- [ ] Dokumentasikan timestamp eksekusi selesai + siapa operator yang menjalankan.

---

## 10. Sign-Off Checklist

| Item | Checked | Nama/Waktu |
|---|---|---|
| Pre-check Section 1 selesai dan semua item terpenuhi | ☐ | |
| Backup/snapshot Section 2 diambil dan diverifikasi | ☐ | |
| Koneksi terkonfirmasi via session pooler port 5432 (bukan 6543) | ☐ | |
| Group A (enum) dieksekusi dan verifikasi PASS | ☐ | |
| Group B (tabel) dieksekusi dan verifikasi PASS | ☐ | |
| Group C (index) dieksekusi dan verifikasi PASS | ☐ | |
| Group D (alter table existing) dieksekusi dan verifikasi PASS | ☐ | |
| Post-migration verification (Section 9) selesai semua | ☐ | |
| Tidak ada error yang tidak terselesaikan | ☐ | |
| Approval final untuk menganggap migration selesai (bukan agent — approval manusia) | ☐ | |

**Catatan akhir:** Runbook ini tidak menggantikan judgment operator saat eksekusi nyata. Jika kondisi DB di lapangan berbeda dari asumsi Blueprint v1.1.1 (misal nama tabel/kolom referensi sudah berubah), **STOP dan re-verifikasi terhadap schema aktual sebelum melanjutkan**, jangan asumsikan dokumen ini selalu akurat 100% terhadap kondisi real-time.

---

*Enterprise Marketplace Phase 1C Execution Runbook — dokumen ini murni panduan manual, tidak ada SQL yang dieksekusi maupun koneksi DB yang dibuka selama pembuatannya.*
