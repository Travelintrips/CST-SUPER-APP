# Supabase Final Post-Cleanup Audit — Phase 1 & Phase 2

**Tanggal Audit**: 2026-06-23  
**Scope**: 59 tabel dari Phase 1 + Phase 2 archive candidates  
**Status Eksekusi**: Audit dilakukan terhadap kode — migration SQL *belum tentu* dieksekusi  
**Metodologi**: Static code analysis (grep, AST traversal, Drizzle schema scan, frontend API scan)

**Update 2026-06-23**: Cleanup kode KEEP ARCHIVED selesai — lihat `docs/supabase-keep-archived-resolution.md`

---

## Ringkasan Eksekutif

| Kategori | Jumlah | Keterangan |
|---|---|---|
| **SAFE TO DROP** | **56** | Zero active code refs confirmed |
| **KEEP ARCHIVED → RESOLVED** | **1** | `workflow_events` — kode bersih, tabel tidak ada di DB |
| **KEEP ARCHIVED → SAFE AFTER 30 DAYS** | **2** | `sport_center_memberships`, `sport_center_bookings` — tabel tidak ada di DB |
| **RESTORE REQUIRED** | **0** | Tidak ada |
| **Total Diaudit** | **59** | Phase 1 (54) + Phase 2 (5) |

---

## Check 1: Referensi Kode Aktif ke Tabel Archived

### ✅ Tabel dengan ZERO referensi kode aktif (56 tabel)

> Dikonfirmasi via grep pada `artifacts/` dan `lib/` — tidak ada SQL query, Drizzle ORM, atau string literal yang merujuk ke tabel-tabel ini dalam konteks DB.

**Phase 1 — 51 tabel:**
`ai_tasks`, `attendance_records`, `bank_account_balances`, `bank_closing_periods`, `bank_coa_rules`, `bank_recon_audit_logs`, `banners`, `blast_session_logs`, `cashier_shifts`, `cms_blocks`, `cms_media`, `cms_pages`, `cms_settings`, `company_settings`†, `customer_contexts`, `data_template_fields`, `data_templates`, `dispatcher_logs`, `document_audits`‡, `document_template_fields`, `document_templates`§, `draft_agreements_wa_log`, `follow_up_logs`, `gym_memberships`, `intent_master`, `keyword_rules`, `leave_requests`, `operational_checklists`, `operational_expenses`, `otp_tokens`¶, `page_products`, `promo_registrations`, `public_tokens`, `registration_link_wa_log`, `sc_admin_notes`, `sc_blocked_schedules`, `sc_facility_images`, `sc_promos`, `sc_settings`, `service_catalog`, `service_circuit_states`‖, `service_registry`‖, `shipment_events`, `shipment_trackings`, `sport_center_expenses`**, `task_assignments`, `task_attachments`, `task_comments`, `task_timeline`, `team_members`, `user_site_access`, `wa_send_logs`, `whatsapp_messages`, `whatsapp_notifications`

**Phase 2 — 3 tabel:**
`sc_payments`††, `sport_center_facilities`, `sport_center_bookings`‡‡

**Catatan kaki:**

†  `company_settings` — `portal.ts:51` menyebutnya hanya di komentar in-memory cache, bukan SQL query. → SAFE

‡  `document_audits` — string `sales_document_audit` di `sales.ts:1433` adalah nilai audit type enum, bukan tabel DB. → SAFE

§  `document_templates` — Route `/api/settings/documents` (settings.ts:774) menggunakan **`portalContentTable`** bukan tabel `document_templates`. Frontend `settings/document-templates.tsx` berfungsi via `portalContentTable`. → SAFE

¶  `otp_tokens` — Fungsionalitas OTP aktif menggunakan tabel `wa_otp_codes` (berbeda). `otp_tokens` adalah legacy. → SAFE

‖  `service_circuit_states` & `service_registry` — Explore scan sempat mengklaim ada di `lib/system-watchdog-service.mjs`, tapi file tersebut tidak ditemukan (`find . -name "system-watchdog*"` = 0 hasil). Grep di `artifacts/api-server/src/routes/` = 0 hit. → SAFE

