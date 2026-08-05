# Table Pre-Delete Impact Analysis
> Diperbarui: 2026-06-21 — Full 9-Layer Dependency Trace  
> Mencakup: Frontend React · API Routes · Drizzle Schema · Supabase Views · PG Functions · PG Triggers · Cron/Scheduler · AI Services · Export/Dashboard KPI

---

## Ringkasan Eksekutif

| Metrik | Nilai |
|--------|------:|
| Total dianalisis | **77** |
| 🔴 CRITICAL | **2** |
| 🟠 HIGH | **11** |
| 🟡 MEDIUM | **4** |
| 🟢 LOW | **13** |
| ⚪ SAFE | **47** |
| ✅ Aman di-rename (Phase 1) | **61** |
| 🚫 Diblokir — perlu tindakan manual | **16** |

> ⚠️ **Tidak ada tabel yang langsung di-DROP.** Semua tabel aman hanya di-RENAME ke `zz_deleted_*` agar mudah rollback.  
> 🔴 **CRITICAL/HIGH/MEDIUM**: Tabel masih aktif digunakan — jangan rename sebelum kode diperbaiki.

---

## Layer Coverage — 9 Layer yang Diperiksa

| # | Layer | Scope |
|---|-------|-------|
| 1 | **Frontend React** | `artifacts/bizportal/src/`, `artifacts/customer-portal/src/`, `artifacts/cst-driver/src/` |
| 2 | **API Routes Express** | `artifacts/api-server/src/routes/`, `artifacts/api-server/src/modules/` |
| 3 | **API Lib / Workers** | `artifacts/api-server/src/lib/` |
| 4 | **Drizzle Schema** | `lib/db/src/schema/` |
| 5 | **Supabase Views** | `CREATE OR REPLACE VIEW` — ditemukan di migrations & lib |
| 6 | **PG Functions** | `CREATE OR REPLACE FUNCTION` — di migration lib |
| 7 | **PG Triggers** | `CREATE TRIGGER` — di migration lib |
| 8 | **Cron / Scheduler** | `*Worker.ts`, `*scheduler*`, `*cron*` di `artifacts/api-server/src/lib/` |
| 9 | **AI Services / Dashboard** | `contextOrchestrator.ts`, `dashboard.ts`, `reports.ts`, KPI pages |

---

## Quick Reference — Semua 77 Tabel

| Tabel | Status | Risk | Rows | FK↓ | Frontend | API | Schema | View | Trigger | Scheduler | AI | Rename? |
|-------|--------|------|-----:|----:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `ai_tasks` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `attendance_records` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `bank_account_balances` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `bank_closing_periods` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `bank_coa_rules` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `bank_recon_audit_logs` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `banners` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `blast_session_logs` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `cashier_shifts` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `cms_blocks` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `cms_media` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `cms_pages` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `cms_settings` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `company_settings` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `customer_contexts` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `data_template_fields` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `data_templates` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `dispatcher_logs` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `document_audits` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `document_template_fields` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `document_templates` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `draft_agreements_wa_log` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `employee_kasbon` | DELETE_CANDIDATE | 🟢 LOW | 1 | 0 | — | — | — | — | — | — | — | ✅ |
| `employees` | DELETE_CANDIDATE | 🟢 LOW | 15 | 0 | — | — | — | — | — | — | — | ✅ |
| `finance_payment_events` | DELETE_CANDIDATE | 🟢 LOW | 11 | 0 | — | — | — | — | — | — | — | ✅ |
| `fleet_accounting_journals` | ARCHIVE | 🟠 HIGH | 0 | 0 | — | ✅ | ✅ | — | — | — | — | 🚫 |
| `fleet_expenses` | ARCHIVE | 🟠 HIGH | 0 | 0 | — | ✅ | ✅ | — | — | — | — | 🚫 |
| `fleet_ledger_entries` | ARCHIVE | 🟠 HIGH | 17 | 0 | ✅ | ✅ | — | ✅ | ✅ | — | — | 🚫 |
| `fleet_outstanding_import_log` | ARCHIVE | 🟠 HIGH | 0 | 0 | — | ✅ | — | — | — | — | — | 🚫 |
| `fleet_partners` | ARCHIVE | 🔴 CRITICAL | 0 | 3 | ✅ | ✅ | ✅ | — | — | ✅ | — | 🚫 |
| `fleet_pipeline_health` | ARCHIVE | 🟠 HIGH | 0 | 0 | — | ✅ | — | — | — | — | — | 🚫 |
| `fleet_reconciliation_reports` | ARCHIVE | 🟠 HIGH | 0 | 0 | — | ✅ | — | — | — | — | — | 🚫 |
| `fleet_vehicles` | ARCHIVE | 🔴 CRITICAL | 0 | 2 | ✅ | ✅ | ✅ | — | — | — | — | 🚫 |
| `fleet_wa_logs` | ARCHIVE | 🟠 HIGH | 0 | 0 | — | ✅ | — | — | — | — | — | 🚫 |
| `follow_up_logs` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `gym_memberships` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `intent_master` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `keyword_rules` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `leave_requests` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `operational_checklists` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `operational_expenses` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `order_asuransi` | DELETE_CANDIDATE | 🟢 LOW | 19 | 0 | — | — | — | — | — | — | — | ✅ |
| `otp_tokens` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `page_products` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `payment_receipts` | DELETE_CANDIDATE | 🟢 LOW | 11 | 0 | — | — | — | — | — | — | — | ✅ |
| `promo_registrations` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `public_tokens` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `registration_link_wa_log` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `sc_admin_notes` | ARCHIVE | 🟢 LOW | 0 | 0 | — | — | ✅ | — | — | — | — | ✅ |
| `sc_blocked_schedules` | ARCHIVE | 🟢 LOW | 0 | 0 | — | — | ✅ | — | — | — | — | ✅ |
| `sc_facility_images` | ARCHIVE | 🟢 LOW | 0 | 0 | — | — | ✅ | — | — | — | — | ✅ |
| `sc_payments` | ARCHIVE | 🟠 HIGH | 0 | 0 | — | ✅ | — | — | — | — | — | 🚫 |
| `sc_promos` | ARCHIVE | 🟢 LOW | 0 | 0 | — | — | ✅ | — | — | — | — | ✅ |
| `sc_settings` | ARCHIVE | 🟢 LOW | 0 | 0 | — | — | ✅ | — | — | — | — | ✅ |
| `service_catalog` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `service_circuit_states` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `service_registry` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `shipment_events` | ARCHIVE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `shipment_stages` | ARCHIVE | 🟡 MEDIUM | 0 | 0 | ✅ | — | ✅ | — | — | — | ✅ | 🚫 |
| `shipment_trackings` | ARCHIVE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `shipments` | ARCHIVE | 🟢 LOW | 0 | 0 | ⚠️ | — | ✅ | — | — | — | — | ✅* |
| `sport_center_bookings` | ARCHIVE | 🟡 MEDIUM | 2 | 0 | — | ✅ | — | — | — | — | — | 🚫 |
| `sport_center_expenses` | ARCHIVE | 🟢 LOW | 0 | 0 | — | — | ✅ | — | — | — | — | ✅ |
| `sport_center_facilities` | ARCHIVE | 🟡 MEDIUM | 2 | 1 | — | ✅ | — | — | — | — | — | 🚫 |
| `sport_center_memberships` | ARCHIVE | 🟠 HIGH | 0 | 0 | — | ✅ | — | — | — | — | — | 🚫 |
| `system_settings` | DELETE_CANDIDATE | ⚪ SAFE | 1 | 0 | — | — | — | — | — | — | — | ✅ |
| `task_assignments` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `task_attachments` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `task_comments` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `task_timeline` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `team_members` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `transaction_datetime_normalized` | ARCHIVE | 🟠 HIGH | 0 | 0 | — | ✅ | — | — | — | — | — | 🚫 |
| `user_site_access` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `wa_send_logs` | DELETE_CANDIDATE | 🟢 LOW | 12 | 0 | — | — | — | — | — | — | — | ✅ |
| `whatsapp_messages` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `whatsapp_notifications` | DELETE_CANDIDATE | ⚪ SAFE | 0 | 0 | — | — | — | — | — | — | — | ✅ |
| `workflow_events` | ARCHIVE | 🟠 HIGH | 0 | 0 | — | ✅ | — | — | — | — | — | 🚫 |

