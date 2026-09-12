# Enterprise Marketplace — Production Readiness Report

**Tanggal audit:** 2026-07-02
**Scope audit:** Blueprint v1.1.1, Drizzle schema Phase 1A, migration draft + rollback Phase 1B, execution runbook Phase 1C
**Sifat audit:** Read-only review. Tidak ada kode, migration, atau blueprint yang diubah selama audit ini.
**Status eksekusi:** Phase 1C Migration Completed — 2026-07-02

**Artefak yang diaudit:**
- `docs/enterprise-marketplace-blueprint-v1.1.1.md`
- `lib/db/src/schema/mktRfqs.ts`, `mktRfqLines.ts`, `mktVendorQuotes.ts`, `mktVendorQuoteLines.ts`, `mktPurchaseOrders.ts`, `mktRfqGuestClaims.ts`, `mktCompanySettings.ts`
- `migrations/enterprise-marketplace-p0.review.sql`
- `migrations/enterprise-marketplace-p0-rollback.sql`
- `docs/enterprise-marketplace-phase1c-execution-runbook.md`

---

## 1. FK Review

**Hasil: PASS**

- Semua 20 FK relation (7 internal antar tabel `mkt_*`, 8 FK ke tabel ERP existing, 5 FK dari tabel ERP existing ke tabel `mkt_*` baru) konsisten 1:1 antara Blueprint Section 7 (FK Matrix), Drizzle schema (`.ts`), dan SQL migration draft (`.sql`) — diverifikasi baris per baris, tidak ada selisih `onDelete` rule.
- Semua tabel yang direferensikan (`companies`, `suppliers`, `vendor_catalog_items`, `accounting_taxes`, `sales_documents`, `activity_logs`, `purchase_documents`) dikonfirmasi ada di `lib/db/src/schema/` — tidak ada FK menunjuk ke tabel yang tidak ada.
- Dependency order di Group B (CREATE TABLE) sudah benar: parent (`mkt_rfqs`) dibuat sebelum child (`mkt_rfq_lines`, `mkt_vendor_quotes`, dst).
- Kombinasi `RESTRICT` pada `mkt_purchase_orders.rfq_id`/`quote_id` + `CASCADE` pada `mkt_vendor_quotes.rfq_id` menghasilkan proteksi berlapis yang benar: RFQ yang sudah punya PO tidak bisa dihapus (DELETE akan gagal total karena cascade path menabrak RESTRICT), mencegah orphan PO secara struktural.

**Catatan minor:** Tidak ada composite FK atau deferred constraint yang dipakai — cukup untuk kebutuhan P0, tidak masalah.

---

## 2. Constraint Review

**Hasil: PASS**

- NOT NULL diterapkan konsisten pada kolom wajib (`buyer_name`, `buyer_email`, `status`, `token`, dll.) sesuai Blueprint Section 6.
- UNIQUE constraint benar di 4 titik: `mkt_rfqs.rfq_number`, `mkt_rfqs.guest_token`, `mkt_vendor_quotes.token`, `mkt_purchase_orders.po_number`.
- Default value konsisten (`status` default sesuai state awal siklus, `line_count`/`quote_count` default 0, timestamp default `now()`).
- Tidak ada `CHECK` constraint eksplisit untuk validasi nilai numerik (misal `requested_qty > 0`, `commission_rate BETWEEN 0 AND 100`, `offered_unit_price >= 0`). Ini bukan blocker untuk DDL murni, tapi **tercatat sebagai gap** yang harus ditutup di layer aplikasi/service sebelum go-live fitur (bukan sebelum migration DDL).

**Catatan minor:** Constraint `expires_at NOT NULL` di `mkt_rfq_guest_claims` benar ada, tapi tidak ada CHECK yang memastikan `expires_at > created_at` — low risk, cukup ditangani di service layer.

---

## 3. Index Review

**Hasil: PASS**

- 26 index Group C sudah tercek tidak ada nama duplikat (audit otomatis: 0 kolisi).
- Semua kolom FK punya index pendukung (mencegah full table scan saat JOIN/lookup by foreign key) — sesuai best practice PostgreSQL untuk FK yang sering di-JOIN.
- Unique index `mkt_company_settings_company_key_uniq` pada `(company_id, setting_key)` sudah benar mendukung pola "1 key per company, atau 1 key global jika `company_id IS NULL`".
- Index status (`mkt_rfqs.status`, `mkt_vendor_quotes.status`, `mkt_purchase_orders.status`, `mkt_rfq_guest_claims.claim_status`) tersedia untuk query filter dashboard admin (sesuai pola query yang disebut di Blueprint Section 23 Admin Journey).

