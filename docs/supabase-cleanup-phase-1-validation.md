# Supabase Cleanup Phase 1 — Post-Cleanup Validation Report

**Tanggal Validasi**: 2026-06-23  
**Status Migration**: ⚠️ BELUM DIEKSEKUSI — laporan ini adalah pre-execution static analysis  
**Validator**: Agent (static code scan + API route test)

---

## 1. Status Aplikasi

| Check | Status | Keterangan |
|-------|--------|-----------|
| API Server running | ✅ OK | Log: "All startup migrations complete" |
| `/api/health/ready` | ✅ 200 OK | `{"ready":true}` |
| Boot migrations | ✅ OK | Semua seeder dan boot migration selesai |

### Pre-existing errors (tidak berkaitan dengan cleanup)
| Error | File | Keterangan |
|-------|------|-----------|
| FleetIntelligence unique index | `fleetIntelligence.ts:419` | `could not create unique index "gojek_raw_no_ref_dedup"` — data duplikat existing, bukan dari cleanup |
| pg_dump version mismatch | `dbBackup.ts:67` | server v17.6 vs pg_dump v16.10 — infrastruktur issue |
| TypeScript esbuild errors | `purchaseWorkflow.ts`, `airFreight.ts` | Variable deklarasi duplikat — pre-existing build warning |

---

## 2. API Route Test

> Catatan: Tanpa auth cookie, 401 = route **ada** (auth required). 404 = route **tidak ada** di path tersebut.

| Route | HTTP | Penilaian |
|-------|------|-----------|
| `GET /api/health/ready` | 200 | ✅ Sehat |
| `GET /api/dashboard` | 401 | ✅ Route aktif (auth required) |
| `GET /api/sport-center/dashboard` | 401 | ✅ Route aktif (auth required) |
| `GET /api/logistics/shipments` | 401 | ✅ Route aktif — ⚠️ lihat temuan #2 |
| `GET /api/whatsapp/inbox` | 401 | ✅ Route aktif (auth required) |
| `GET /api/finance/accounts` | 404 | ℹ️ Path berbeda (bukan `/api/finance/accounts`) |
| `GET /api/fleet/intelligence` | 404 | ℹ️ Path berbeda, fleet menggunakan sub-routes |

---

## 3. Static Code Analysis — Referensi ke 55 Tabel yang Akan Di-rename

> Scan dilakukan di: `artifacts/`, `lib/`, `packages/`  
> Dikecualikan: `migrations/`, `docs/`, `node_modules/`, `dist/`

### 3a. ⛔ TEMUAN KRITIS — Tabel Dalam Migration Yang Masih Aktif di Kode

#### TEMUAN #1 — `fleet_outstanding_import_log` (Entry #55, SAFE)

| Aspek | Detail |
|-------|--------|
| **Severity** | 🔴 CRITICAL |
| **File** | `artifacts/api-server/src/routes/fleetIntelligence.ts` |
| **Lines** | 386–402, 3117, 3144 |
| **Route** | `POST /api/fleet/intelligence/outstanding/import` |
| **Tipe Referensi** | Inline Migration + DML aktif |

**Referensi kode:**
```
L386-402: CREATE TABLE IF NOT EXISTS fleet_outstanding_import_log   ← inline migration v14
L401:     CREATE INDEX IF NOT EXISTS fleet_outiml_company_idx ON fleet_outstanding_import_log
L3117:    INSERT INTO fleet_outstanding_import_log ...              ← DML aktif
L3144:    FROM fleet_outstanding_import_log ...                     ← DML aktif
```

**Dampak jika direname:**
- Boot migration v14 akan membuat tabel BARU `fleet_outstanding_import_log` (karena `CREATE TABLE IF NOT EXISTS`)
- Aplikasi tidak crash, tapi data historis di `zz_deleted_fleet_outstanding_import_log` terputus dari tabel baru yang kosong
- Query INSERT/SELECT di baris 3117, 3144 berjalan normal tapi terhadap tabel yang baru (kosong)

**✅ Rekomendasi**: **HAPUS dari migration, pindah ke KEEP**. Tabel ini dikelola oleh inline migration fleetIntelligence.

---

#### TEMUAN #2 — `shipments` (Entry #54, LOW)

| Aspek | Detail |
|-------|--------|
| **Severity** | 🟠 HIGH |
| **Files** | `lib/db/src/schema/shipments.ts`, `artifacts/api-server/src/routes/logistics.ts` |
| **Lines** | `shipments.ts:25`, `logistics.ts:59-60` |
| **Route** | `GET /api/logistics/shipments` (deprecated tapi masih aktif) |
| **Tipe Referensi** | Drizzle schema + active SELECT |

**Referensi kode:**
```
lib/db/src/schema/shipments.ts:25
  export const shipmentsTable = pgTable("shipments", {...})   ← Drizzle schema aktif

artifacts/api-server/src/routes/logistics.ts:59-60
  const [{ total }] = await db.select({ total: count() }).from(shipmentsTable)
  const shipments = await db.select().from(shipmentsTable)... ← SELECT aktif
```

**Dampak jika direname:**
- `GET /api/logistics/shipments` gagal dengan error `relation "shipments" does not exist`
- Drizzle tidak melakukan auto-discovery; tabel yang direname menyebabkan query error
- Route sudah ditandai deprecated (`X-Deprecated header`) tapi masih aktif di `routes/index.ts`