> ⚠️ `shipments*` — Frontend references menggunakan nama variabel `shipments` tetapi **semua query sebenarnya ke tabel `freight_shipments`** — bukan legacy `shipments`. Namun Drizzle schema masih aktif.

---

## 🔴 CRITICAL — Jangan Disentuh (2)

---

### `fleet_partners`

| Field | Value |
|-------|-------|
| **Audit Status** | ARCHIVE |
| **Risk Level** | 🔴 **CRITICAL** |
| **Row Count** | 0 |
| **FK Masuk (↓)** | 3 — fleet_vehicles, fleet_drivers, fleet_reports (ON DELETE SET NULL) |
| **FK Keluar (↑)** | 0 |
| **Rename Safe** | 🚫 Tidak |

#### 9-Layer Dependency Trace

| Layer | Status | Detail |
|-------|--------|--------|
| **1. Frontend React** | ✅ Ada | `artifacts/bizportal/src/pages/logistics/fleet-intelligence/upload.tsx:131` — `queryKey: ["fleet-partners"]` dipakai untuk invalidasi cache upload |
| **2. API Routes** | ✅ Ada | `artifacts/api-server/src/routes/fleetIntelligence.ts` |
| **3. API Lib / Workers** | ✅ Ada | `artifacts/api-server/src/lib/fleetNotificationWorker.ts:35` |
| **4. Drizzle Schema** | ✅ Ada | `lib/db/src/schema/fleetIntelligence.ts:16` — `fleetPartnersTable = pgTable("fleet_partners")` |
| **5. Supabase Views** | — | Tidak ada |
| **6. PG Functions** | — | Tidak ada |
| **7. PG Triggers** | — | Tidak ada |
| **8. Cron / Scheduler** | ✅ Ada | `fleetNotificationWorker.ts:35` — `SELECT DISTINCT company_id FROM fleet_partners WHERE is_active = TRUE` (berjalan berkala) |
| **9. AI / Dashboard** | — | Tidak ada |

**Referensi API Detail:**
- `fleetIntelligence.ts:118` — Inline `CREATE TABLE IF NOT EXISTS fleet_partners` (migration aktif dijalankan setiap boot)
- `fleetIntelligence.ts:119` — `CREATE INDEX IF NOT EXISTS fleet_partners_company_idx`
- `fleetIntelligence.ts:652` — `SELECT * FROM fleet_partners WHERE company_id = ${companyId}` (GET aktif)
- `fleetIntelligence.ts:668` — `INSERT INTO fleet_partners` (POST aktif)
- `fleetIntelligence.ts:686` — `UPDATE fleet_partners SET ...` (PUT aktif)
- `fleetIntelligence.ts:716` — `LEFT JOIN fleet_partners p ON p.id = r.partner_id` (JOIN di report list)
- `fleetIntelligence.ts:3763` — `LEFT JOIN fleet_partners p ON p.id = r.partner_id` (JOIN di analytics)
- `fleetIntelligence.ts:122,127,133` — `fleet_reports`, `fleet_drivers`, `fleet_vehicles` semua punya FK ke fleet_partners