**Catatan minor:** Tidak ada composite index untuk pola query gabungan yang mungkin sering dipakai (misal `mkt_rfqs(company_id, status)` untuk "RFQ aktif per company"). Bisa ditambahkan reaktif setelah data production tersedia dan pola query nyata diketahui — tidak perlu diblokir sekarang karena tabel masih kosong saat migration.

---

## 4. Enum Review

**Hasil: PASS**

- 6 enum baru (`mkt_rfq_status`, `mkt_rfq_priority`, `mkt_quote_status`, `mkt_stock_status`, `mkt_po_status`, `mkt_claim_status`) dibungkus `DO $$ ... pg_type check` — idempotent, aman dijalankan ulang.
- Tidak ada kolisi nama dengan enum existing di `lib/db/src/schema/` (audit grep: 0 hasil).
- 1 `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'marketplace_commission'` sudah benar diposisikan sebagai statement TUNGGAL di luar transaction block, dengan warning eksplisit di runbook.
- Value enum semuanya sesuai daftar di Blueprint Section 6 (tidak ada value yang hilang/tertukar antara `.ts` dan `.sql`).

**Catatan permanen (bukan blocker, tapi wajib dipahami operator):** Value `marketplace_commission` pada `accounting_entry_source` **tidak bisa di-rollback** (PostgreSQL tidak mendukung `DROP VALUE` dari enum). Ini sudah didokumentasikan dengan benar di rollback file dan runbook — bukan gap, tapi limitasi platform yang harus diterima sebagai keputusan sadar.

---

## 5. Naming Review

**Hasil: PASS**

- Prefix `mkt_` konsisten di semua 7 tabel dan 6 enum baru — tidak ada tabel/enum baru yang lolos tanpa prefix.
- Konvensi `_lines` (bukan `_items`) konsisten dipakai di `mkt_rfq_lines` dan `mkt_vendor_quote_lines` sesuai keputusan naming Blueprint Section 5.
- Nama kolom FK (`catalog_vendor_id`, `vendor_catalog_item_id`) konsisten dengan keputusan #3 dan #4 di Blueprint — tidak disingkat/diubah di implementasi.
- Format `rfq_number` (`MKT-RFQ-YYYYMM-XXXX`) dan `po_number` (`MKT-PO-YYYYMM-XXXX`) hanya didokumentasikan sebagai kontrak format di Blueprint — **belum ada CHECK constraint atau trigger di DB yang memvalidasi format ini** karena generation number adalah tanggung jawab service layer (belum dibuat). Ini konsisten dengan keputusan F24 bahwa reconciliation harus pakai FK/ID, bukan string matching — jadi tidak menjadi blocker DDL.
- Index/constraint naming pattern (`<table>_<column(s)>_idx`, `<table>_<columns>_uniq`) konsisten dengan pola existing project (`suppliers_company_idx`, `purchase_docs_company_idx`, dll.) — tidak memperkenalkan konvensi baru yang menyimpang.

---

## 6. Rollback Review

**Hasil: PASS**

- Urutan rollback di `enterprise-marketplace-p0-rollback.sql` sudah benar dibalik total dari urutan CREATE (Group D → C → B → A), mencegah FK violation saat DROP.
- Semua statement rollback idempotent (`IF EXISTS`) — aman dijalankan ulang atau sebagian.
- Catatan eksplisit sudah ada untuk limitasi enum value (lihat Section 4 di atas) — tidak ada rollback yang secara diam-diam gagal tanpa penjelasan.
- Verifikasi pasca-rollback (query `information_schema.tables`/`columns`) sudah tersedia di komentar akhir file — memberi operator cara konkret memastikan rollback sukses total.

**Catatan minor:** Rollback tidak menyertakan langkah restore dari backup Supabase sebagai fallback terakhir jika `DROP TABLE`/`DROP TYPE` sendiri gagal karena alasan tak terduga (misal ada dependency lain yang belum diketahui saat ini). Ini sudah cukup ditutup oleh keharusan backup di Section 2 Runbook, tapi tidak ada langkah eksplisit "jika rollback SQL gagal, restore dari snapshot X" — layak ditambahkan sebagai catatan tambahan di runbook sebelum eksekusi nyata (bukan blocker, karena backup sudah diwajibkan).

---

## 7. Backup Review

**Hasil: READY WITH MINOR NOTE — tergantung tindakan manual yang belum terjadi**