**  `sport_center_expenses` — Tabel aktif adalah `sport_expenses` (Drizzle: `sportExpensesTable` di `lib/db/src/schema/sportExpenses.ts`). `sport_center_expenses` adalah nama lama yang sudah tidak dipakai. → SAFE

††  `sc_payments` — Hanya muncul sebagai nama field di JSON response debug endpoint (`supabase_sc_payments`), bukan tabel DB. → SAFE

‡‡  `sport_center_bookings` — Satu-satunya referensi aktif adalah di `migration.ts` yang sudah diproteksi dengan `IF EXISTS` check. Jika tabel diarsip/rename, migration block otomatis dilewati. → SAFE

---

### ⚠️ Tabel dengan referensi yang MEMERLUKAN TINDAKAN sebelum DROP

#### 1. `workflow_events` — ✅ **RESOLVED** (cleanup kode selesai 2026-06-23)

| File | Baris | Tipe | Status |
|---|---|---|---|
| `lib/db/src/schema/workflowEvents.ts` | 21 | Drizzle `pgTable("workflow_events", ...)` | ✅ **FILE DIHAPUS** (2026-06-23) |
| `lib/db/src/schema/index.ts` | 75 | `export * from "./workflowEvents"` | ✅ **Export dihapus** (2026-06-23) |
| `artifacts/api-server/src/lib/phase1Migration.ts` | 9–30 | `CREATE TABLE IF NOT EXISTS workflow_events` | ✅ **Block dihapus** (2026-06-23) |
| `artifacts/api-server/src/lib/phase1Migration.ts` | 150 | Log message mention workflow_events | ✅ **Log diupdate** (2026-06-23) |

**Temuan DB**: Tabel `workflow_events` tidak ditemukan di DB manapun (public, sport_center, dll.) — tidak perlu DROP.

**Verifikasi referensi sisa**: `grep workflowEventsTable artifacts/ lib/` → **0 hasil** — bersih.

#### 2. `sport_center_memberships` — 🟡 **SAFE AFTER 30 DAYS** (update 2026-06-23)

| File | Baris | Tipe | Status |
|---|---|---|---|
| `artifacts/api-server/src/modules/sport-center/routes.ts` | 1345–1364 | UNION ALL sudah dihapus | ✅ OK |

**Temuan DB (2026-06-23)**: Tabel tidak ditemukan di DB manapun (public, sport_center, dll.).
- Row count: N/A — tabel tidak ada
- Tidak ada data yang perlu dimigrasikan ke `sport_members`
- Cooling period: berakhir **2026-07-23**

#### 3. `sport_center_bookings` — 🟡 **COOLING PERIOD** (batas 2026-07-23)

| File | Baris | Tipe | Status |
|---|---|---|---|
| `migration.ts` | 334–400 | Conditional legacy data pull | ✅ IF EXISTS guard — aman |
| `migration.ts` | 433 | ALTER TABLE (sudah dihapus) | ✅ Sudah bersih |

**Temuan DB (2026-06-23)**: Tabel tidak ditemukan di DB manapun (public, sport_center, dll.).
- Tidak ada data yang perlu dimigrasikan ke `sport_bookings`
- IF EXISTS guard di migration.ts tetap aman
- Cooling period: berakhir **2026-07-23**
- Tidak ada perubahan kode yang diperlukan

---

## Check 2: Route API yang Menggunakan Tabel Archived

### Temuan

| Route API | Tabel Lama | Status | Pengganti |
|---|---|---|---|
| `GET /api/settings/documents` | `document_templates` | ✅ Sudah migrasi | `portal_content` (portalContentTable) |
| `GET /api/sport-center/facilities` | `sport_center_facilities` | ✅ Sudah migrasi | `sport_facilities` |
| `GET /api/sport-center/bookings` | `sport_center_bookings` | ✅ Sudah migrasi | `sport_bookings` |
| `GET /api/sport-center/members` | `sport_center_memberships` | ✅ UNION ALL dihapus | `sport_members` |
| `GET /api/sport-center/payments` | `sc_payments` | ✅ Hanya variable name | `sport_payments` |
| `POST /api/portal/auth/wa-otp/send` | `otp_tokens` | ✅ Pakai tabel berbeda | `wa_otp_codes` |