**❌ Tidak dapat di-rename sebelum:**
1. Hapus inline `CREATE TABLE IF NOT EXISTS` di `fleetIntelligence.ts:118` (boot migration aktif)
2. Hapus semua route CRUD (GET/POST/PUT) di `fleetIntelligence.ts` yang query fleet_partners
3. Hapus queryKey `["fleet-partners"]` di upload.tsx
4. Hapus scheduler query di `fleetNotificationWorker.ts:35`
5. Hapus `fleetPartnersTable` dari Drizzle schema dan regenerasi client
6. Pastikan FK child tables (fleet_vehicles, fleet_drivers, fleet_reports) tidak null-out ke row yang tidak ada

---

### `fleet_vehicles`

| Field | Value |
|-------|-------|
| **Audit Status** | ARCHIVE |
| **Risk Level** | 🔴 **CRITICAL** |
| **Row Count** | 0 |
| **FK Masuk (↓)** | 2 — fleet_transactions (vehicle_id ON DELETE SET NULL) |
| **FK Keluar (↑)** | 2 — ke fleet_partners, ke fleet_drivers |
| **Rename Safe** | 🚫 Tidak |

#### 9-Layer Dependency Trace

| Layer | Status | Detail |
|-------|--------|--------|
| **1. Frontend React** | ✅ Ada | Halaman dedicated + route terdaftar |
| **2. API Routes** | ✅ Ada | `artifacts/api-server/src/routes/fleetIntelligence.ts` (multiple) |
| **3. API Lib / Workers** | — | Tidak ada langsung |
| **4. Drizzle Schema** | ✅ Ada | `lib/db/src/schema/fleetIntelligence.ts:92` — `fleetVehiclesTable = pgTable("fleet_vehicles")` |
| **5. Supabase Views** | — | Tidak ada |
| **6. PG Functions** | — | Tidak ada |
| **7. PG Triggers** | — | Tidak ada |
| **8. Cron / Scheduler** | — | Tidak ada langsung |
| **9. AI / Dashboard** | — | Tidak ada |

**Frontend Detail:**
- `artifacts/bizportal/src/pages/logistics/fleet-intelligence/vehicles.tsx` — halaman dedicated Fleet Vehicles
- `artifacts/bizportal/src/routes.tsx:232` — `import FleetVehiclesPage`
- `artifacts/bizportal/src/routes.tsx:328` — `withErrorBoundary(FleetVehiclesPage, "Fleet Intelligence – Vehicles")`
- `artifacts/bizportal/src/routes.tsx:736` — `<Route path="/logistics/fleet-intelligence/vehicles" component=...>`

**Referensi API Detail:**
- `fleetIntelligence.ts:132` — Inline `CREATE TABLE IF NOT EXISTS fleet_vehicles` (boot migration aktif)
- `fleetIntelligence.ts:133-135` — CREATE INDEX (plate_idx, company_idx)
- `fleetIntelligence.ts:137` — `fleet_transactions` dibuat dengan FK ke `fleet_vehicles(id)`
- `fleetIntelligence.ts:2255` — SELECT gabungan `fleet_vehicles + gojek_raw_transactions`
- `fleetIntelligence.ts:2279,2301,2319,2339` — INSERT INTO fleet_vehicles (multiple points)
- `fleetIntelligence.ts:3842` — DDL `vehicle_id INTEGER REFERENCES fleet_vehicles(id) ON DELETE SET NULL`
- `fleetIntelligence.ts:3894,4070` — LEFT JOIN fleet_vehicles

**❌ Tidak dapat di-rename sebelum:**
1. Hapus halaman frontend `/logistics/fleet-intelligence/vehicles` dan route-nya
2. Hapus inline `CREATE TABLE IF NOT EXISTS fleet_vehicles` di `fleetIntelligence.ts:132`
3. Hapus semua query INSERT/SELECT yang menyebut fleet_vehicles
4. Hapus `fleetVehiclesTable` dari Drizzle schema
5. Hapus FK reference dari fleet_transactions → fleet_vehicles

---

## 🟠 HIGH — Perlu Perbaikan Kode (11)

---

### `fleet_ledger_entries` ⭐ Prioritas Khusus

| Field | Value |
|-------|-------|
| **Audit Status** | ARCHIVE |
| **Risk Level** | 🟠 **HIGH** |
| **Row Count** | **17** (data aktif) |
| **FK Masuk (↓)** | 0 |
| **FK Keluar (↑)** | 0 |
| **Rename Safe** | 🚫 Tidak |

#### 9-Layer Dependency Trace

| Layer | Status | Detail |
|-------|--------|--------|
| **1. Frontend React** | ✅ Ada | `ledger-explorer.tsx` di fleet-intelligence module; `financial-reconciliation.tsx` menampilkan data dari API ledger |
| **2. API Routes** | ✅ Ada | `artifacts/api-server/src/routes/ledger.ts` (8 referensi), `reconciliation.ts` (4 referensi) |
| **3. API Lib / Workers** | ✅ Ada | `artifacts/api-server/src/lib/accounting.ts` (5 referensi), `financialClosingMigration.ts` |
| **4. Drizzle Schema** | — | Tidak ada (dibuat via raw SQL migration, bukan pgTable) |
| **5. Supabase Views** | ✅ Ada | `v_ledger_balance_view` dan `v_ledger_journal_view` — keduanya SELECT FROM fleet_ledger_entries |
| **6. PG Functions** | ✅ Ada | `fn_ledger_period_lock()` — RETURNS TRIGGER LANGUAGE plpgsql |
| **7. PG Triggers** | ✅ Ada | `trg_ledger_period_lock` (BEFORE INSERT) · `trg_fleet_ledger_immutable` (BEFORE UPDATE/DELETE) |
| **8. Cron / Scheduler** | — | Tidak ada langsung |
| **9. AI / Dashboard** | ✅ Ada | `/api/logistics/fleet/ledger` dipakai oleh `ledger-explorer.tsx` queryKey |

