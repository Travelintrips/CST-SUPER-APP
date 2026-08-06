# PHASE IMPLEMENTATION-READINESS-01
# BLOCKER RESOLUTION & REUSE VALIDATION REPORT

**Status:** AUDIT SELESAI  
**Tanggal:** Agustus 2026  
**Scope:** Seluruh codebase CST Super App (monorepo)

> **RULES DITERAPKAN:** Tidak ada perubahan kode, migration, endpoint, tabel, atau page dilakukan dalam fase ini.

---

## DAFTAR ISI

1. [Blocker Validation Report](#1-blocker-validation-report)
2. [Reuse Validation Report](#2-reuse-validation-report)
3. [Duplicate Detection Report](#3-duplicate-detection-report)
4. [Existing Asset Matrix](#4-existing-asset-matrix)
5. [Marketplace Schema Validation](#5-marketplace-schema-validation)
6. [API Reuse Matrix](#6-api-reuse-matrix)
7. [Service Reuse Matrix](#7-service-reuse-matrix)
8. [Component Reuse Matrix](#8-component-reuse-matrix)
9. [Sprint Revision](#9-sprint-revision)
10. [Implementation Order](#10-implementation-order)
11. [Risk Update](#11-risk-update)
12. [Final GO / NO GO Decision](#12-final-go--no-go-decision)

---

## 1. Blocker Validation Report

---

### BLK-01 — SQL Injection

**File Utama:** `artifacts/api-server/src/routes/bankLoans.ts`

#### Root Cause
Penggunaan `sql.raw()` dengan string interpolation langsung dari request body/params, alih-alih parameterized queries Drizzle (`sql\`...\`` tagged template dengan binding).

#### Scope & Temuan Lengkap

**`bankLoans.ts` — 11 raw SQL tidak terparameterisasi:**

| Baris | Query | Input Sumber | Risiko |
|---|---|---|---|
| 84–86 | `SELECT * FROM bank_loans WHERE company_id = ${companyId}` | `resolveCompanyId(req)` | 🟡 Medium (numerik) |
| 94 | `SELECT * FROM bank_loans WHERE id = ${id}` | `req.params.id` (parseInt) | 🟡 Medium (parseInt tapi unparameterized) |
| 97–99 | `SELECT * FROM bank_loan_payments WHERE loan_id = ${id}` | `req.params.id` | 🟡 Medium |
| **165–178** | **INSERT bank_loans — semua kolom diinterpolasi** | `req.body`: `lenderName`, `notes`, `loanType`, `paymentMethod`, dll | 🔴 **KRITIS** |
| **263–283** | **INSERT bank_loan_payments + UPDATE** | `req.body`: `reference`, `notes`, `paymentMethod`, `paymentDate` | 🔴 **KRITIS** |
| 199 | `SELECT * FROM bank_loans WHERE id = ${id}` | `req.params.id` | 🟡 Medium |
| 279–283 | `UPDATE bank_loans SET outstanding=... status=...` | Derived from body | 🟠 High |
| 305, 309 | SELECT + DELETE dengan route `id` | `req.params.id` | 🟡 Medium |

**Titik paling berbahaya (165–178):** `lenderName` dan `notes` diinterpolasi dengan hanya `.replace(/'/g, "''")` sebagai pertahanan. Ini **bukan setara parameterization** dan rentan terhadap teknik escape bypass.

**File Tambahan dengan Raw SQL:**

| File | Baris Kritis | Pola | Risiko |
|---|---|---|---|
| `routes/fleetIntelligence.ts` | 3938–3950 | `${where}` clause dibangun dari severity + filter, lalu di-inject ke `sql.raw` | 🔴 High |
| `routes/fleetIntelligence.ts` | 3963 | UPDATE dengan `${id}` dan `${companyId}` raw | 🟡 Medium |
| `routes/fleetIntelligence.ts` | 4124–4129 | `${where}` dengan status filter + LIMIT/OFFSET raw | 🔴 High |
| `routes/fleetIntelligence.ts` | 1179–1192, 1386–1387, 1685, 2501, dll | Banyak raw interpolation numerik | 🟠 Varies |

**Dampak:** `requireAdmin` mengurangi attack surface, tapi tidak menghilangkan risiko. Admin akun yang dikompromikan dapat melakukan SQL injection. Selain itu, ini melanggar prinsip defense-in-depth.

**Mitigasi yang Dibutuhkan:** Ganti semua `sql.raw(...)` dengan Drizzle parameterized `sql\`...\`` atau ORM insert/update API. Prioritaskan lines 165–178 dan 263–283 di bankLoans.ts, lalu fleetIntelligence.ts.

---

### BLK-02 — envGuard

**File Implementasi:** `artifacts/api-server/src/lib/envGuard.ts`

#### Root Cause
`envGuard.ts` menggunakan `REPLIT_DEPLOYMENT` sebagai sinyal production (benar), tapi route-level dan service-level code masih menggunakan `NODE_ENV` secara langsung — inkonsisten dengan envGuard dan melanggar ADR-0001.

#### Pelanggaran Teridentifikasi

**Jalur dev → prod yang bermasalah:**

| File | Baris | Pelanggaran | Dampak |
|---|---|---|---|
| `routes/logisticOrders.ts` | 133 | Rate limit: `NODE_ENV != production` → dev mendapat 1000 req/jam, prod 10 | Jika deployed tanpa `NODE_ENV=production`, prod mendapat limit dev |
| `routes/portalAuthService.ts` | 109, 723 | Dev OTP behavior: `NODE_ENV != production` → bypass OTP di non-prod | Deployment tanpa `NODE_ENV=production` dapat bypass OTP |

**Console.warn teridentifikasi:**

| File | Baris | Pesan |
|---|---|---|
| `src/lib/rbacMiddleware.ts` | 125 | Multiline warning (RBAC fallback) |
| `src/lib/configBootstrap.ts` | 114, 137, 164, 165 | Config bootstrap warnings |
| `src/lib/envGuard.ts` | 91 | Shared PROD DB warning |

**Kesimpulan BLK-02:** envGuard sendiri sudah benar (`REPLIT_DEPLOYMENT`), tapi tidak semua kode mematuhinya. Harus ada standardisasi: ganti semua `NODE_ENV` check di route/service dengan helper dari envGuard, atau tambahkan secondary check `REPLIT_DEPLOYMENT`.

---

### BLK-03 — Marketplace `mkt_activity_logs`

#### Temuan

| Item | Status |
|---|---|
| `mkt_activity_logs` tabel | ❌ **TIDAK ADA** |
| `activity_logs` tabel (generic) | ✅ Ada (`lib/db/src/schema/activityLogs.ts`) |
| `rfq_activity_logs` tabel | ✅ Ada (`lib/db/src/schema/rfqVendorLinks.ts`) — berbeda entitas |
| Marketplace menggunakan tabel apa? | Generic `activity_logs` + marketplace-specific columns di migration `enterprise-marketplace-p0.review.sql:272-287` |

#### Semua Tabel Marketplace yang Ada

| Tabel | File Schema |
|---|---|
| `mkt_rfqs` | `mktRfqs.ts` |
| `mkt_rfq_lines` | `mktRfqLines.ts` |
| `mkt_rfq_approvals` | `mktRfqApprovals.ts` |
| `mkt_rfq_guest_claims` | `mktRfqGuestClaims.ts` |
| `mkt_vendor_quotes` | `mktVendorQuotes.ts` |
| `mkt_vendor_quote_lines` | `mktVendorQuoteLines.ts` |
| `mkt_purchase_orders` | `mktPurchaseOrders.ts` |
| `mkt_purchase_order_lines` | `mktPurchaseOrderLines.ts` |
| `mkt_po_shipments` | `mktPoShipments.ts` |
| `mkt_po_shipment_items` | `mktPoShipmentItems.ts` |
| `mkt_po_shipment_events` | `mktPoShipmentEvents.ts` |
| `mkt_po_goods_receipts` | `mktPoGoodsReceipts.ts` |
| `mkt_po_goods_receipt_items` | `mktPoGoodsReceiptItems.ts` |
| `mkt_company_settings` | `mktCompanySettings.ts` |
| `mkt_notification_queue` | `mktNotificationQueue.ts` |
| `mkt_dual_write_log` | `mktDualWriteLog.ts` |
| `mkt_featured_packages` | `mktFeaturedProduct.ts` |
| `mkt_featured_product_requests` | `mktFeaturedProduct.ts` |

**Kesimpulan BLK-03:** `mkt_activity_logs` tidak ada dan tidak perlu dibuat — marketplace sudah menggunakan `activity_logs` generic dengan kolom marketplace-specific. **Ini bukan blocker teknis**, hanya perlu konfirmasi keputusan desain: apakah `activity_logs` generic sudah cukup, atau perlu dedicated `mkt_activity_logs` untuk performa/isolasi query.

---

### Ringkasan Blocker

| Blocker | Severity | Status | Perlu Fix Sebelum Sprint 1? |
|---|---|---|---|
| BLK-01: SQL Injection (bankLoans, fleetIntelligence) | 🔴 KRITIS | Teridentifikasi, belum diperbaiki | ✅ YA |
| BLK-02: envGuard violations (NODE_ENV inconsistency) | 🔴 HIGH | Teridentifikasi, belum diperbaiki | ✅ YA |
| BLK-03: mkt_activity_logs | 🟡 MINOR | Tidak ada table, tapi tidak blocking (generic activity_logs digunakan) | ⚠️ Konfirmasi desain |

---

## 2. Reuse Validation Report

### Database — Ada & Dapat Digunakan

**Domain coverage lengkap:**
- ✅ Identity & Auth: `auth`, `users`, `companies`, `orgStructure`, `customRoles`, `rbac`, `trustedDevices`, `tokenAccessLog`
- ✅ Marketplace: 18 tabel `mkt_*` (lihat section 5)
- ✅ Finance/Accounting: `accounting`, `coaProposals`, `bankLoans`, `bankMutationImports`, `cashAdvances`, `expenses`, `expenseApprovals`, `fixedAssets`, `payments`, `payroll`, `salesDocuments`, `purchaseDocuments`, `financialPeriods`, `reconciliation`, `treasury`
- ✅ Logistics: `logisticOrders`, `logisticVendorFulfillments`, `driverJobs`, `driverLocations`, `drivers`, `freightShipments`, `airFreight`, `oceanFreight`, `ppjkOrders`
- ✅ Customer/Portal: `portalCustomers`, `portalCustomerProfiles`, `portalCompanyMembers`, `customers`
- ✅ Vendor: `suppliers`, `vendorRates`, `vendorPerformance`, `vendorInstallments`
- ✅ Inventory: `inventory`, `stocks`, `warehouse`, `products`, `productBom`, `uom`
- ✅ AI/Audit: `activityLogs`, `aiGovernance`, `aiReview`, `aiChat`, `auditReports`
- ✅ Notifications: `notificationLogs`, `adminNotifications`, `waTemplateConfigs`, `mktNotificationQueue`

**Tidak ada view DB yang didefinisikan** — semua query adalah inline Drizzle.

### API — Ada & Dapat Digunakan

**~150 route files** di `artifacts/api-server/src/routes/`. Coverage:
- ✅ Semua domain utama sudah punya route
- ✅ Marketplace: `mktAdmin.ts`, `mktPortal.ts`, `mktVendorPo.ts`, `mktQaFixture.ts`
- ✅ Auth: `auth.ts`, `rbac.ts`, `users.ts`
- ✅ Finance: `accounting.ts`, `accountingHub.ts`, `financeCore.ts`, `reconciliation.ts`
- ✅ AI: `aiAgent.ts`, `aiApprovals.ts`, `aiDecisionMemory.ts`, `aiLearningCenter.ts`
- ✅ Logistics: `freight.ts`, `airFreight.ts`, `truckingBookings.ts`, `driver.ts`
- ✅ Notifications: `whatsapp.ts`, `webhooks.ts`, `emailCorrespondences.ts`

### Frontend — Ada & Dapat Digunakan

- ✅ BizPortal: `artifacts/bizportal/src/components/ui/*` (Radix UI primitives)
- ✅ Customer Portal: `artifacts/customer-portal/src/components/ui/*`
- ✅ Shared hooks: `use-mobile.tsx`, `use-toast.ts` (ada di kedua portal)
- ✅ Utils: `lib/utils.ts`, `lib/productTemplates.ts`
- ✅ Layouts: layout components di kedua portal

### Security — Ada & Dapat Digunakan

- ✅ Auth middleware: `src/middlewares/authMiddleware.ts` (global, di-mount di `app.ts:210`)
- ✅ Bearer rate limiter: `src/middlewares/bearerRateLimiter.ts` (global, `app.ts:207`)
- ✅ RBAC: `src/lib/rbacMiddleware.ts`, `src/lib/middleware/requireVendorOwnership.ts`
- ✅ Upload: Storage routes dengan validation
- ✅ envGuard: `src/lib/envGuard.ts`

### Notification — Ada & Dapat Digunakan

- ✅ WhatsApp (canonical): `src/lib/waTransport.ts` — `sendViaService()`, digunakan oleh `whatsapp.ts`, `auth.ts`, `webhooks.ts`, `vendorTracking.ts`
- ✅ WhatsApp templates: `src/services/whatsappTemplateService.ts`
- ✅ Email (canonical): `src/lib/mailer.ts` (Nodemailer SMTP) — satu-satunya sender
- ✅ Push: VAPID keys configured, push routes ada
- ✅ In-App: `adminNotifications`, `vendorNotifications` tables + routes

### AI — Ada & Dapat Digunakan

- ✅ COA Classification: `src/routes/aiTransactionReview.ts`, `src/lib/services/aiDecisionMemory`
- ✅ Tax Classification: `src/routes/aiTransactionReview.ts`
- ✅ OCR: `src/routes/scanDocument.ts`
- ✅ Freight doc verify: `src/routes/freightDocVerify.ts`
- ✅ WA AI Intake: `src/routes/whatsapp.ts` + `waAiIntakeLog`
- ✅ Recommendation: `src/routes/aiAgent.ts`

### Marketplace — Ada & Dapat Digunakan

- ✅ RFQ: `routes/mktPortal.ts` + `routes/mktAdmin.ts`
- ✅ Quote: `routes/mktVendorPo.ts`
- ✅ PO: `routes/mktVendorPo.ts` + `routes/mktPortal.ts`
- ✅ Activity log: via generic `activity_logs` (marketplace columns tersedia)
- ⚠️ `mkt_activity_logs` dedicated: tidak ada (keputusan desain diperlukan)

---

## 3. Duplicate Detection Report

### 🔴 Duplikat Kritis

#### 1. WhatsApp Transport — Dua Implementasi

| File | Fungsi | Digunakan Oleh |
|---|---|---|
| `src/lib/waTransport.ts` ✅ CANONICAL | `sendViaService()`, media send | `whatsapp.ts`, `auth.ts`, `webhooks.ts`, `vendorTracking.ts`, `whatsappTemplateService.ts` |
| `src/lib/fonnte.ts` ❌ DUPLIKAT | `sendWhatsApp()` direct Fonnte call | `productFirstReminderWorker.ts`, `productFirstExceptionWorker.ts`, `rekonsiliasiWorker.ts` |

**Rekomendasi:** `waTransport.ts` adalah canonical. Migrasi 3 file yang masih pakai `fonnte.ts` langsung ke `waTransport.ts`. Retire `fonnte.ts`.

---

### 🟠 Duplikat High

#### 2. Air Freight — Duplicate Track Endpoint

| File | Endpoint | Auth |
|---|---|---|
| `routes/airFreight.ts:79-194` | `GET /track/:orderNumber` | Authenticated |
| `routes/airFreightPublic.ts:243,453` | `GET /public/track/:orderNumber` | Public |

**Rekomendasi:** Pertahankan keduanya (berbeda auth scope), tapi audit apakah ada business logic yang diduplikasi di dalam handler — jika ada, ekstrak ke shared service layer.

#### 3. Vendor Payments — Deprecated Route

| File | Endpoint | Status |
|---|---|---|
| `routes/vendorPayments.ts:84` | `POST /api/vendor-payments` | ⚠️ Deprecated |
| `routes/bankDisbursements.ts:474,533` | Vendor invoice/payment flow | ✅ Canonical |

**Rekomendasi:** `bankDisbursements.ts` adalah canonical. `vendorPayments.ts` harus diretire atau dijadikan read-only compatibility layer.

---

### 🟡 Duplikat Medium

#### 4. Validation Schemas — Inline Duplikasi

| File | Duplikasi | Rekomendasi |
|---|---|---|
| `routes/bankDescriptionNormalizer.ts:33-46` | Single vs batch schema: shape sama | Ekstrak `BankDescriptionInputSchema`, gunakan `.array()` untuk batch |
| `routes/coaProposals.ts:259-264,372-398` | detectedIntent, normalizedDescription, AI fields diulang | Ekstrak shared base schema |
| `routes/aiTransactionReview.ts` | idempotencyKey + transaction fields diulang di banyak schemas | Ekstrak ke `src/lib/schemas/` |

#### 5. Frontend UI Primitives — Duplikat di Dua Portal

| Komponen | BizPortal | Customer Portal |
|---|---|---|
| `components/ui/*` | ✅ Ada | ✅ Ada (identik) |
| `hooks/use-mobile.tsx` | ✅ Ada | ✅ Ada (identik) |
| `hooks/use-toast.ts` | ✅ Ada | ✅ Ada (identik) |
| `lib/utils.ts` | ✅ Ada | ✅ Ada (identik) |
| `lib/productTemplates.ts` | ✅ Ada | ✅ Ada (identik) |

**Rekomendasi jangka panjang:** Ekstrak ke shared package (misal `lib/ui-shared`). Jangka pendek: tidak perlu diubah sebelum Sprint 1.

#### 6. Rate Limiting — Multiple Scope

| File | Scope |
|---|---|
| `middlewares/bearerRateLimiter.ts` | Global (semua request) |
| `middlewares/securityRateLimiter.ts` | Security endpoints |
| `routes/rfqRateLimit.ts` | RFQ khusus |
| `routes/aiAgent.ts` | Per-IP local limiter |

**Rekomendasi:** Bukan duplikat murni — scope berbeda. Tapi `logisticOrders.ts:133` punya inline rate limit definition yang seharusnya menggunakan middleware tercentral.

---

## 4. Existing Asset Matrix

### Summary

| Kategori | Tersedia | Gap |
|---|---|---|
| DB Tables | ~80+ tabel | `mkt_activity_logs` (keputusan desain) |
| DB Views | 0 | — |
| DB Triggers | Beberapa (via migration SQL) | — |
| API Routes | ~150 files | Tidak ada gap signifikan |
| API Services | ~30+ service files | — |
| API Middleware | Auth, RBAC, Rate Limit, Upload | — |
| Frontend Components | Extensive (Radix UI + custom) | — |
| Frontend Hooks | use-mobile, use-toast, custom | — |
| Notification Services | WA (waTransport), Email (mailer), Push (VAPID) | SMS |
| AI Services | COA, Tax, OCR, WA Intake, Recommendation | Fraud detection, Forecasting |
| Security | Auth, RBAC, ABAC, OTP, Audit | — |

---

## 5. Marketplace Schema Validation

### Status: ✅ VALID (dengan 1 catatan)

**Semua 18 tabel marketplace terdefinisi dan ada di schema.** (Lihat daftar lengkap di section 1, BLK-03.)

**Catatan `mkt_activity_logs`:**

| Opsi | Pro | Con |
|---|---|---|
| **A: Gunakan `activity_logs` generic** (kondisi saat ini) | Zero migration, sudah berjalan | Query marketplace activity harus filter by entity_type |
| **B: Buat `mkt_activity_logs` dedicated** | Query lebih efisien, isolasi data marketplace | Perlu migration baru, duplikasi pattern |

**Rekomendasi:** Opsi A — `activity_logs` generic dengan marketplace columns sudah ada dan berfungsi. Tidak perlu `mkt_activity_logs` terpisah sebelum Sprint 1.

---

## 6. API Reuse Matrix

| Domain | Route File(s) | Endpoint Coverage | Reuse Status |
|---|---|---|---|
| Auth | `auth.ts`, `rbac.ts`, `users.ts` | Login, logout, RBAC, user CRUD | ✅ Gunakan langsung |
| Marketplace RFQ | `mktPortal.ts`, `mktAdmin.ts` | RFQ CRUD, approval | ✅ Gunakan langsung |
| Marketplace Quote | `mktVendorPo.ts` | Quote submit, select | ✅ Gunakan langsung |
| Marketplace PO | `mktVendorPo.ts`, `mktPortal.ts` | PO create, confirm, shipment | ✅ Gunakan langsung |
| Marketplace Activity | `activityLogs` via generic routes | Activity via `activity_logs` filter | ✅ Gunakan `activity_logs` |
| Finance | `accounting.ts`, `financeCore.ts`, `reconciliation.ts` | Journal, COA, recon | ✅ Gunakan langsung |
| Vendor | `vendor*.ts`, `bankDisbursements.ts` | Vendor CRUD, payment | ✅ Gunakan `bankDisbursements` |
| Notifications | `whatsapp.ts`, `webhooks.ts` | WA, webhook | ✅ Gunakan langsung |
| AI | `aiAgent.ts`, `aiTransactionReview.ts`, `scanDocument.ts` | LLM, OCR, classification | ✅ Gunakan langsung |
| Storage | `storage.ts` | Upload, download | ✅ Gunakan langsung |

---

## 7. Service Reuse Matrix

| Service | File | Fungsi | Reuse Status |
|---|---|---|---|
| WA Transport | `src/lib/waTransport.ts` | Kirim WA, media | ✅ CANONICAL — gunakan ini |
| WA Templates | `src/services/whatsappTemplateService.ts` | Template WA per event | ✅ Gunakan langsung |
| Email | `src/lib/mailer.ts` | SMTP email sender | ✅ CANONICAL — satu-satunya |
| Auth helper | `src/lib/authUtils.ts` (atau equivalent) | Session, token | ✅ Gunakan langsung |
| RBAC | `src/lib/rbacMiddleware.ts` | Permission check | ✅ Gunakan langsung |
| envGuard | `src/lib/envGuard.ts` | Env validation | ✅ Gunakan ini (bukan NODE_ENV langsung) |
| Fonnte direct | `src/lib/fonnte.ts` | WA sender langsung | ❌ DUPLIKAT — retire, ganti ke waTransport |
| Journal Reuse Engine | `journalReuseEngine` | Cek existing journal | ✅ Wajib digunakan sebelum create journal |

---

## 8. Component Reuse Matrix

### BizPortal

| Komponen | Path | Reuse untuk Sprint 1 |
|---|---|---|
| UI Primitives | `components/ui/*` | ✅ Gunakan semua |
| Layout | `components/layout/*` | ✅ Gunakan langsung |
| Dialog/Modal | `components/ui/dialog.tsx` | ✅ Gunakan langsung |
| Form | `components/ui/form.tsx` | ✅ Gunakan langsung |
| Data Table | `components/ui/data-table.tsx` | ✅ Gunakan langsung |
| Hooks | `hooks/use-toast.ts`, `use-mobile.tsx` | ✅ Gunakan langsung |

### Customer Portal

| Komponen | Path | Reuse untuk Sprint 1 |
|---|---|---|
| UI Primitives | `components/ui/*` | ✅ Gunakan semua |
| PageSeo | `components/PageSeo.tsx` | ✅ Gunakan langsung |
| PageSeoDynamic | `components/PageSeoDynamic.tsx` | ⚠️ Audit — kemungkinan duplikat PageSeo |

**Prinsip:** Jangan buat komponen baru jika ada yang sudah ada. Semua UI wajib menggunakan `components/ui/*` Radix-based yang sudah ada.

---

## 9. Sprint Revision

### Sprint 1 — REVISED (hanya blocker fix + API layer + activity log + testing)

**Yang DILARANG di Sprint 1:**
- ❌ Buat schema baru
- ❌ Buat migration baru
- ❌ Buat tabel baru
- ❌ Buat fitur baru di luar scope blocker
- ❌ Refactor arsitektur

**Yang DIIZINKAN di Sprint 1:**

#### Kategori A — Blocker Fix (wajib selesai sebelum GO)

| Task | Scope | File Target |
|---|---|---|
| A1: Fix SQL Injection bankLoans.ts | Ganti `sql.raw` + manual escape → Drizzle parameterized | `routes/bankLoans.ts` lines 165-178, 263-283, + semua raw lainnya |
| A2: Fix SQL Injection fleetIntelligence.ts | Ganti `${where}` raw injection → parameterized filter | `routes/fleetIntelligence.ts` |
| A3: Fix envGuard violations | Ganti `NODE_ENV` check di logisticOrders + portalAuthService → `REPLIT_DEPLOYMENT` atau envGuard helper | 2 files |
| A4: Retire fonnte.ts direct calls | Migrasi 3 caller ke `waTransport.ts` | `productFirstReminderWorker.ts`, dll |

#### Kategori B — Activity Log (sesuai sprint plan)

| Task | Scope |
|---|---|
| B1: Konfirmasi keputusan `mkt_activity_logs` vs `activity_logs` | Decision only, tidak ada kode |
| B2: Implementasi marketplace activity logging via `activity_logs` | Gunakan tabel existing, tidak perlu tabel baru |

#### Kategori C — Testing

| Task | Scope |
|---|---|
| C1: Unit test untuk SQL injection fix | Pastikan fix tidak break existing behavior |
| C2: Integration test marketplace flow | RFQ → Quote → PO end-to-end |
| C3: envGuard behavior test | Pastikan dev/prod isolation benar |

**Sprint 2 dan seterusnya:** Semua pekerjaan fitur baru, UI baru, dan pengembangan lanjutan dipindahkan ke sprint berikutnya.

---

## 10. Implementation Order

### Hari 1 — Blocker Fix: SQL Injection (High Risk)

**Target:** Selesaikan BLK-01 pada 2 file tertinggi risiko

- Pagi: Audit semua raw SQL di `bankLoans.ts`, buat PR fix dengan Drizzle parameterized queries
- Siang: Audit + fix `fleetIntelligence.ts` high-risk patterns (lines 3938-3950, 4124-4129, 3963)
- Sore: Code review + test manual
- **Dependency:** Tidak ada — bisa dimulai langsung

### Hari 2 — Blocker Fix: envGuard + fonnte Retirement

**Target:** Selesaikan BLK-02 + retire fonnte.ts

- Pagi: Buat `envGuard helper` function yang bisa diimport oleh routes (bukan duplikat, tapi expose util)
- Siang: Ganti `NODE_ENV` check di `logisticOrders.ts:133` + `portalAuthService.ts:109,723`
- Siang: Migrasi `productFirstReminderWorker.ts`, `productFirstExceptionWorker.ts`, `rekonsiliasiWorker.ts` dari `fonnte.ts` → `waTransport.ts`
- **Dependency:** Hari 1 selesai (tidak blocker tapi best practice sequential)

### Hari 3 — Blocker Fix: Remaining SQL + Test

**Target:** Selesaikan semua raw SQL lainnya di fleetIntelligence.ts + write unit tests

- Pagi: Selesaikan sisa raw SQL interpolation di fleetIntelligence.ts
- Siang: Write unit tests untuk semua SQL injection fix
- Sore: Integration smoke test seluruh endpoint yang difix
- **Dependency:** Hari 1-2 selesai

### Hari 4 — Keputusan Desain + Activity Log

**Target:** Konfirmasi BLK-03 decision + implement marketplace activity logging

- Pagi: Architecture review — konfirmasi `activity_logs` generic vs dedicated `mkt_activity_logs`
- Siang: Implementasi marketplace activity logging via `activity_logs` (tidak ada migration)
- Sore: Test activity log endpoint
- **Dependency:** BLK-01, BLK-02 selesai

### Hari 5 — API Layer Audit + Reuse Validation

**Target:** Verifikasi semua API marketplace berjalan dengan benar

- Pagi: Smoke test semua `mktPortal.ts`, `mktAdmin.ts`, `mktVendorPo.ts` endpoints
- Siang: Fix minor issues yang ditemukan
- Sore: Update reuse matrix jika ada temuan baru
- **Dependency:** Hari 1-4 selesai

### Hari 6 — Integration Testing: Marketplace Flow

**Target:** End-to-end test RFQ → Quote → PO → GR

- Full day: RFQ create → vendor quote submit → buyer select → PO generate → shipment → GR
- **Dependency:** Hari 5 selesai

### Hari 7 — Integration Testing: Finance Integration

**Target:** Pastikan marketplace PO/GR terhubung ke Journal

- Pagi: PO approval → journal entry
- Siang: Payment → journal post
- Sore: Reversal flow test
- **Dependency:** Hari 6 selesai

### Hari 8 — Duplicate Cleanup (Non-Breaking)

**Target:** Retire fonnte.ts, deprecated vendorPayments route, fix inline Zod duplicates

- Cleanup `fonnte.ts` (jika hari 2 belum tuntas)
- Mark `vendorPayments.ts` POST endpoint deprecated dengan header
- Ekstrak shared Zod schemas untuk bankDescriptionNormalizer + coaProposals
- **Dependency:** Hari 2-3 selesai

### Hari 9 — Security Audit Review

**Target:** Pastikan semua fix tidak memperkenalkan regression security

- Review semua auth middleware behavior setelah fix
- Review envGuard compliance setelah perubahan hari 2
- Rate limit behavior di dev vs prod
- **Dependency:** Hari 1-8 selesai

### Hari 10 — Final Validation & GO Decision

**Target:** Full system validation, laporan final

- Jalankan full test suite
- Verifikasi semua blocker tertutup
- Dokumen final GO/NO GO
- Siapkan Sprint 2 scope
- **Dependency:** Semua hari sebelumnya

---

## 11. Risk Update

### Risk Matrix

| Risk | Probability | Impact | Mitigasi |
|---|---|---|---|
| SQL Injection dieksploitasi sebelum fix | 🟡 Medium (requireAdmin mengurangi) | 🔴 Critical | Fix Hari 1 dengan prioritas tertinggi |
| Fix SQL injection break existing behavior | 🟠 Medium | 🟠 Medium | Unit test wajib sebelum deploy |
| envGuard fix mempengaruhi OTP flow production | 🟡 Low | 🔴 High | Test staging sebelum prod |
| fonnte.ts retirement break notifikasi reminder | 🟡 Low | 🟠 Medium | Test semua 3 caller setelah migrasi |
| mkt_activity_logs decision delay Sprint | 🟢 Low | 🟡 Low | Decision hari 4, tidak perlu migration |
| Customer Portal esbuild scan error (existing) | 🟠 Medium | 🟡 Low | Track di task #4, tidak blocking Sprint 1 |
| Workflows tidak auto-start setelah restart | 🔴 High (terjadi setiap restart) | 🔴 High | Task #2 sudah di backlog |

### Risk yang SUDAH TURUN dari sebelumnya

| Risk Lama | Status Sekarang |
|---|---|
| GCP secrets tidak ada | ✅ Resolved — semua secrets sudah di-set |
| Dependencies tidak terinstall | ✅ Resolved — pnpm install selesai |
| Gateway tidak bisa routing | ✅ Resolved — gateway berjalan di port 5000 |
| API server tidak start | ✅ Resolved — API running di port 18444 |

---

## 12. Final GO / NO GO Decision

### Evaluasi Per Kriteria

| Kriteria | Status | Catatan |
|---|---|---|
| BLK-01 SQL Injection RESOLVED? | ❌ Teridentifikasi, **belum diperbaiki** | Perlu fix sebelum Sprint 1 |
| BLK-02 envGuard RESOLVED? | ❌ Teridentifikasi, **belum diperbaiki** | Perlu fix sebelum Sprint 1 |
| BLK-03 mkt_activity_logs RESOLVED? | ✅ Keputusan desain: gunakan `activity_logs` generic | Tidak blocking |
| Reuse Validation selesai? | ✅ Lengkap | Semua aset terpetakan |
| Duplicate Detection selesai? | ✅ Lengkap | 6 duplikat teridentifikasi |
| Sprint Revision selesai? | ✅ Lengkap | Sprint 1 sudah direvisi |
| Implementation Order selesai? | ✅ Lengkap | 10 hari terstruktur |

---

## ❌ NO GO

**Sprint 1 BELUM BOLEH dimulai.**

**Alasan:**

1. **BLK-01 (SQL Injection)** — `bankLoans.ts` lines 165-178 dan 263-283 adalah kerentanan kritis. String body langsung diinterpolasi ke SQL dengan hanya manual quote-doubling. Ini harus diperbaiki sebelum ANY fitur baru ditambahkan.

2. **BLK-02 (envGuard)** — `portalAuthService.ts` menggunakan `NODE_ENV != production` untuk menentukan apakah OTP dilewati. Jika deployed environment tidak set `NODE_ENV=production` (yang sudah terjadi di beberapa konfigurasi Replit), production deployment bisa bypass OTP. Ini adalah security vulnerability.

**Syarat GO:**

```
[ ] BLK-01: Semua sql.raw() dengan request input di bankLoans.ts diganti Drizzle parameterized
[ ] BLK-01: High-risk patterns di fleetIntelligence.ts (where clause injection) diperbaiki
[ ] BLK-02: NODE_ENV check di logisticOrders.ts dan portalAuthService.ts diganti REPLIT_DEPLOYMENT/envGuard
[ ] BLK-02: console.warn di production paths dibersihkan atau di-gate dengan envGuard
[ ] Unit test untuk semua fix di atas pass
[ ] Smoke test seluruh endpoint yang terpengaruh
```

**Setelah semua syarat di atas terpenuhi → GO FOR IMPLEMENTATION.**

---

*Dokumen ini bersifat read-only / audit. Tidak ada perubahan kode yang dilakukan dalam fase ini.*  
*Seluruh fix harus melalui review sebelum diimplementasikan.*