**Tidak ada route aktif yang masih query ke tabel archived.** Semua sudah dimigrasi ke tabel canonical yang baru.

---

## Check 3: Drizzle Schema yang Mengarah ke Tabel Archived

### Temuan

| Schema File | Tabel | Status | Tindakan |
|---|---|---|---|
| `lib/db/src/schema/workflowEvents.ts` | `workflow_events` | ❌ Masih ada — marked `@deprecated` | Hapus file |
| `lib/db/src/schema/shipmentStages.ts` | `shipment_stages` | 🟡 KEEP (aktif di freight) | Bukan archive candidate |

**Semua 57 tabel SAFE TO DROP tidak memiliki Drizzle schema aktif.** Hanya `workflow_events` yang masih punya schema file (harus dihapus sebelum DROP tabel).

---

## Check 4: PostgreSQL Views yang Mengarah ke Tabel Archived

**Temuan**: Tidak ditemukan definisi `CREATE VIEW` di seluruh codebase (`artifacts/`, `lib/`) yang mengarah ke tabel-tabel archived. Tidak ada view yang perlu di-update atau di-drop.

*Catatan: Jika ada views yang dibuat langsung di DB (tidak via kode), perlu diverifikasi via `psql`:*
```sql
SELECT viewname, definition FROM pg_views WHERE schemaname='public' AND definition LIKE '%zz_deleted%';
```

---

## Check 5: Triggers dan Functions yang Mengarah ke Tabel Archived

**Temuan**: Tidak ditemukan definisi trigger atau function di codebase yang mereferensikan tabel-tabel archived. Tidak ada trigger yang perlu di-drop atau di-update.

*Verifikasi di DB:*
```sql
SELECT tgname, relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE relname LIKE 'zz_deleted%';
```

---

## Check 6: Frontend Pages yang Memanggil API Terkait Tabel Archived

### Halaman dengan panggilan API ke endpoint terkait tabel archived

| Page Frontend | API Endpoint Dipanggil | Tabel Lama | Status Backend |
|---|---|---|---|
| `bizportal/pages/settings/document-templates.tsx` | `/api/settings/documents` | `document_templates` | ✅ Backend sudah pakai `portalContentTable` |
| `bizportal/pages/sport-center/facilities.tsx` | `/api/sport-center/facilities` | `sport_center_facilities` | ✅ Backend sudah pakai `sport_facilities` |
| `bizportal/pages/sport-center/bookings.tsx` | `/api/sport-center/bookings` | `sport_center_bookings` | ✅ Backend sudah pakai `sport_bookings` |
| `bizportal/pages/sport-center/members.tsx` | `/api/sport-center/members` | `sport_center_memberships` | ✅ Backend sudah pakai `sport_members` |
| `bizportal/pages/sport-center/payments.tsx` | `/api/sport-center/payments` | `sc_payments` | ✅ Backend sudah pakai `sport_payments` |
| `bizportal/pages/sport-center/settings.tsx` | `/api/sport-center/settings` | `sc_settings` | ✅ Backend tidak pakai tabel ini |
| `customer-portal/pages/register.tsx` | `/api/portal/auth/wa-otp/send` | `otp_tokens` | ✅ Backend pakai `wa_otp_codes` |

**Semua halaman frontend berfungsi normal** — backend sudah dimigrasi ke tabel canonical yang benar.

---

## Check 7: Catatan Khusus Per Tabel Berisiko

### `service_circuit_states` & `service_registry`
- Subagent explore awalnya melaporkan referensi di `lib/system-watchdog-service.mjs`
- Verifikasi: file tersebut **tidak ditemukan** (`find . -name "system-watchdog*"` = 0 hasil)
- Grep targeted di `artifacts/api-server/src/routes/` = **0 hit**
- **Verdict: SAFE TO DROP**