**Frontend Detail:**
- `artifacts/bizportal/src/pages/logistics/fleet-intelligence/ledger-explorer.tsx:90` — `queryKey: ["fleet-ledger-explorer"]`
- `artifacts/bizportal/src/pages/logistics/fleet-intelligence/ledger-explorer.tsx:92` — `fetch("/api/logistics/fleet/ledger")`
- `artifacts/bizportal/src/pages/accounting/financial-reconciliation.tsx:141-198` — menampilkan `ledger.debit`, `ledger.credit`, `ledger_debit`, `ledger_credit` dari API reconciliation

**Referensi API Detail:**
- `ledger.ts:4` — "fleet_ledger_entries is the SINGLE SOURCE OF TRUTH for all financial data"
- `ledger.ts:40` — `FROM fleet_ledger_entries fle` (GET balance)
- `ledger.ts:103` — `FROM fleet_ledger_entries` (GET list)
- `ledger.ts:136` — `SELECT * FROM fleet_ledger_entries WHERE id = ${id} FOR UPDATE` (write lock)
- `ledger.ts:156` — `INSERT INTO fleet_ledger_entries` (POST create)
- `ledger.ts:185` — `UPDATE fleet_ledger_entries` (PUT update)
- `ledger.ts:344` — `FROM fleet_ledger_entries fle` (integrity check)
- `reconciliation.ts:84,90,131` — source of truth untuk reconciliation report
- `accounting.ts:464,487-499` — "SOURCE OF TRUTH: fleet_ledger_entries (bukan accounting_entry_lines)"

**Supabase Views yang bergantung:**
```sql
-- v_ledger_balance_view (lib/db/drizzle/0010_financial_core_stabilization.sql:139)
CREATE OR REPLACE VIEW v_ledger_balance_view AS
SELECT company_id, period, account_id, ...
FROM fleet_ledger_entries WHERE is_voided = false
GROUP BY ...;

-- v_ledger_journal_view (lib/db/drizzle/0010_financial_core_stabilization.sql:116)
CREATE OR REPLACE VIEW v_ledger_journal_view AS
SELECT fle.company_id, fle.period, ...
FROM fleet_ledger_entries fle WHERE fle.is_voided = false
GROUP BY ...;
```

**PG Trigger aktif:**
```sql
-- financialClosingMigration.ts:152-200
CREATE OR REPLACE FUNCTION fn_ledger_period_lock() RETURNS TRIGGER LANGUAGE plpgsql AS $$...$$;
CREATE TRIGGER trg_ledger_period_lock BEFORE INSERT ON fleet_ledger_entries ...;
-- trg_fleet_ledger_immutable (BEFORE UPDATE/DELETE — dari migration terpisah)
```

**❌ Tidak dapat di-rename sebelum:**
1. Migrasi semua data (17 baris) ke tabel pengganti (misal `accounting_ledger_entries`)
2. DROP VIEW `v_ledger_balance_view` dan `v_ledger_journal_view`
3. DROP TRIGGER `trg_ledger_period_lock` dan `trg_fleet_ledger_immutable`
4. DROP FUNCTION `fn_ledger_period_lock`
5. Refactor `ledger.ts` dan `reconciliation.ts` untuk pakai tabel baru
6. Refactor `accounting.ts` (source of truth)
7. Hapus halaman `ledger-explorer.tsx` atau redirect ke endpoint baru

---

### `fleet_accounting_journals`

| Field | Value |
|-------|-------|
| **Risk Level** | 🟠 HIGH |
| **Row Count** | 0 |
| **API Refs** | `fleetIntelligence.ts` (query aktif) |
| **Schema** | `lib/db/src/schema/fleetIntelligence.ts` |
| **Rename Safe** | 🚫 Tidak |

---

### `fleet_expenses`

| Field | Value |
|-------|-------|
| **Risk Level** | 🟠 HIGH |
| **Row Count** | 0 |
| **API Refs** | `fleetIntelligence.ts` |
| **Schema** | `lib/db/src/schema/fleetIntelligence.ts` |
| **Rename Safe** | 🚫 Tidak |

---

### `fleet_outstanding_import_log`

| Field | Value |
|-------|-------|
| **Risk Level** | 🟠 HIGH |
| **Row Count** | 0 |
| **API Refs** | `fleetIntelligence.ts` |
| **Rename Safe** | 🚫 Tidak |

---

### `fleet_pipeline_health`

| Field | Value |
|-------|-------|
| **Risk Level** | 🟠 HIGH |
| **Row Count** | 0 |
| **API Refs** | `fleetIntelligence.ts` |
| **Rename Safe** | 🚫 Tidak |

---

### `fleet_reconciliation_reports`

| Field | Value |
|-------|-------|
| **Risk Level** | 🟠 HIGH |
| **Row Count** | 0 |
| **API Refs** | `fleetIntelligence.ts` |
| **Rename Safe** | 🚫 Tidak |

---

### `fleet_wa_logs`

