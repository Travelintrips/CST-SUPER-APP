# Phase 5 — Cleanup Candidate Report
**Tanggal audit:** 2026-05-30  
**Status Phase 1–4:** PASS (18/18 regression test + 12/12 exceptions/governance)  
**Tujuan:** Mengidentifikasi legacy/dead code yang aman dihapus, di-deprecate, atau harus dipertahankan.

---

## Ringkasan Eksekutif

| Kategori | Jumlah Item |
|---|---|
| SAFE TO DELETE (next release) | 3 |
| SAFE TO DEPRECATE ONLY | 3 |
| KEEP — STILL ACTIVE | 8 |
| NEED MANUAL REVIEW | 2 |

---

## 1. SAFE TO DELETE — Next Release

### 1.1 `artifacts/api-server/src/routes/logistics.ts`
- **Status:** FROZEN Phase 4 (2026-05-30). Comment-out di `routes/index.ts` — UNREACHABLE dari luar.
- **Tabel dependensi:** `shipments` (legacy, 0 rows)
- **Sisa reader aktif:** `dashboard.ts` line 167 — **SUDAH DIHAPUS di Phase 5** (ganti ke `freightShipmentsTable`)
- **Risiko breaking change:** ❌ Tidak ada — route tidak pernah terpasang di production
- **Prasyarat sebelum delete:**
  1. ✅ Route di-unmount (Phase 4)
  2. ✅ `shipmentsTable` reader di dashboard.ts sudah dihapus (Phase 5)
  3. ✅ 0 row di tabel `shipments`
- **Aksi:** Hapus file + drop tabel `shipments` pada release berikutnya

---

### 1.2 Tabel `shipments` (legacy)
- **Rows:** 0
- **Readers aktif setelah Phase 5:** Tidak ada (dashboard.ts sudah diganti ke `freightShipmentsTable`)
- **Writers aktif:** Tidak ada (logistics.ts dismounted)
- **Schema Drizzle:** `lib/db/src/schema/` — masih ada `shipmentsTable` export
- **Migration plan:**
  1. ✅ No active writer (Phase 4 freeze)
  2. ✅ No active reader (Phase 5: dashboard fix)
  3. ✅ Backup: 0 rows — tidak ada data untuk di-backup
  4. ⏳ Mark deprecated (Phase 5 report ini)
  5. ⏳ **DROP TABLE pada release berikutnya** (setelah Drizzle schema cleanup)
- **Risiko:** ❌ Tidak ada

---

### 1.3 Tabel `workflow_events`
- **Rows:** 0
- **Dibuat oleh:** `lib/phase1Migration.ts` — CREATE TABLE IF NOT EXISTS
- **Readers aktif:** Tidak ada di seluruh codebase (grep: 0 hasil selain migration)
- **Writers aktif:** Tidak ada
- **Tujuan awal:** Event queue untuk async processing (Phase 1 plan) — tidak pernah diimplementasikan
- **Migration plan:**
  1. ✅ No active writer/reader
  2. ✅ 0 rows — tidak ada data
  3. ⏳ **DROP TABLE pada release berikutnya**
  4. ⏳ Hapus CREATE TABLE block di `phase1Migration.ts`
- **Risiko:** ❌ Tidak ada

---

## 2. SAFE TO DEPRECATE ONLY

### 2.1 Route alias `/inventory/warehouses`
- **Alias dari:** `inventoryStockRouter` (sama dengan `/inventory/stock`)
- **Callers aktif di frontend:** ❌ Tidak ada (grep: 0 hasil di bizportal + customer-portal + cst-driver)
- **Aksi Phase 5:** Tambahkan middleware deprecation warning header (`Deprecation: true`, `X-Deprecated-Route`)
- **Aksi selanjutnya:** Drop mount dari `routes/index.ts` pada release berikutnya
- **Risiko breaking change:** ❌ Sangat rendah — tidak ada frontend caller aktif

---

### 2.2 WA Template Seeder — Duplicate `CREATE TABLE` Block
- **File A:** `lib/orderNotification.ts` → `runWaTemplateMigration()` — templates standard (`order_new`, `vendor_request`)
- **File B:** `lib/enterpriseWorkflowTemplates.ts` → `runEnterpriseWorkflowMigration()` — templates enterprise (`PROCUREMENT`, `FINANCE`, `DOCUMENT`, dll)
- **Overlap:** Kedua file memiliki blok `CREATE TABLE IF NOT EXISTS whatsapp_template_configs` yang identik
- **Rows:** 107 rows di tabel — semua template aktif
- **Status:** Fungsional — tidak menyebabkan error karena `IF NOT EXISTS`
- **Aksi:**
  - JANGAN ubah isi template (akan overwrite data produksi)
  - Fase berikutnya: Pindahkan `CREATE TABLE` hanya ke satu file (misalnya ke migration dedicated)
  - **Tidak ada aksi mendesak** — ini code smell, bukan bug