**✅ Rekomendasi**: **HAPUS dari migration**. Hapus dulu route + schema `shipments` dari kode sebelum archive. Atau terima bahwa route deprecated ini akan error.

---

### 3b. ✅ Tabel AMAN — Tidak Ada Referensi Aktif di Kode (53 tabel)

Semua tabel berikut telah discan. **Tidak ditemukan referensi** di `artifacts/`, `lib/`, `packages/`:

| Grup | Tabel (rows=0, tidak ada ref kode) |
|------|-------------------------------------|
| AI / tasks | `ai_tasks`, `task_assignments`, `task_attachments`, `task_comments`, `task_timeline` |
| Attendance / HR | `attendance_records`, `leave_requests`, `team_members` |
| Banking | `bank_account_balances`, `bank_closing_periods`, `bank_coa_rules`, `bank_recon_audit_logs` |
| CMS | `cms_blocks`, `cms_media`, `cms_pages`, `cms_settings`, `banners`, `page_products` |
| Company / Settings | `company_settings`, `user_site_access` |
| Customer / Contexts | `customer_contexts` |
| Data Templates | `data_template_fields`, `data_templates`, `document_audits`, `document_template_fields`, `document_templates` |
| Logs / Sessions | `blast_session_logs`, `cashier_shifts`, `dispatcher_logs`, `draft_agreements_wa_log` |
| Fitness | `gym_memberships` |
| Intent / Rules | `intent_master`, `keyword_rules` |
| Operational | `operational_checklists`, `operational_expenses` |
| Security | `otp_tokens`, `public_tokens` |
| Registrations | `follow_up_logs`, `promo_registrations`, `registration_link_wa_log` |
| Service infra | `service_catalog`, `service_circuit_states`, `service_registry` |
| Shipments legacy | `shipment_events`, `shipment_trackings` |
| WhatsApp | `whatsapp_messages`, `whatsapp_notifications` |
| SC LOW (rows=0) | `sc_admin_notes`, `sc_blocked_schedules`, `sc_facility_images`, `sc_promos`, `sc_settings`, `sport_center_expenses` |

---

## 4. Status Tabel BLOCKED (tidak ada di migration — sudah benar)

| Tabel | Referensi aktif ditemukan | Status |
|-------|--------------------------|--------|
| `sport_center_bookings` | ✅ `supabaseSync.ts:383,529`, `routes.ts:1948`, `migration.ts:334-460` | ✅ Benar BLOCKED |
| `sport_center_facilities` | ✅ `supabaseSync.ts:246,251`, `routes.ts:4720` | ✅ Benar BLOCKED |
| `sport_center_memberships` | ✅ `routes.ts:1349,1357` | ✅ Benar BLOCKED |
| `sc_payments` | Tidak dicek (BLOCKED by design) | ✅ Tetap BLOCKED |
| `shipment_stages` | `lib/db/src/schema/shipmentStages.ts:11` | ✅ Benar BLOCKED |
| `transaction_datetime_normalized` | Tidak dicek (BLOCKED by design) | ✅ Tetap BLOCKED |
| `workflow_events` | Tidak dicek (BLOCKED by design) | ✅ Tetap BLOCKED |

---

## 5. Ringkasan Temuan

| # | Tabel | Severity | Status Sekarang | Rekomendasi |
|---|-------|----------|-----------------|-------------|
| 1 | `fleet_outstanding_import_log` | 🔴 CRITICAL | Entry #55 di migration (SAFE) | **HAPUS dari migration → KEEP** |
| 2 | `shipments` | 🟠 HIGH | Entry #54 di migration (LOW) | **HAPUS dari migration** atau pastikan route deprecated di-disable dulu |
| — | 53 tabel lainnya | 🟢 CLEAR | Dalam migration | Aman direname |

---

## 6. Action Items Sebelum Eksekusi Migration

- [ ] **#1 (WAJIB)**: Hapus `fleet_outstanding_import_log` dari `migrations/archive-phase-1-safe-only.sql` dan `archive-phase-1-safe-only-rollback.sql`
- [ ] **#2 (WAJIB)**: Putuskan nasib `shipments`:
  - Opsi A: Hapus dari migration, biarkan route deprecated tetap berjalan
  - Opsi B: Disable route `GET /api/logistics/shipments` di `routes/index.ts` terlebih dahulu, kemudian safe untuk archive
- [ ] **#3**: Update `docs/supabase-cleanup-phase-1-execution-plan.md` setelah action di atas selesai
- [ ] **#4**: Jalankan `node scripts/backup-low-risk-tables.mjs` sebelum eksekusi
- [ ] **#5**: Eksekusi migration hanya di maintenance window

---

## 7. Perintah Validasi Setelah Eksekusi (untuk dijalankan post-rename)

```bash
# Verifikasi tabel sudah direname
psql "$SUPABASE_DATABASE_URL" -c "
SELECT tablename FROM pg_tables
WHERE schemaname='public' AND tablename LIKE 'zz_deleted_%'
ORDER BY tablename;
"

# Cek tidak ada error relation di log
grep -i "relation.*does not exist" /var/log/app.log | tail -20

# Test API health
curl "$API_URL/api/health/ready"
```

---

*Laporan ini dihasilkan dari static code analysis. Belum ada tabel yang direname — migration BELUM dieksekusi.*