| Field | Value |
|-------|-------|
| **Risk Level** | 🟠 HIGH |
| **Row Count** | 0 |
| **API Refs** | `fleetIntelligence.ts` |
| **Rename Safe** | 🚫 Tidak |

---

### `sc_payments`

| Field | Value |
|-------|-------|
| **Risk Level** | 🟠 HIGH |
| **Row Count** | 0 |
| **API Refs** | `sport-center/routes.ts:4931-4932` |
| **Rename Safe** | 🚫 Tidak |

---

### `sport_center_memberships`

| Field | Value |
|-------|-------|
| **Risk Level** | 🟠 HIGH |
| **Row Count** | 0 |
| **API Refs** | `sport-center/routes.ts` (query aktif) |
| **Rename Safe** | 🚫 Tidak |

---

### `transaction_datetime_normalized`

| Field | Value |
|-------|-------|
| **Risk Level** | 🟠 HIGH |
| **Row Count** | 0 |
| **API Refs** | `fleetIntelligence.ts` |
| **Rename Safe** | 🚫 Tidak |

---

### `workflow_events`

| Field | Value |
|-------|-------|
| **Risk Level** | 🟠 HIGH |
| **Row Count** | 0 |
| **API Refs** | `workflowWorker.ts` + 3 lib files |
| **Schema** | `lib/db/src/schema/workflowEvents.ts` |
| **Rename Safe** | 🚫 Tidak |

---

## 🟡 MEDIUM — Diblokir, Perlu Tindakan (4)

---

### `sport_center_bookings` ⭐ Prioritas Khusus

| Field | Value |
|-------|-------|
| **Audit Status** | ARCHIVE |
| **Risk Level** | 🟡 **MEDIUM** |
| **Row Count** | 2 |
| **FK Masuk (↓)** | 0 |
| **FK Keluar (↑)** | 0 |
| **Rename Safe** | 🚫 Tidak |

#### 9-Layer Dependency Trace

| Layer | Status | Detail |
|-------|--------|--------|
| **1. Frontend React** | — | Tidak ditemukan referensi di `bizportal/src` atau `customer-portal/src` |
| **2. API Routes** | ✅ Ada | `sport-center/routes.ts:4749` — INSERT ON CONFLICT (sync aktif) |
| **3. API Lib / Workers** | ✅ Ada | `sport-center/migration.ts` (8 referensi DDL + query), `sport-center/supabaseSync.ts` (2 referensi INSERT) |
| **4. Drizzle Schema** | — | Tidak ada pgTable definition — dibuat via raw SQL migration |
| **5. Supabase Views** | — | Tidak ada |
| **6. PG Functions** | — | Tidak ada |
| **7. PG Triggers** | — | Tidak ada |
| **8. Cron / Scheduler** | — | Tidak ada |
| **9. AI / Dashboard** | — | Tidak ada |

**Referensi API Detail:**
- `migration.ts:323` — "Upsert customers & bookings dari legacy sport_center_bookings (hanya jika tabel ada)"
- `migration.ts:327` — `WHERE table_schema = 'public' AND table_name = 'sport_center_bookings'` (guard check)
- `migration.ts:341,378` — `FROM sport_center_bookings b` (SELECT sebagai sumber migrasi)
- `migration.ts:423-429` — `ALTER TABLE sport_center_bookings ADD COLUMN IF NOT EXISTS ...` (DDL aktif saat boot)
- `migration.ts:446-449` — ADD CONSTRAINT jika tabel ada
- `migration.ts:490` — "Pull semua booking dari Supabase sport_center_bookings → sport_bookings"
- `routes.ts:4749` — **INSERT ON CONFLICT aktif**: `INSERT INTO sport_center_bookings (...) ON CONFLICT (booking_code) DO UPDATE SET ...`
- `supabaseSync.ts:383` — `INSERT INTO sport_center_bookings` (sync to Supabase)
- `supabaseSync.ts:529` — `INSERT INTO sport_center_bookings` (sync to Supabase)

**❌ Tidak dapat di-rename sebelum:**
1. Hapus INSERT aktif di `routes.ts:4749` (sync write ke sport_center_bookings)
2. Hapus INSERT di `supabaseSync.ts:383` dan `supabaseSync.ts:529`
3. Hapus DDL ALTER TABLE di `migration.ts:423-429`
4. Verifikasi data 2 baris sudah dimigrasikan ke `sport_bookings`

---

### `sport_center_facilities` ⭐ Prioritas Khusus

| Field | Value |
|-------|-------|
| **Audit Status** | ARCHIVE |
| **Risk Level** | 🟡 **MEDIUM** |
| **Row Count** | 2 |
| **FK Masuk (↓)** | 1 (sport_center_bookings mungkin referensi via Supabase schema) |
| **FK Keluar (↑)** | 0 |
| **Rename Safe** | 🚫 Tidak |

#### 9-Layer Dependency Trace

| Layer | Status | Detail |
|-------|--------|--------|
| **1. Frontend React** | — | Tidak ditemukan referensi di frontend |
| **2. API Routes** | ✅ Ada | `sport-center/routes.ts:4716` — SELECT aktif |
| **3. API Lib / Workers** | ✅ Ada | `sport-center/supabaseSync.ts` (3 referensi) |
| **4. Drizzle Schema** | — | Tidak ada pgTable definition |
| **5. Supabase Views** | — | Tidak ada |
| **6. PG Functions** | — | Tidak ada |
| **7. PG Triggers** | — | Tidak ada |
| **8. Cron / Scheduler** | — | Tidak ada |
| **9. AI / Dashboard** | — | Tidak ada |