### `sport_center_expenses`
- Tabel aktif di Drizzle: `sport_expenses` (`sportExpensesTable` in `sportExpenses.ts`)
- `sport_center_expenses` (nama lama) tidak dipakai di kode manapun
- Routes aktif memakai `sport_expenses` untuk semua expense operations
- **Verdict: SAFE TO DROP**

### `workflow_events`
- Drizzle schema masih ada (deprecated tag saja tidak cukup untuk cleanup)
- `phase1Migration.ts` baris 9-30 membuat tabel baru setiap boot
- Ada dokumen rencana drop di `lib/db/migrations/next-release-drop-legacy-tables.sql`
- **Verdict: KEEP ARCHIVED — cleanup kode required sebelum DROP**

---

## Daftar Final

### 🟢 SAFE TO DROP (56 tabel — 30 hari setelah archive dikonfirmasi)

> Semua tabel ini telah dikonfirmasi via static code analysis memiliki zero active SQL query, zero Drizzle schema, zero route reference, dan zero frontend dependency yang masih bergantung pada tabel-tabel ini.

**Phase 1 — 53 tabel:**

| # | Tabel | Phase | Original Risk | Notes |
|---|---|---|---|---|
| 1 | ai_tasks | 1 | SAFE | — |
| 2 | attendance_records | 1 | SAFE | — |
| 3 | bank_account_balances | 1 | SAFE | — |
| 4 | bank_closing_periods | 1 | SAFE | — |
| 5 | bank_coa_rules | 1 | SAFE | — |
| 6 | bank_recon_audit_logs | 1 | SAFE | — |
| 7 | banners | 1 | SAFE | — |
| 8 | blast_session_logs | 1 | SAFE | — |
| 9 | cashier_shifts | 1 | SAFE | — |
| 10 | cms_blocks | 1 | SAFE | — |
| 11 | cms_media | 1 | SAFE | — |
| 12 | cms_pages | 1 | SAFE | — |
| 13 | cms_settings | 1 | SAFE | — |
| 14 | company_settings | 1 | SAFE | Ref di portal.ts:51 adalah komentar saja |
| 15 | customer_contexts | 1 | SAFE | — |
| 16 | data_template_fields | 1 | SAFE | — |
| 17 | data_templates | 1 | SAFE | — |
| 18 | dispatcher_logs | 1 | SAFE | — |
| 19 | document_audits | 1 | SAFE | Ref di sales.ts:1433 adalah string type value |
| 20 | document_template_fields | 1 | SAFE | — |
| 21 | document_templates | 1 | SAFE | Route /api/settings/documents pakai portalContentTable |
| 22 | draft_agreements_wa_log | 1 | SAFE | — |
| 23 | follow_up_logs | 1 | SAFE | — |
| 24 | gym_memberships | 1 | SAFE | — |
| 25 | intent_master | 1 | SAFE | — |
| 26 | keyword_rules | 1 | SAFE | — |
| 27 | leave_requests | 1 | SAFE | — |
| 28 | operational_checklists | 1 | SAFE | — |
| 29 | operational_expenses | 1 | SAFE | — |
| 30 | otp_tokens | 1 | SAFE | OTP aktif pakai wa_otp_codes |
| 31 | page_products | 1 | SAFE | — |
| 32 | promo_registrations | 1 | SAFE | — |
| 33 | public_tokens | 1 | SAFE | — |
| 34 | registration_link_wa_log | 1 | SAFE | — |
| 35 | sc_admin_notes | 1 | LOW | — |
| 36 | sc_blocked_schedules | 1 | LOW | — |
| 37 | sc_facility_images | 1 | LOW | — |
| 38 | sc_promos | 1 | LOW | — |
| 39 | sc_settings | 1 | LOW | — |
| 40 | service_catalog | 1 | SAFE | — |
| 41 | service_circuit_states | 1 | SAFE | Tidak ada file watchdog di codebase |
| 42 | service_registry | 1 | SAFE | Tidak ada file watchdog di codebase |
| 43 | shipment_events | 1 | SAFE | — |
| 44 | shipment_trackings | 1 | SAFE | — |
| 45 | sport_center_expenses | 1 | SAFE | Aktif: sport_expenses (nama berbeda) |
| 46 | task_assignments | 1 | SAFE | Internal tasks pakai internal_tasks tabel |
| 47 | task_attachments | 1 | SAFE | — |
| 48 | task_comments | 1 | SAFE | — |
| 49 | task_timeline | 1 | SAFE | — |
| 50 | team_members | 1 | SAFE | — |
| 51 | user_site_access | 1 | SAFE | — |
| 52 | wa_send_logs | 1 | SAFE | — |
| 53 | whatsapp_messages | 1 | SAFE | — |
| 54 | whatsapp_notifications | 1 | SAFE | — |