- **Risiko breaking change:** ❌ Tidak ada jika tidak diubah

---

### 2.3 `freightAuditMigration.ts` — Tabel `freight_shipment_audit_logs`
- **Status:** ACTIVE. Dipakai oleh `freight.ts` (INSERT + SELECT di endpoint `/freight-shipments/:id/audit-log`)
- **Catatan untuk deprecate:** Tidak ada yang perlu di-deprecate sekarang
- **Status benar:** → Dipindahkan ke kategori KEEP (lihat section 3.4)

---

## 3. KEEP — STILL ACTIVE

### 3.1 `routes/logisticRfq.ts` — V1 RFQ Endpoints
- **Status:** AKTIF. Semua endpoint dipakai customer portal secara langsung.
- **Callers aktif (customer portal):**
  | Endpoint | File | Action |
  |---|---|---|
  | `GET /choose-option-form/:token` | `choose-option.tsx` | Load form |
  | `POST /choose-option` | `choose-option.tsx` | Submit pilihan |
  | `GET /rfq-form?rfq=&v=&token=` | `vendor-quote-form.tsx` | Load form vendor |
  | `POST /vendor-quote` | `vendor-quote-form.tsx` | Submit quote vendor |
  | `GET /vendor-confirm-page` | `vendor-confirm.tsx` | Load confirm vendor |
  | `POST /vendor-confirm` | `vendor-confirm.tsx` | Submit confirm vendor |
  | `GET /approve-form/:orderNumber` | `approve.tsx` | Load approve form |
  | `GET /logistic-vendors` | `approve.tsx` | List vendors |
  | `POST /:id/manual-rfq` | `approve.tsx` | Manual RFQ |
  | `POST /:id/resend-rfq` | `approve.tsx` | Resend RFQ |
  | `POST /:id/approve` | `approve.tsx` | Customer approve |
- **Aksi:** JANGAN hapus atau tandai deprecated — masih aktif dipakai customer portal

---

### 3.2 `routes/logisticRfqV2.ts` — V2 RFQ Endpoints (BizPortal)
- **Status:** AKTIF. Dipakai BizPortal untuk alur RFQ internal admin.
- **Aksi:** KEEP

---

### 3.3 Tabel `order_status_history`
- **Status:** AKTIF. Ditulis oleh `auditTrail.ts`, dibaca oleh `orderAuditTrail.ts`, `system.ts`, `logisticOrders.ts`, `logisticRfq.ts`.
- **Rows:** 0 (tabel baru, akan terisi saat ada aktivitas order)
- **Aksi:** KEEP

---

### 3.4 Tabel `freight_shipment_audit_logs`
- **Status:** AKTIF. Dipakai `freight.ts`:
  - INSERT di stage update handler
  - SELECT di `GET /freight-shipments/:id/audit-log`
- **Rows:** 0 (akan terisi saat ada shipment stages)
- **Aksi:** KEEP

---

### 3.5 Tabel `ai_agent_executions` + `ai_approval_queue` (AI Governance)
- **Status:** AKTIF. Dipakai `lib/aiGovernance.ts` + `routes/aiAgent.ts` + `routes/aiApprovals.ts`
- **Rows:** 0 (fitur baru, akan terisi saat AI agent digunakan)
- **Aksi:** KEEP

---

### 3.6 Tabel `onboarding_approvals` + `user_profiles` + `identity_documents`
- **Status:** AKTIF. Dipakai `routes/portal.ts` untuk flow KYC/onboarding customer portal.
  - `GET /onboarding/status`, `POST /onboarding/ktp-ocr`, `POST /onboarding/upload-doc`
- **Rows:** `user_profiles`: 7 rows (aktif), `onboarding_approvals`: 0 (akan terisi saat ada pengajuan)
- **Aksi:** KEEP

---

### 3.7 Tabel `whatsapp_template_configs`
- **Status:** AKTIF. 107 rows — template aktif untuk semua flow WA notification.
- **Managed by:** `runWaTemplateMigration()` + `runEnterpriseWorkflowMigration()`
- **Aksi:** KEEP