**Referensi API Detail:**
- `routes.ts:4716` — **SELECT aktif**: `.from("sport_center_facilities").select("id, name").limit(200)` (via Supabase client)
- `supabaseSync.ts:246` — `.from("sport_center_facilities")` (Supabase query)
- `supabaseSync.ts:251` — `UPDATE sport_center_facilities SET is_active = false` (write aktif)
- `supabaseSync.ts:253` — `sport_center_facilities soft-delete OK`
- `supabaseSync.ts:306` — catatan: "Must query sport_center.facilities (same schema as bookings FK target)"

**❌ Tidak dapat di-rename sebelum:**
1. Hapus SELECT di `routes.ts:4716`
2. Hapus semua query di `supabaseSync.ts` yang menyebut sport_center_facilities
3. Verifikasi data 2 baris sudah dipindahkan ke `sc_facilities` atau tabel pengganti

---

### `shipment_stages` ⭐ Prioritas Khusus

| Field | Value |
|-------|-------|
| **Audit Status** | ARCHIVE |
| **Risk Level** | 🟡 **MEDIUM** |
| **Row Count** | 0 |
| **FK Masuk (↓)** | 0 |
| **FK Keluar (↑)** | 0 |
| **Rename Safe** | 🚫 Tidak |

#### 9-Layer Dependency Trace

| Layer | Status | Detail |
|-------|--------|--------|
| **1. Frontend React** | ✅ Ada | `logistics-freight-detail.tsx` — aktif menggunakan ShipmentStage type + mutation hook |
| **2. API Routes** | — | Tidak ada route langsung ke shipment_stages |
| **3. API Lib / Workers** | ✅ Ada | `contextOrchestrator.ts:474` — AI context builder query |
| **4. Drizzle Schema** | ✅ Ada | `lib/db/src/schema/shipmentStages.ts` — full table + enum definition |
| **5. Supabase Views** | — | Tidak ada |
| **6. PG Functions** | — | Tidak ada |
| **7. PG Triggers** | — | Tidak ada |
| **8. Cron / Scheduler** | — | Tidak ada |
| **9. AI Services** | ✅ Ada | `contextOrchestrator.ts:474` — `FROM shipment_stages` untuk build AI context |

**Frontend Detail:**
- `logistics-freight-detail.tsx:45` — `import { useUpsertShipmentStage }` dari API client generated
- `logistics-freight-detail.tsx:54` — `import { type ShipmentStage }` dari `@workspace/db`
- `logistics-freight-detail.tsx:169` — `const upsertStage = useUpsertShipmentStage()`
- `logistics-freight-detail.tsx:170` — "Subset dari ShipmentStageType (@workspace/db)"
- `logistics-freight-detail.tsx:208` — `const stages: ShipmentStage[] = typedShipment.stages ?? []`
- `logistics-freight-detail.tsx:863` — `(typedShipment?.stages ?? []).find((s: ShipmentStage) => s.stageType === type)`

**Drizzle Schema:**
```typescript
// lib/db/src/schema/shipmentStages.ts
export const shipmentStageTypeEnum = pgEnum("shipment_stage_type", [
  "booking", "trucking", "handling", "customs",
  "pickup", "customs_export", "sea_freight", "customs_import", "delivery",
]);
export const shipmentStagesTable = pgTable("shipment_stages", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id").notNull(),
  stageType: shipmentStageTypeEnum("stage_type").notNull(),
  ...
});
```

**❌ Tidak dapat di-rename sebelum:**
1. Hapus `shipmentStagesTable` dari `lib/db/src/schema/shipmentStages.ts` dan index.ts
2. Update frontend `logistics-freight-detail.tsx` — hapus import `useUpsertShipmentStage` dan `ShipmentStage`
3. Hapus query di `contextOrchestrator.ts:474`
4. Regenerasi API client (`pnpm --filter @workspace/api-client-react run codegen`)
5. DROP ENUM `shipment_stage_type` setelah tabel di-rename

---

### `sc_payments` (sudah tercakup di HIGH section di atas)

---

## 🟢 LOW — Aman di-rename, Perlu Perhatian

---

### `shipments` ⭐ Prioritas Khusus

| Field | Value |
|-------|-------|
| **Audit Status** | ARCHIVE |
| **Risk Level** | 🟢 **LOW** |
| **Row Count** | 0 |
| **FK Masuk (↓)** | 0 |
| **FK Keluar (↑)** | 0 |
| **Rename Safe** | ✅ Ya (setelah langkah di bawah) |

#### 9-Layer Dependency Trace

| Layer | Status | Detail |
|-------|--------|--------|
| **1. Frontend React** | ⚠️ Indirect | Variabel bernama `shipments` ada di 19+ file TAPI semua mengacu ke data query `freight_shipments`, **bukan tabel `shipments` legacy** |
| **2. API Routes** | — | Tidak ada direct SQL `FROM shipments` atau `INTO shipments` di routes/lib |
| **3. API Lib / Workers** | — | Tidak ada |
| **4. Drizzle Schema** | ✅ Ada | `lib/db/src/schema/shipments.ts:25` — `shipmentsTable = pgTable("shipments")` masih aktif di schema |
| **5. Supabase Views** | — | Tidak ada |
| **6. PG Functions** | — | Tidak ada |
| **7. PG Triggers** | — | Tidak ada |
| **8. Cron / Scheduler** | — | Tidak ada |
| **9. AI / Dashboard** | — | Tidak ada |

**Frontend Klarifikasi:** Semua referensi `shipments` di frontend (expense/index.tsx, logistics-freight.tsx, logistics.tsx, logistics/shipments.tsx, routes.tsx) menggunakan `shipments` sebagai **nama variabel** untuk data dari `useFreightShipments()` atau `useGetFreightShipments()` — yang query ke `freight_shipments`, bukan tabel legacy ini.