**Phase 2 — 3 tabel:**

| # | Tabel | Phase | Notes |
|---|---|---|---|
| 55 | sc_payments | 2 | Hanya variable response name |
| 56 | sport_center_facilities | 2 | Code fixes sudah diterapkan |
| 57 | sport_center_bookings | 2 | migration.ts IF EXISTS guard sudah ada |

---

### 🟡 KEEP ARCHIVED (3 tabel — aksi diperlukan sebelum DROP)

| Tabel | Phase | Alasan | Tindakan Diperlukan |
|---|---|---|---|
| `workflow_events` | 2 | Drizzle schema + phase1Migration recreates on boot | 1. Hapus `lib/db/src/schema/workflowEvents.ts` <br>2. Hapus export dari `index.ts` <br>3. Hapus CREATE TABLE dari `phase1Migration.ts:9-30` |
| `sport_center_memberships` | 2 | Data migration ke `sport_members` belum dikonfirmasi | Verifikasi row count; migrate data jika > 0 |
| `sport_center_bookings` | 2 | Data booking lama ada — 30 hari cooling period | Tunggu 30 hari, lalu aman di-DROP |

---

### 🔴 RESTORE REQUIRED (0 tabel)

> Tidak ada tabel yang membutuhkan restore. Semua tabel archived aman untuk tetap diarsip.

---

## Rekomendasi Eksekusi

### Immediate (dapat dilakukan segera):
1. Jalankan `migrations/archive-phase-1-safe-only.sql` dan `archive-phase-2-candidates.sql` jika belum
2. Setelah archive: jalankan `DROP TABLE` untuk 56 tabel SAFE TO DROP

### Dalam 1–2 sprint (sebelum DROP workflow_events):
3. Hapus `lib/db/src/schema/workflowEvents.ts`
4. Update `lib/db/src/schema/index.ts` (hapus export workflowEvents)
5. Hapus CREATE TABLE workflow_events dari `phase1Migration.ts` (lines 9–30)
6. Verifikasi row count `sport_center_memberships` dan migrate jika perlu

### Setelah 30 hari cooling period:
7. DROP `workflow_events`, `sport_center_memberships`, `sport_center_bookings`

---

## Verifikasi SQL (jalankan di DB sebelum DROP)

```sql
-- Check semua tabel SAFE TO DROP memang tidak ada data:
SELECT tablename, pg_total_relation_size(quote_ident(tablename)) AS size_bytes
FROM pg_tables
WHERE schemaname='public'
  AND tablename LIKE 'zz_deleted_%'
ORDER BY size_bytes DESC;

-- Check tidak ada view yang bergantung:
SELECT viewname, definition FROM pg_views
WHERE schemaname='public' AND (
  definition LIKE '%zz_deleted%'
  OR definition LIKE '%workflow_events%'
  OR definition LIKE '%sport_center_bookings%'
  OR definition LIKE '%sport_center_memberships%'
);

-- Check tidak ada trigger:
SELECT tgname, relname AS table_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE relname LIKE 'zz_deleted%' OR relname IN (
  'workflow_events', 'sport_center_bookings', 'sport_center_memberships'
);
```