---

### 3.8 `routes/exceptions.ts` + Tabel `exceptions`
- **Status:** AKTIF (baru selesai Phase 4). Semua 12 test pass.
- **Aksi:** KEEP

---

## 4. NEED MANUAL REVIEW

### 4.1 `routes/logistics.ts` — Legacy Middleware Blocks
- **Issue:** File masih ada dan berisi middleware yang mem-block semua write request (return 410 Gone). Jika secara tidak sengaja file ini di-mount kembali, middleware ini akan melindungi.
- **Rekomendasi:** Review sebelum delete untuk memastikan tidak ada referenced symbol yang masih diimport elsewhere.
- **Cek yang diperlukan:**
  ```bash
  grep -rn "from.*logistics" artifacts/api-server/src/ --include="*.ts"
  ```
- **Timeline:** Delete setelah `shipmentsTable` Drizzle schema juga dihapus dari `lib/db/src/schema/`

---

### 4.2 `lib/phase1Migration.ts` — Mixed Migration File
- **Status:** Berisi 3 tabel berbeda dalam satu file:
  1. `workflow_events` → **SAFE TO DELETE** (0 rows, no callers)
  2. `intelligence_alerts` → **ACTIVE** (dipakai `intelligenceAlertsRouter`)
  3. `order_stage_logs` → **ACTIVE** (dipakai oleh order flow)
- **Issue:** Tidak bisa hapus file begitu saja — hanya hapus block `workflow_events` dari file ini
- **Aksi Phase 5:** Hapus hanya block CREATE TABLE `workflow_events` dari `phase1Migration.ts`
- **Timeline:** Setelah DROP TABLE `workflow_events` di DB

---

## 5. Perubahan yang Sudah Diterapkan di Phase 5

| Perubahan | File | Detail |
|---|---|---|
| ✅ Fix dashboard.ts | `routes/dashboard.ts` | Ganti query `shipmentsTable` → `freightShipmentsTable` (total count). Field `totalShipments` sekarang menghitung total freight shipments, bukan legacy shipments. |
| ✅ Deprecation header | `routes/index.ts` | Mount `/inventory/warehouses` sekarang return `Deprecation: true` + `X-Deprecated-Route` header sebelum `next()` |

---

## 6. Migration Plan — Tabel yang Akan Di-drop

Urutan drop yang direkomendasikan (setelah regression test full pass):

```sql
-- 1. Tabel dengan 0 rows, no callers
DROP TABLE IF EXISTS workflow_events;

-- 2. Legacy shipments table (setelah Drizzle schema cleanup)
DROP TABLE IF EXISTS shipments;

-- 3. Hapus CREATE TABLE block dari phase1Migration.ts (workflow_events)
-- 4. Hapus shipmentsTable export dari lib/db/src/schema/
-- 5. Hapus logistics.ts file
```

**JANGAN drop sebelum:**
- Regression test full pass di environment production
- Backup DB snapshot diambil
- Semua PR/changes sudah di-merge

---

## 7. Risiko Breaking Change

| Item | Risiko | Mitigasi |
|---|---|---|
| Drop `shipments` | 🟡 Rendah | Cek dulu tidak ada query raw SQL tersembunyi yang mengakses tabel ini |
| Drop `workflow_events` | ✅ Sangat rendah | 0 rows, 0 callers, hanya CREATE di migration |
| Deprecation `/inventory/warehouses` | ✅ Sangat rendah | 0 frontend callers aktif |
| Hapus `logistics.ts` | 🟡 Rendah | Cek import symbol `shipmentsTable` dari Drizzle schema masih dipakai di file lain |
| WA Seeder duplikasi | ✅ Tidak ada risiko | Tidak ada perubahan yang dilakukan |

---

## 8. Rekomendasi Final Sebelum Delete Fisik

1. **Ambil DB snapshot** sebelum DROP TABLE apapun
2. **Run regression test lengkap** (lihat section 9) — semua harus PASS
3. **Hapus dalam urutan:** workflow_events → phase1Migration cleanup → shipments (setelah Drizzle schema cleanup) → logistics.ts
4. **Jangan hapus `logisticRfq.ts`** — V1 masih aktif dipakai customer portal
5. **Jangan touch WA templates** — 107 rows data produksi, risiko overwrite tinggi
6. Untuk `/inventory/warehouses`: header deprecation sudah ditambahkan; drop mount setelah monitoring 1 sprint

---