**Drizzle Schema:**
```typescript
// lib/db/src/schema/shipments.ts
export const shipmentsTable = pgTable("shipments", {
  id: serial("id").primaryKey(),
  ...
});
export type Shipment = typeof shipmentsTable.$inferSelect;
```
Tabel ini masih di-export dari schema meskipun tidak ada route yang query-nya.

**✅ Langkah rename:**
1. Hapus atau deprecate `lib/db/src/schema/shipments.ts` (hapus export dari index.ts)
2. Jalankan `drizzle-kit generate` untuk generate migration yang drop tabel
3. Jalankan `ALTER TABLE shipments RENAME TO zz_deleted_shipments`

---

### `employees` ⭐ Prioritas Khusus

| Field | Value |
|-------|-------|
| **Audit Status** | DELETE_CANDIDATE |
| **Risk Level** | 🟢 **LOW** |
| **Row Count** | 15 |
| **FK Masuk (↓)** | 0 |
| **FK Keluar (↑)** | 0 |
| **Rename Safe** | ✅ Ya (setelah backup data) |

#### 9-Layer Dependency Trace

| Layer | Status | Detail |
|-------|--------|--------|
| **1. Frontend React** | ⚠️ Indirect | `kasbon.tsx:601-609` menampilkan `detail.employee.name/email/department` TAPI ini dari API `cash_advances` join users, bukan tabel `employees` langsung |
| **2. API Routes** | — | Tidak ada SQL `FROM employees` atau `INTO employees` ditemukan di routes |
| **3. API Lib / Workers** | — | Tidak ada |
| **4. Drizzle Schema** | — | Tidak ada pgTable definition untuk tabel `employees` |
| **5. Supabase Views** | — | Tidak ada |
| **6. PG Functions** | — | Tidak ada |
| **7. PG Triggers** | — | Tidak ada |
| **8. Cron / Scheduler** | — | Tidak ada |
| **9. AI / Dashboard** | — | Tidak ada |

**Catatan:** Tabel `employees` berisi 15 baris data legacy. Tidak ditemukan query aktif dari kode. Data mungkin dipakai oleh `employee_profiles` atau skema lama sebelum refactor ke `users`. Backup data sebelum rename.

**✅ Langkah rename:**
1. Export data: `SELECT * FROM employees` → simpan sebagai CSV/backup
2. `ALTER TABLE employees RENAME TO zz_deleted_employees`

---

### `employee_kasbon` ⭐ Prioritas Khusus

| Field | Value |
|-------|-------|
| **Audit Status** | DELETE_CANDIDATE |
| **Risk Level** | 🟢 **LOW** |
| **Row Count** | 1 |
| **FK Masuk (↓)** | 0 |
| **FK Keluar (↑)** | 0 |
| **Rename Safe** | ✅ Ya (setelah backup data) |

#### 9-Layer Dependency Trace

| Layer | Status | Detail |
|-------|--------|--------|
| **1. Frontend React** | ⚠️ Indirect | `kasbon.tsx` punya halaman kasbon TAPI referensi "kasbon" di backend menggunakan tabel `cash_advances` (type='kasbon'), bukan tabel `employee_kasbon` |
| **2. API Routes** | — | Tidak ada SQL ke `employee_kasbon` — `cashAdvances.ts` pakai tabel `cash_advances` dengan kolom `type='kasbon'` |
| **3. API Lib / Workers** | — | `journalMappingService.ts` menggunakan `kasbonReceivable` sebagai COA account (bukan tabel) |
| **4. Drizzle Schema** | — | Tidak ada pgTable definition |
| **5. Supabase Views** | — | Tidak ada |
| **6. PG Functions** | — | Tidak ada |
| **7. PG Triggers** | — | Tidak ada |
| **8. Cron / Scheduler** | — | Tidak ada |
| **9. AI / Dashboard** | — | Tidak ada |

**Catatan:** Kata "kasbon" di kodebase semuanya merujuk ke `cash_advances.type = 'kasbon'` atau COA account `kasbonReceivable` — bukan tabel `employee_kasbon`. Tabel ini adalah legacy dari sistem lama.

**✅ Langkah rename:**
1. Export data: `SELECT * FROM employee_kasbon` → simpan (1 baris)
2. `ALTER TABLE employee_kasbon RENAME TO zz_deleted_employee_kasbon`

---

### `shipment_events` ⭐ Prioritas Khusus

| Field | Value |
|-------|-------|
| **Audit Status** | ARCHIVE |
| **Risk Level** | ⚪ **SAFE** |
| **Row Count** | 0 |
| **Rename Safe** | ✅ Ya |

#### 9-Layer Dependency Trace

| Layer | Status |
|-------|--------|
| Frontend React | — |
| API Routes | — |
| API Lib | — |
| Drizzle Schema | — |
| Supabase Views | — |
| PG Functions | — |
| PG Triggers | — |
| Cron/Scheduler | — |
| AI/Dashboard | — |

Tidak ada referensi aktif di semua 9 layer. Hanya muncul di script audit (bukan kode produksi).

---

### `shipment_trackings` ⭐ Prioritas Khusus

| Field | Value |
|-------|-------|
| **Audit Status** | ARCHIVE |
| **Risk Level** | ⚪ **SAFE** |
| **Row Count** | 0 |
| **Rename Safe** | ✅ Ya |

#### 9-Layer Dependency Trace