- Runbook Phase 1C Section 2 sudah mewajibkan snapshot Supabase + baseline row count `activity_logs`/`purchase_documents` sebelum eksekusi apapun — proses ini sudah benar secara desain.
- **Namun:** sampai laporan ini dibuat, backup **belum diambil** (kamu menyebutkan akan melakukan ini setelah review runbook). Ini bukan gap desain — murni status eksekusi yang belum terjadi.
- Runbook belum mencantumkan target retention/lokasi penyimpanan backup atau siapa yang bertanggung jawab memverifikasi backup benar-benar restorable (bukan hanya "tombol backup diklik") — catatan minor untuk ditambahkan sebagai SOP, tidak wajib untuk migration DDL sederhana ini karena semua statement idempotent dan reversible (kecuali 1 catatan enum yang sudah didokumentasikan).

---

## 8. Security Review

**Hasil: PASS dengan catatan forward-looking**

Sesuai `threat_model.md`, DDL murni (belum ada endpoint) punya exposure rendah, tapi berikut temuan yang relevan untuk desain skema yang akan menjadi pondasi endpoint nanti:

- **Internal fields exposure (KEPUTUSAN #10):** Kolom `commission_rate`, `commission_amount`, `net_vendor_amount`, `rank_score`, `rank_badges` di `mkt_vendor_quotes` didesain sebagai "internal only". Skema DB sendiri tidak (dan tidak bisa) menegakkan larangan ini — itu tanggung jawab route/serializer di layer API yang **belum dibuat**. **Ini bukan blocker migration**, tapi wajib jadi catatan wajib-baca untuk siapa pun yang membangun endpoint di atas tabel ini nanti (selaras dengan Elevation of Privilege risk di `threat_model.md`).
- **Guest token & PII:** `mkt_rfqs.guest_token`, `mkt_vendor_quotes.token`, `mkt_rfq_guest_claims.guest_token` disimpan sebagai `TEXT` tanpa constraint panjang minimum/format. Keamanan token (entropi tinggi, generation aman) adalah tanggung jawab service layer yang generate token, bukan DDL — konsisten dengan prinsip di `threat_model.md` soal "token acak berentropi tinggi sebelum mengembalikan/memodifikasi data". DDL sendiri tidak menimbulkan risiko baru karena belum ada endpoint yang membaca/menulis token ini.
- **PII buyer** (`buyer_name`, `buyer_email`, `buyer_phone`, `buyer_company`, `delivery_address`) disimpan sebagai plaintext `TEXT` — konsisten dengan pola PII existing di tabel ERP lain (`customers`, `suppliers`) di project ini, tidak ada penyimpangan standar.
- **Tidak ada Row-Level Security (RLS) policy** didefinisikan untuk tabel `mkt_*` baru. Karena akses data di project ini dikontrol di layer API (Express middleware `requireAdmin`/auth), bukan RLS Postgres, ini konsisten dengan arsitektur existing — bukan gap baru yang diperkenalkan migration ini.

**Kesimpulan security:** DDL sendiri tidak membuka celah keamanan baru. Semua risiko yang teridentifikasi bersifat forward-looking untuk fase pembuatan endpoint (Phase 2+), sudah terdokumentasi dengan jelas di Blueprint (KEPUTUSAN #10, #12) sehingga tidak akan terlupakan.

---

## 9. Performance Review

**Hasil: PASS**

- Semua tabel baru dimulai kosong (0 baris) — tidak ada risiko locking lama karena tidak ada data existing yang perlu di-backfill/rewrite.
- `ALTER TABLE ADD COLUMN` di `activity_logs` dan `purchase_documents` menggunakan kolom nullable tanpa default non-trivial — di PostgreSQL modern (11+), ini adalah operasi metadata-only, cepat, tidak memicu full table rewrite meskipun kedua tabel tersebut sudah berisi banyak baris data produksi.
- Index dibuat dengan `CREATE INDEX` biasa (bukan `CREATE INDEX CONCURRENTLY`). Untuk tabel `mkt_*` yang baru dan kosong ini tidak masalah (instant). Untuk index tambahan di `activity_logs`/`purchase_documents` (Group D), `CREATE INDEX` non-concurrent akan mengambil lock yang bisa memblokir write singkat selama index dibangun — **untuk tabel besar, ini berpotensi menyebabkan downtime singkat**. Runbook sudah mewajibkan maintenance window untuk ALTER TABLE di 2 tabel ini (Section 1 pre-check), tapi **belum eksplisit menyebutkan estimasi ukuran tabel `activity_logs`/`purchase_documents` saat ini** untuk memperkirakan durasi lock.
- JSONB dipakai secukupnya (`rank_badges`, `setting_value`) — tidak ada indikasi query pattern yang butuh GIN index di P0 (belum ada query yang di-filter berdasarkan isi JSONB), jadi tidak adanya GIN index bukan gap saat ini.

**Catatan minor (bukan blocker):** Sebelum eksekusi nyata, operator disarankan menjalankan `SELECT COUNT(*) FROM activity_logs;` dan `SELECT COUNT(*) FROM purchase_documents;` untuk memperkirakan durasi `CREATE INDEX` non-concurrent di Group D — jika ternyata tabel sangat besar (jutaan baris), sebaiknya index tambahan tersebut dibuat dengan `CREATE INDEX CONCURRENTLY` sebagai statement tersendiri di luar transaksi (catatan tambahan untuk runbook, tidak mengubah file apa pun saat ini sesuai instruksi).

---

## 10. Monitoring Review

**Hasil: READY WITH MINOR NOTE**

- Runbook Phase 1C sudah punya verifikasi manual per-group (Section 5–6) dan stop condition per error (Section 7) — cukup untuk eksekusi manual satu kali oleh operator yang mengikuti runbook dengan disiplin.
- **Belum ada mekanisme monitoring otomatis** (alert, dashboard, log aggregation khusus) untuk mendeteksi anomali setelah migration selesai — misal tidak ada query terjadwal yang mengecek "apakah ada row baru masuk ke tabel `mkt_*` tanpa melalui service layer resmi" atau alert jika `journal_posted_at` di `mkt_purchase_orders` tidak terisi setelah X jam (indikasi jurnal komisi gagal post).
- Ini **bukan blocker untuk migration DDL** (karena DDL saja tidak menghasilkan traffic yang perlu dimonitor secara real-time), tapi **wajib menjadi item follow-up** sebelum fitur marketplace benar-benar go-live dengan traffic nyata (Phase 2+, saat endpoint dan service layer sudah ada).

---

## Ringkasan Skor per Area

| Area | Status |
|---|---|
| 1. FK Review | ✅ PASS |
| 2. Constraint Review | ✅ PASS (gap non-blocking: CHECK constraint numerik) |
| 3. Index Review | ✅ PASS |
| 4. Enum Review | ✅ PASS (limitasi permanen sudah terdokumentasi) |
| 5. Naming Review | ✅ PASS |
| 6. Rollback Review | ✅ PASS (catatan minor: langkah restore-from-backup fallback) |
| 7. Backup Review | ⚠️ Tergantung tindakan manual yang belum terjadi |
| 8. Security Review | ✅ PASS (catatan forward-looking untuk Phase 2 endpoint) |
| 9. Performance Review | ✅ PASS (catatan minor: cek ukuran tabel sebelum Group D) |
| 10. Monitoring Review | ⚠️ Gap non-blocking, follow-up untuk Phase 2 |

---

## STATUS: **Ready with Minor Notes**

### Mengapa migration ini aman dijalankan (dengan catatan)

DDL secara struktural **solid dan konsisten** di ketiga layer (Blueprint → Drizzle schema → SQL migration) — audit FK, constraint, index, enum, dan naming semuanya PASS tanpa temuan yang mengancam integritas data. Semua statement idempotent, rollback plan lengkap dan sudah teruji secara logika (urutan dibalik benar, limitasi enum sudah didokumentasikan secara jujur bukan disembunyikan). Tidak ditemukan kolisi nama, FK yang menunjuk ke tabel tidak ada, atau kesalahan urutan dependency.

**Catatan yang membuat status bukan "Ready" murni** (semuanya non-blocking untuk eksekusi DDL, tapi harus diperhatikan operator):

1. **Backup belum diambil** (Area 7) — ini status eksekusi, bukan gap desain. Selesai begitu kamu menjalankan langkah Section 2 Runbook.
2. **Belum ada estimasi ukuran tabel `activity_logs`/`purchase_documents`** sebelum `CREATE INDEX` non-concurrent di Group D (Area 9) — cek cepat sebelum eksekusi, potensi perlu `CONCURRENTLY` jika tabel besar.
3. **Monitoring otomatis pasca-migration belum ada** (Area 10) — tidak menghalangi migration DDL, tapi wajib jadi follow-up sebelum fitur dipakai user nyata di Phase 2.
4. Beberapa **CHECK constraint bisnis** (qty > 0, commission_rate range) sengaja belum ada di level DB — didesain untuk divalidasi di service layer nanti, konsisten dengan pola project existing (tidak ada tabel lain di project ini yang pakai CHECK constraint numerik ketat).

Tidak ada satu pun temuan di atas yang termasuk kategori **blocker** (tidak ada FK salah, tidak ada data-loss risk, tidak ada kolisi struktural). Migration aman dieksekusi mengikuti Runbook Phase 1C setelah kamu menyelesaikan backup Supabase — sesuai rencana yang sudah kamu sebutkan sendiri.

Tidak ada perubahan yang dibuat ke Blueprint, schema, migration, atau runbook selama audit ini.

---

## Lampiran — Query Read-Only Pre-Check Sebelum Group D

Query di bawah ini **belum dijalankan**. Disiapkan untuk dijalankan manual oleh operator sebelum eksekusi Group D (ALTER TABLE pada `activity_logs` dan `purchase_documents`), sesuai catatan Area 9 (Performance Review) di atas. Semua query bersifat `SELECT`/metadata-only — tidak ada `INSERT`/`UPDATE`/`DELETE`/DDL.

### 1. Row Count

```sql
SELECT 'activity_logs' AS table_name, COUNT(*) AS row_count FROM activity_logs
UNION ALL
SELECT 'purchase_documents', COUNT(*) FROM purchase_documents;
```

### 2. Table Size (data + toast, tanpa index)

```sql
SELECT
  relname AS table_name,
  pg_size_pretty(pg_table_size(oid)) AS table_size,
  pg_table_size(oid) AS table_size_bytes
FROM pg_class
WHERE relname IN ('activity_logs', 'purchase_documents')
  AND relkind = 'r';
```

### 3. Index Size (total index size per tabel)

```sql
SELECT
  relname AS table_name,
  pg_size_pretty(pg_indexes_size(oid)) AS total_index_size,
  pg_indexes_size(oid) AS total_index_size_bytes
FROM pg_class
WHERE relname IN ('activity_logs', 'purchase_documents')
  AND relkind = 'r';
```

### 4. Estimated Lock Impact

`ADD COLUMN` nullable tanpa default non-trivial di PostgreSQL 11+ adalah metadata-only (aman, instant, tidak tergantung ukuran tabel). Risiko lock ada di `CREATE INDEX` non-concurrent (Group D index tambahan) — durasinya proporsional ke ukuran tabel dan write traffic saat itu. Query berikut memberi estimasi kasar:

```sql
SELECT
  relname AS table_name,
  n_live_tup AS estimated_row_count,
  pg_size_pretty(pg_total_relation_size(oid)) AS total_size_incl_indexes,
  CASE
    WHEN n_live_tup < 100000 THEN 'LOW — CREATE INDEX kemungkinan < 1 detik, lock singkat'
    WHEN n_live_tup < 1000000 THEN 'MEDIUM — CREATE INDEX bisa beberapa detik, pertimbangkan low-traffic window'
    ELSE 'HIGH — CREATE INDEX bisa lama, pertimbangkan CREATE INDEX CONCURRENTLY sebagai statement tersendiri di luar transaction'
  END AS lock_risk_estimate
FROM pg_stat_user_tables
JOIN pg_class ON pg_class.relname = pg_stat_user_tables.relname
WHERE pg_stat_user_tables.relname IN ('activity_logs', 'purchase_documents');
```

Cek juga apakah ada koneksi aktif yang sedang menahan lock lama di kedua tabel ini sebelum eksekusi (butuh akses `pg_stat_activity`, read-only):

```sql
SELECT pid, state, wait_event_type, wait_event, query_start, LEFT(query, 100) AS query_snippet
FROM pg_stat_activity
WHERE query ILIKE '%activity_logs%' OR query ILIKE '%purchase_documents%'
ORDER BY query_start;
```

### 5. Daftar Index Existing pada Kedua Tabel

```sql
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('activity_logs', 'purchase_documents')
ORDER BY tablename, indexname;
```

**Interpretasi hasil (expected/aman untuk lanjut ke Group D):**
- Row count berapa pun tetap aman untuk `ADD COLUMN` (metadata-only).
- Jika `lock_risk_estimate` = LOW atau MEDIUM → aman lanjut `CREATE INDEX` non-concurrent seperti di file migration draft saat ini.
- Jika `lock_risk_estimate` = HIGH → **hentikan Group D**, pertimbangkan mengganti 3 statement `CREATE INDEX` di Group D menjadi `CREATE INDEX CONCURRENTLY` (dijalankan satu per satu, di luar transaction, tidak bisa dalam `DO $$` block) — ini akan jadi perubahan pada file migration yang butuh approval terpisah, bukan dieksekusi diam-diam.
- Jika query `pg_stat_activity` menunjukkan ada long-running query/lock aktif di dua tabel ini saat mau eksekusi → **tunda eksekusi Group D** sampai beban turun.