| Layer | Status |
|-------|--------|
| Frontend React | — |
| API Routes | — |
| API Lib | — |
| Drizzle Schema | — |
| Supabase Views | — |
| PG Functions | — |
| PG Triggers | — |
| Cron/Scheduler | — |
| AI/Dashboard | — |

Tidak ada referensi aktif di semua 9 layer.

---

## ⚪ SAFE — Aman di-rename Phase 1 (47 tabel)

Tabel-tabel berikut **tidak ditemukan referensinya di semua 9 layer** dan aman di-rename:

`ai_tasks`, `attendance_records`, `bank_account_balances`, `bank_closing_periods`, `bank_coa_rules`, `bank_recon_audit_logs`, `banners`, `blast_session_logs`, `cashier_shifts`, `cms_blocks`, `cms_media`, `cms_pages`, `cms_settings`, `company_settings`, `customer_contexts`, `data_template_fields`, `data_templates`, `dispatcher_logs`, `document_audits`, `document_template_fields`, `document_templates`, `draft_agreements_wa_log`, `finance_payment_events`, `follow_up_logs`, `gym_memberships`, `intent_master`, `keyword_rules`, `leave_requests`, `operational_checklists`, `operational_expenses`, `otp_tokens`, `page_products`, `promo_registrations`, `public_tokens`, `registration_link_wa_log`, `sc_admin_notes`, `sc_blocked_schedules`, `sc_facility_images`, `sc_promos`, `sc_settings`, `service_catalog`, `service_circuit_states`, `service_registry`, `shipment_events`, `shipment_trackings`, `system_settings`, `task_assignments`, `task_attachments`, `task_comments`, `task_timeline`, `team_members`, `user_site_access`, `wa_send_logs`, `whatsapp_messages`, `whatsapp_notifications`

---

## 🏗️ Supabase Views & PG Artifacts yang Ditemukan

### Views yang Bergantung pada Tabel ARCHIVE

| View | Bergantung pada | Risk jika tabel direname |
|------|----------------|--------------------------|
| `v_ledger_balance_view` | `fleet_ledger_entries` | 🔴 VIEW BROKEN |
| `v_ledger_journal_view` | `fleet_ledger_entries` | 🔴 VIEW BROKEN |

### PG Functions & Triggers pada Tabel ARCHIVE

| Function/Trigger | Tabel Target | Tipe | Risk |
|-----------------|-------------|------|------|
| `fn_ledger_period_lock()` | `fleet_ledger_entries` | FUNCTION | 🔴 Orphaned function |
| `trg_ledger_period_lock` | `fleet_ledger_entries` | BEFORE INSERT TRIGGER | 🔴 TRIGGER BROKEN |
| `trg_fleet_ledger_immutable` | `fleet_ledger_entries` | BEFORE UPDATE/DELETE TRIGGER | 🔴 TRIGGER BROKEN |

**Action sebelum rename `fleet_ledger_entries`:**
```sql
DROP TRIGGER IF EXISTS trg_ledger_period_lock ON fleet_ledger_entries;
DROP TRIGGER IF EXISTS trg_fleet_ledger_immutable ON fleet_ledger_entries;
DROP FUNCTION IF EXISTS fn_ledger_period_lock();
DROP VIEW IF EXISTS v_ledger_balance_view;
DROP VIEW IF EXISTS v_ledger_journal_view;
```

---

## 📋 Rekomendasi & Urutan Eksekusi

### Phase 1 — Rename SAFE (61 tabel) ✅
Jalankan `migrations/archive-phase-1.sql`. Tidak ada kode yang perlu diubah.

### Phase 2 — Fix Kode, lalu Rename MEDIUM (4 tabel) 🟡
Urutan prioritas:
1. `sport_center_bookings` — Hapus INSERT aktif di routes.ts + supabaseSync.ts
2. `sport_center_facilities` — Hapus SELECT aktif di routes.ts + supabaseSync.ts
3. `shipment_stages` — Hapus Drizzle schema + frontend imports + AI context

### Phase 3 — Fix Kode, lalu Rename HIGH (11 tabel) 🟠
Urutan prioritas (dari yang paling independen):
1. Fleet tables: `fleet_accounting_journals`, `fleet_expenses`, `fleet_wa_logs`, `fleet_outstanding_import_log`, `fleet_pipeline_health`, `fleet_reconciliation_reports`
2. Sport-center: `sc_payments`, `sport_center_memberships`
3. `transaction_datetime_normalized`, `workflow_events`
4. `fleet_ledger_entries` — **TERAKHIR** — butuh migrasi data + drop views/triggers

### Phase 4 — Fix Kode, lalu Rename CRITICAL (2 tabel) 🔴
1. `fleet_vehicles` — Hapus frontend page + schema + inline migration
2. `fleet_partners` — Hapus schema + routes + scheduler + inline migration

### Phase 5 — DROP zz_deleted_* (semua phase)
Setelah 30 hari monitoring: `migrations/archive-phase-2.sql` (belum dibuat — generate saat Phase 1 stabil).

---

## ⚠️ Peringatan Penting

1. **fleet_ledger_entries berisi 17 baris data finansial** — WAJIB backup sebelum apapun
2. **sport_center_bookings berisi 2 baris** dan `sport_center_facilities` berisi 2 baris
3. **employees berisi 15 baris** legacy — export ke CSV sebelum rename
4. **employee_kasbon berisi 1 baris** — backup sebelum rename
5. **Jangan jalankan DROP** sampai monitoring 30 hari selesai
6. **Selalu pg_dump production** sebelum menjalankan migration apapun

---

*Generated: 2026-06-21 | Tool: manual 9-layer trace | Scope: 77 ARCHIVE + DELETE_CANDIDATE tables*
