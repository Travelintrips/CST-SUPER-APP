# CST ENTERPRISE MASTER BLUEPRINT
**Phase:** ENTERPRISE-ARCHITECTURE-01  
**Status:** DRAFT — Reference Document  
**Tanggal:** Agustus 2026  
**Scope:** Seluruh platform CST — Customer Portal, BizPortal, API Server, Accounting, Finance, CRM, Marketplace, Vendor, Procurement, Logistics, Warehouse, Sport Center, Creative AI, Payment, Notification, AI Engine, Analytics, Master Data

---

> **RULES:**
> - Vendor Blueprint berstatus FINAL dan tidak boleh diubah.
> - Dokumen ini adalah **referensi arsitektur**, bukan instruksi implementasi.
> - Tidak ada perubahan kode, migration, endpoint, tabel, page, atau refactor yang dilakukan berdasarkan dokumen ini tanpa proses formal ADR.

---

## DAFTAR ISI

1. [Enterprise Organization Blueprint](#phase-a--enterprise-organization-blueprint)
2. [Enterprise Master Data Blueprint](#phase-b--enterprise-master-data-blueprint)
3. [Enterprise Procurement Blueprint](#phase-c--enterprise-procurement-blueprint)
4. [Enterprise Finance Blueprint](#phase-d--enterprise-finance-blueprint)
5. [Enterprise Inventory Blueprint](#phase-e--enterprise-inventory-blueprint)
6. [Enterprise CRM Blueprint](#phase-f--enterprise-crm-blueprint)
7. [Enterprise Marketplace Blueprint](#phase-g--enterprise-marketplace-blueprint)
8. [Enterprise Document Management Blueprint](#phase-h--enterprise-document-management-blueprint)
9. [Enterprise Approval Blueprint](#phase-i--enterprise-approval-blueprint)
10. [Enterprise Notification Blueprint](#phase-j--enterprise-notification-blueprint)
11. [Enterprise AI Blueprint](#phase-k--enterprise-ai-blueprint)
12. [Enterprise Analytics Blueprint](#phase-l--enterprise-analytics-blueprint)
13. [Enterprise Security Blueprint](#phase-m--enterprise-security-blueprint)
14. [Enterprise Integration Matrix](#phase-n--enterprise-integration-matrix)
15. [Enterprise API Governance](#phase-o--enterprise-api-governance)
16. [Enterprise Disaster Recovery Blueprint](#phase-p--enterprise-disaster-recovery-blueprint)
17. [Enterprise Dependency Matrix](#enterprise-dependency-matrix)
18. [Enterprise Roadmap 5 Tahun](#enterprise-roadmap-5-tahun)
19. [Gap Analysis](#gap-analysis)
20. [Final Enterprise Recommendation](#final-enterprise-recommendation)

---

## PHASE A — Enterprise Organization Blueprint

### Hierarki Organisasi

```
Holding
  └── Company (multi-tenant, dikelola di tabel companies)
        └── Business Unit
              └── Division
                    └── Department
                          └── Branch
                                └── Warehouse
                                      └── Users
                                            └── Roles
                                                  └── Permissions
```

### Ownership Per Level

| Level | Owner | Tabel/Entitas (Existing) | Keterangan |
|---|---|---|---|
| **Holding** | System / Super Admin | `companies` (flag `is_holding`) | Dapat melihat semua company di bawahnya |
| **Company** | Company Admin | `companies`, `accounting_settings` | Satu DB schema, isolasi via `company_id` |
| **Business Unit** | Director | `orgStructure` (type: business_unit) | Agregasi beberapa division |
| **Division** | Division Head | `orgStructure` (type: division) | Pembagian lini bisnis (Logistik, Marketplace, Sport) |
| **Department** | Dept Head | `orgStructure` (type: department) | Satuan fungsional operasional |
| **Branch** | Branch Manager | `orgStructure` (type: branch) | Lokasi fisik atau virtual |
| **Warehouse** | Warehouse Manager | `warehouse` | Inventori fisik per lokasi |
| **Users** | Company Admin | `users`, `portalCustomers`, `drivers` | Multi-role per user |
| **Roles** | Company Admin | `customRoles`, RBAC tables | Role bisa custom per company |
| **Permissions** | System | RBAC permission matrix | Granular per resource/action |

### Prinsip Tenancy

- **Satu Company = Satu Tenant.** Seluruh data diisolasi via `company_id`.
- **`assertTenantAccess` + `assertCompanyAccess`** wajib di setiap route yang menyentuh data company.
- Super Admin dapat melampaui batas company untuk keperluan holding/audit.
- Portal Customer memiliki isolasi terpisah: `portalCustomers`, `portalCustomerProfiles`, `portalCompanyMembers`.

### Role Bawaan (Built-in)

| Role | Scope |
|---|---|
| `super_admin` | Seluruh sistem, lintas company |
| `admin` | Satu company, seluruh modul |
| `ecommerce` | Modul marketplace & sales |
| `trading` | Modul procurement & vendor |
| `logistics` | Modul logistik & driver |
| Portal Customer | Scope customer portal saja |
| Driver | Scope mobile CST Driver saja |

---

## PHASE B — Enterprise Master Data Blueprint

### Struktur Master Data

```
Master Data
  ├── Company / Tenant (induk semua data)
  ├── Customer (portal & internal)
  ├── Vendor / Supplier
  ├── Product & Service
  │     ├── Product Templates
  │     ├── Service Templates
  │     ├── BOM (Bill of Materials)
  │     └── UOM (Unit of Measure)
  ├── Commodity (BTKI / HS Code)
  ├── Warehouse & Stock Location
  ├── Vehicle (Fleet)
  ├── Driver
  ├── Employee
  ├── Branch
  ├── COA (Chart of Accounts)
  ├── Currency
  ├── Tax (NPWP, PPN, PPh, WHT)
  ├── Document Templates
  ├── Media Assets
  └── Notification Templates
```

### Tabel Existing per Domain

| Domain | Tabel Utama | Owner |
|---|---|---|
| Company | `companies`, `accounting_settings` | System / Super Admin |
| Customer | `customers`, `portalCustomers`, `portalCustomerProfiles`, `portalCompanyMembers` | Company Admin |
| Vendor | `suppliers`, `vendorCatalogEngine`, `vendorRates`, `vendorPerformance`, `vendorMiniForm` | Company Admin / Procurement |
| Product | `products`, `productBom`, `productMedia`, `productTemplates`, `uom` | Company Admin |
| Service | `servicePackages`, `serviceTemplates` | Company Admin |
| Commodity | `btki` (HS Code), `freightMasterData` | System / Logistics |
| Warehouse | `warehouse`, `inventory`, `stocks` | Warehouse Manager |
| Vehicle | Fleet-related tables | Logistics Manager |
| Driver | `drivers`, `driverLocations`, `driverJobs` | Logistics Manager |
| COA | COA tables, `coaProposals` | Finance Manager |
| Tax | `taxAudit`, tax classification schemas | Finance / Accounting |
| Media | `mediaAssets`, `storageAuditLog` | System |
| Notification Templates | `waTemplateConfigs` | Admin |

### Prinsip Master Data

1. **Single Source of Truth** — Master data tidak diduplikasi antar modul. Modul lain referensi via FK.
2. **Soft Delete** — Semua master data menggunakan `deleted_at` / `is_active` flag, tidak hard delete.
3. **Audit Trail** — Setiap perubahan master data tercatat di `activityLogs` / `auditReports`.
4. **Company Isolation** — Semua master data scoped ke `company_id`.

---

## PHASE C — Enterprise Procurement Blueprint

### Alur Procurement End-to-End

```
Purchase Request (PR)
  └── RFQ (Request for Quotation)
        └── Vendor Selection
              └── Vendor Quotation
                    └── Purchase Order (PO)
                          └── Goods Receipt (GR)
                                └── Vendor Invoice
                                      └── 3-Way Match (PO × GR × Invoice)
                                            └── Payment Approval
                                                  └── Payment (via Paylabs / Manual)
```

### Integrasi dengan Vendor Blueprint

- **Vendor Blueprint = FINAL.** Procurement menggunakan Vendor Blueprint sebagai referensi resmi untuk:
  - Struktur data vendor (`suppliers`, `vendorCatalogEngine`, `vendorPerformance`)
  - Alur onboarding & verifikasi vendor
  - Rate card & installment vendor (`vendorRates`, `vendorInstallments`)
  - Notifikasi vendor (`vendorNotifications`, `mktVendorQuotes`)

### Tabel Procurement

| Entitas | Tabel |
|---|---|
| Purchase Request | `purchaseDocuments` (type: PR) |
| RFQ | `mktRfqs`, `mktRfqLines`, `mktRfqApprovals`, `mktRfqGuestClaims` |
| Vendor Quote | `mktVendorQuotes`, `mktVendorQuoteLines` |
| Purchase Order | `mktPurchaseOrders`, `mktPurchaseOrderLines` |
| Goods Receipt | `mktPoShipments`, shipment events/items, `warehouse` GR |
| Invoice | `purchaseDocuments` (type: Invoice), `vendorInstallments` |
| Payment | `payments`, `transactions` |

### 3-Way Match Logic

```
Valid Payment = PO.amount == GR.amount == Invoice.amount
             + PO.vendor_id == Invoice.vendor_id
             + GR.status == "received"
             + Invoice.status == "verified"
```

- Jika match gagal → masuk Approval Engine untuk resolusi manual.
- AI dapat memberikan rekomendasi matching (bukan auto-approve).

---

## PHASE D — Enterprise Finance Blueprint

### Alur Finance End-to-End

```
Order / Transaction
  └── Invoice (AR/AP)
        └── Journal Entry
              └── General Ledger
                    ├── Accounts Payable (AP)
                    ├── Accounts Receivable (AR)
                    ├── Cash & Bank
                    │     └── Bank Reconciliation
                    └── Financial Statements
                          ├── Trial Balance
                          ├── Income Statement (P&L)
                          ├── Balance Sheet
                          └── Cash Flow Statement
```

### Prinsip Keuangan (dari AI_ARCHITECTURE_GUARDRAILS)

1. **Immutability** — Journal yang sudah `posted` tidak dapat di-UPDATE atau DELETE. Koreksi hanya via reversal.
2. **Universal Journal Reuse** — Selalu cek existing journal sebelum membuat baru (`journalReuseEngine`).
3. **Draft-First** — Insert entry sebagai `draft` dulu, insert lines, baru promote ke `posted`.
4. **AI = Advisor Only** — AI tidak boleh auto-approve atau auto-post journal.
5. **Double-Entry Enforcement** — Setiap jurnal harus balance (Debit = Kredit).

### Tabel Finance

| Domain | Tabel |
|---|---|
| COA | COA tables, `coaProposals` |
| Journal / Ledger | `accounting` entries, lines, `approvalMatrix` |
| AP | Dari `mktPurchaseOrders` + `purchaseDocuments` |
| AR | Dari `salesDocuments` + `orders` + `transactions` |
| Cash/Bank | `cashBank`, `bankMutationImports` |
| Bank Reconciliation | Reconciliation tables |
| Expenses | `expenses`, `expenseApprovals`, `cashAdvances` |
| Fixed Assets | `fixedAssets` |
| Payroll | `payroll` |
| Tax | `taxAudit`, tax classification |
| Financial Periods | `financialPeriods`, `financialClosing` |
| Loans | `bankLoans` |

### COA Architecture

- COA di-sync dari production ke development via `syncDevCoaToFixture()`.
- Fixture disimpan di `coa-prod-fixture.json`.
- COA ID production ≠ COA ID development — mapping wajib dilakukan saat import data.

---

## PHASE E — Enterprise Inventory Blueprint

### Alur Inventory

```
Warehouse (Master)
  └── Stock Location
        └── Goods Receipt (GR dari PO / GR dari Transfer)
              └── Stock In
                    ├── Goods Issue (ke Order / Production)
                    │     └── Stock Out
                    ├── Transfer antar Warehouse
                    │     └── Stock Transfer Record
                    ├── Stock Adjustment (opname)
                    └── Inventory Costing
                          └── Inventory Valuation (FIFO / Average)
```

### Tabel Inventory

| Entitas | Tabel |
|---|---|
| Warehouse | `warehouse` |
| Stock | `stocks`, `inventory` |
| Goods Receipt | GR dari PO (mktPoShipments) |
| Goods Issue | Dari `orderFulfillment` |
| Transfer | Stock transfer records |
| Adjustment | Stock adjustment entries |
| Costing | Inventory valuation records |

### Prinsip Inventory

- **Negative stock tidak diizinkan** — validasi wajib sebelum issue.
- **Audit trail** — setiap mutasi stok tercatat dengan user, timestamp, referensi dokumen.
- **Multi-warehouse** — satu company dapat memiliki banyak warehouse dengan stok terpisah.

---

## PHASE F — Enterprise CRM Blueprint

### Alur CRM

```
Customer (Master Data)
  └── Lead (Prospek)
        └── Opportunity (Kualifikasi)
              └── Quotation / RFQ
                    └── Order (SO)
                          └── Fulfillment
                                └── Invoice (AR)
                                      └── Payment
                                            └── After-Sales Support
                                                  └── Retention / Upsell
```

### Entitas CRM

| Tahap | Tabel / Modul |
|---|---|
| Customer | `customers`, `portalCustomers`, `portalCustomerProfiles` |
| Lead / Opportunity | Bagian dari `salesDocuments` atau pipeline (kandidat pengembangan) |
| Quotation | `salesDocuments` (type: quotation), `quoteRequests` |
| Order | `orders`, `salesDocuments` (type: SO) |
| Fulfillment | `orderFulfillment`, logistics integration |
| Invoice | `salesDocuments` (type: invoice) |
| Payment | `payments`, `transactions` |
| Support | `correspondences`, `emailCorrespondences` |
| Retention | AI-driven recommendation (kandidat pengembangan) |

### Customer Portal

- Customer mengakses via **Customer Portal** (React/Vite, port 23434).
- Auth: Supabase token (`portalCustomers`).
- Customer dapat: membuat RFQ, melihat order, melihat invoice, tracking pengiriman.

---

## PHASE G — Enterprise Marketplace Blueprint

### Alur Marketplace

```
Customer (Buyer)
  ├── Browse Catalog (Product / Service / Vendor)
  ├── Kirim RFQ
  │     └── Vendor menerima notifikasi
  │           └── Vendor submit Quote
  │                 └── Buyer compare & select
  │                       └── PO diterbitkan
  │                             └── Fulfillment
  │                                   └── Review & Rating
  └── Recommendation (AI-driven)
```

### Komponen Marketplace

| Komponen | Tabel / Modul |
|---|---|
| Catalog | `products`, `vendorCatalogEngine`, `servicePackages` |
| RFQ | `mktRfqs`, `mktRfqLines`, `mktRfqGuestClaims`, `mktRfqApprovals` |
| Vendor Quote | `mktVendorQuotes`, `mktVendorQuoteLines` |
| PO | `mktPurchaseOrders`, `mktPurchaseOrderLines` |
| Shipment | `mktPoShipments`, shipment events |
| GR | Goods receipt items |
| Review & Rating | `vendorPerformance` (kandidat: review table) |
| Recommendation | AI recommendation engine |

### Dua Sisi Marketplace

- **Buyer (Customer Portal):** Browse, RFQ, track PO & shipment.
- **Seller (BizPortal / Vendor Portal):** Kelola quote, konfirmasi PO, input tracking shipment.

---

## PHASE H — Enterprise Document Management Blueprint

### Kategori Dokumen

| Kategori | Contoh | Storage |
|---|---|---|
| Legal | NPWP, NIB, Contract, Certificate | Supabase Storage |
| Transaksi | Invoice, PO, SO, DO, GR | Supabase Storage |
| Logistik | AWB, BL, Packing List, COO | Supabase Storage |
| Media | Photo, Video | Supabase Storage |
| AI-Processed | OCR result, scan dokumen | Supabase Storage + DB |

### Fitur Document Management

| Fitur | Status |
|---|---|
| Upload (semua tipe) | ✅ Ada (`storage` routes, `mediaAssets`) |
| OCR / Scan | ✅ Ada (`scanDocument`, `freightDocVerify`) |
| Versi dokumen | Kandidat pengembangan |
| Approval flow | ✅ Ada (`approvalMatrix`, `approvalRules`) |
| Archive | Via `deleted_at` / status flag |
| Audit trail | ✅ Ada (`storageAuditLog`) |

### Prinsip Storage

- **Gambar/file biner wajib ke Supabase Storage**, tidak boleh disimpan di git atau DB blob.
- Referensi di DB berupa URL Supabase Storage.
- Private vs public bucket: `PRIVATE_OBJECT_DIR` dan `PUBLIC_OBJECT_SEARCH_PATHS` dikonfigurasi via secrets.

---

## PHASE I — Enterprise Approval Blueprint

### Universal Approval State Machine

```
DRAFT
  └── SUBMITTED
        └── PENDING_MANAGER
              └── PENDING_DEPT_HEAD
                    └── PENDING_DIRECTOR
                          ├── APPROVED ──→ (trigger downstream action)
                          ├── REJECTED ──→ (notifikasi & end)
                          └── REVISION  ──→ (kembali ke DRAFT)
```

### Implementasi Approval

- **`approvalMatrix`** — konfigurasi siapa approver per level per document type per company.
- **`approvalRules`** — aturan threshold (misal: PO > Rp 100jt wajib Director).
- **`expenseApprovals`** — approval khusus expense.
- **`mktRfqApprovals`** — approval RFQ di marketplace.
- **`coaProposals`** — approval proposal COA baru.

### Prinsip Universal Approval

1. **Reusable** — satu engine digunakan oleh semua modul (PO, Invoice, Expense, COA, RFQ, dll).
2. **Configurable** — approver & threshold dikonfigurasi per company, bukan hardcode.
3. **AI = Advisor** — AI dapat merekomendasikan approve/reject, tetapi manusia yang memutuskan.
4. **Audit** — semua keputusan approval tercatat dengan timestamp dan alasan.

---

## PHASE J — Enterprise Notification Blueprint

### Channel Notifikasi

| Channel | Provider | Status |
|---|---|---|
| WhatsApp | Fonnte | ✅ Ada |
| Email | SMTP (dikonfigurasi via secrets) | ✅ Ada |
| SMS | — | Kandidat |
| Push Notification | VAPID (Web Push) | ✅ Ada (VAPID keys ada di secrets) |
| In-App | `adminNotifications`, `vendorNotifications` | ✅ Ada |
| Webhook | `webhooks` | ✅ Ada |

### Tabel Notifikasi

| Tabel | Fungsi |
|---|---|
| `notificationLogs` | Log semua notifikasi terkirim |
| `adminNotifications` | Notifikasi untuk admin internal |
| `vendorNotifications` | Notifikasi untuk vendor |
| `waIncomingMessages` | Pesan WA masuk (intake AI) |
| `waOtpCodes` | OTP via WhatsApp |
| `waTemplateConfigs` | Template pesan WA per event |
| `emailCorrespondences` | Log korespondensi email |

### Routing Notifikasi

```
Event (Order, Payment, Approval, dll)
  └── Notification Engine
        ├── Check user preference
        ├── Check channel availability
        └── Dispatch:
              ├── WhatsApp (Fonnte)
              ├── Email (SMTP)
              ├── Push (VAPID)
              └── In-App (DB insert)
```

---

## PHASE K — Enterprise AI Blueprint

### AI Components

| Komponen | Fungsi | Status |
|---|---|---|
| **COA Classification** | Klasifikasi transaksi ke akun COA | ✅ Ada |
| **Tax Classification** | Klasifikasi pajak per transaksi | ✅ Ada |
| **Transaction Intent** | Intent detection dari deskripsi transaksi | ✅ Ada |
| **AI Reviewer** | Review & explainability keputusan AI | ✅ Ada |
| **Decision Memory** | Memori keputusan AI untuk learning | ✅ Ada |
| **Learning Center** | Training & improvement AI berbasis feedback | ✅ Ada |
| **OCR / Scan** | Ekstraksi data dari dokumen fisik | ✅ Ada |
| **Freight Doc Verify** | Verifikasi dokumen logistik | ✅ Ada |
| **WA AI Intake** | Parsing pesan WhatsApp → aksi sistem | ✅ Ada |
| **Enterprise Workflow AI** | Automasi workflow berbasis AI | ✅ Ada |
| **Recommendation** | Rekomendasi vendor, produk | Kandidat pengembangan |
| **Fraud Detection** | Deteksi anomali transaksi | Kandidat pengembangan |
| **Forecasting** | Prediksi demand, cash flow | Kandidat pengembangan |

### AI Governance Rules (dari AI_RULES.md)

1. AI **tidak boleh** auto-approve atau auto-post transaksi keuangan.
2. AI **tidak boleh** mengubah data tanpa konfirmasi manusia.
3. AI **harus** menyertakan confidence score dan reasoning.
4. Semua keputusan AI dicatat di `aiGovernance`, `aiReview`.
5. Human override **selalu tersedia** dan dicatat.

### AI Stack

- **LLM:** OpenAI GPT (via `lib/integrations-openai-ai-server`)
- **Image/Audio:** OpenAI DALL-E, Whisper
- **Adaptive Rule Engine:** Custom (`aiGovernance`, `aiDecisionMemory`)

---

## PHASE L — Enterprise Analytics Blueprint

### Dashboard Hierarchy

| Dashboard | Audience | Cakupan |
|---|---|---|
| **CEO Dashboard** | CEO / Holding | KPI seluruh company, P&L summary, cashflow |
| **Director Dashboard** | Director | Per division/BU performance |
| **Finance Dashboard** | CFO / Finance | Ledger, AP/AR aging, cashflow |
| **Accounting Dashboard** | Accounting | Journal, COA, reconciliation |
| **Procurement Dashboard** | Procurement | PO, vendor performance, 3-way match |
| **Sales Dashboard** | Sales | Revenue, order, customer |
| **Operations Dashboard** | Ops | Fulfillment rate, SLA, driver performance |
| **Warehouse Dashboard** | Warehouse Mgr | Stock level, GR/GI, inventory valuation |
| **Vendor Dashboard** | Vendor | Quote win rate, order, payment status |
| **Customer Dashboard** | Customer | Order history, invoice, shipment tracking |

### Data Sources

```
Transaksi Operasional
  └── API Server (PostgreSQL / Supabase)
        └── Analytics Routes (`analyticsProfit`, reports)
              └── Dashboard (BizPortal / Customer Portal)
```

- Real-time: via API queries.
- Google Sheets sync: `gsheet-nightly-sync` worker (nightly).
- AI-driven insight: kandidat pengembangan (warehouse analytics AI).

---

## PHASE M — Enterprise Security Blueprint

### Lapisan Keamanan

```
Internet
  └── Gateway (port 5000) — rate limiting, routing
        └── API Server (port 18444) — auth middleware
              ├── Session Validation
              ├── RBAC Check (assertTenantAccess)
              ├── ABAC (resource-level policy)
              └── Audit Log
```

### Komponen Security

| Komponen | Implementasi | Status |
|---|---|---|
| **Authentication** | Session cookie (internal) + Supabase token (portal/mobile) | ✅ |
| **Authorization** | RBAC (`customRoles`, permission matrix) | ✅ |
| **ABAC** | `assertTenantAccess`, `assertCompanyAccess` per route | ✅ |
| **OTP / 2FA** | WhatsApp OTP (`waOtpCodes`, `trustedDevices`) | ✅ |
| **Token Security** | `tokenAccessLog`, token hash, token rotation | ✅ |
| **Audit Log** | `activityLogs`, `auditReports`, `storageAuditLog` | ✅ |
| **Session Management** | Server-side sessions, `sessions` table | ✅ |
| **Encryption** | Secrets via GCP Secret Manager, HTTPS enforced | ✅ |
| **API Key** | `PORTAL_ADMIN_KEY`, `CASHIER_TOKEN_SECRET` | ✅ |
| **Rate Limiting** | `express-rate-limit` di API Server | ✅ |
| **Secret Management** | GCP Secret Manager (bukan Replit Secrets langsung) | ✅ |

### Secret Architecture

```
Replit Secrets (hanya 3 bootstrap)
  GCP_PROJECT_ID + GCP_SECRET_ID + GCP_SECRET_MANAGER_BOOTSTRAP_JSON
          ↓
Google Cloud Secret Manager
          ↓
load-secrets.mjs (inject ke process.env)
          ↓
Semua aplikasi (API, BizPortal, Customer Portal)
```

**Rule:** Application secrets (Supabase URL, OpenAI key, dll) **tidak boleh** ditambahkan langsung ke Replit Secrets.

### Dev/Prod Isolation

| Aspek | Development | Production |
|---|---|---|
| Database | Supabase Dev (`*_DEV` keys) | Supabase Prod |
| Startup | `dev.mjs` | `production.mjs` |
| APP_ENV | `development` | `production` |
| Secret strategy | `*_DEV` keys as canonical | Production keys only |

---

## PHASE N — Enterprise Integration Matrix

### Matrix Integrasi

| Sistem | Integrasi | Arah | Status |
|---|---|---|---|
| **Supabase** | Database, Auth, Storage | Bidirectional | ✅ Active |
| **GCP Secret Manager** | Bootstrap secrets | Pull (startup) | ✅ Active |
| **OpenAI** | LLM, OCR, Audio | Outbound | ✅ Active |
| **WhatsApp (Fonnte)** | Notifikasi, OTP, AI intake | Bidirectional | ✅ Active |
| **Paylabs** | Payment gateway | Bidirectional | ✅ Active |
| **Google Sheets** | Nightly data sync | Outbound | ✅ Active |
| **Google OAuth** | SSO login | Bidirectional | ✅ Active (BizPortal) |
| **SMTP (Email)** | Notifikasi email | Outbound | ✅ Active |
| **Web Push (VAPID)** | Browser push notification | Outbound | ✅ Active |
| **GitHub** | Token untuk deployment/CI | — | ✅ Configured |
| **SMS** | Notifikasi SMS | Outbound | ❌ Belum ada |
| **Stripe / Midtrans** | Payment alternatif | — | ❌ Belum ada |
| **ERP Eksternal** | SAP, Oracle | — | ❌ Belum ada |
| **Shipping API** | JNE, J&T, Sicepat | — | ❌ Belum ada |

### Integrasi Internal (Antar Service)

```
Gateway (5000)
  ├── → API Server (18444)    : semua /api/* request
  ├── → BizPortal (18442)     : semua /bizportal/* request
  ├── → Customer Portal (23434): semua /* default request
  └── → Logistic Order (19368): semua /logistic-order/* request
```

---

## PHASE O — Enterprise API Governance

### Versioning Strategy

| Aspek | Standar |
|---|---|
| **Format** | URI versioning: `/api/v1/`, `/api/v2/` |
| **Backward Compatibility** | Minor changes: backward compatible. Breaking: major version bump. |
| **Deprecation** | Minimal 3 bulan notice. Header `Deprecation` + `Sunset`. |
| **Current Version** | v1 (implicit, semua route saat ini adalah v1) |

### Naming Convention

```
Method  Path                              Semantics
GET     /api/{resource}                  List / search
GET     /api/{resource}/{id}             Get single
POST    /api/{resource}                  Create
PUT     /api/{resource}/{id}             Replace (full update)
PATCH   /api/{resource}/{id}             Partial update
DELETE  /api/{resource}/{id}             Soft delete
POST    /api/{resource}/{id}/{action}    Business action (approve, reject, post)
```

### Ownership Matrix

| Route Group | Owner Service | Tim |
|---|---|---|
| `/api/auth/*` | API Server | Platform |
| `/api/accounting/*` | API Server | Finance |
| `/api/vendor/*` | API Server | Procurement |
| `/api/logistic*` | API Server | Logistics |
| `/api/ai*` | API Server | AI |
| `/api/marketplace/*` | API Server | Marketplace |
| `/api/storage/*` | API Server | Platform |

### Public vs Internal API

| Tipe | Akses | Auth |
|---|---|---|
| **Public API** | Customer Portal, Mobile Driver | Supabase token / Portal JWT |
| **Internal API** | BizPortal, Logistic Order | Session cookie + RBAC |
| **Admin API** | Super Admin, Watchdog | `PORTAL_ADMIN_KEY` |

---

## PHASE P — Enterprise Disaster Recovery Blueprint

### Recovery Strategy

| Skenario | Strategi | RTO | RPO |
|---|---|---|---|
| DB corruption | Restore dari backup harian | < 4 jam | < 24 jam |
| Service crash | Auto-restart via workflow | < 1 menit | 0 |
| Secret hilang | Re-provision dari GCP Secret Manager | < 30 menit | 0 |
| Data loss (soft delete) | Restore via `deleted_at` flag | < 1 jam | 0 |
| Merge company | Manual migration script | Custom | Custom |

### Backup Strategy

- **Database:** Backup harian otomatis via `db-backup-scheduler` worker (02:00 WIB).
- **Retensi:** 7 hari terakhir (`keepBackups: 7`).
- **Storage:** Supabase Storage memiliki versioning bawaan.

### Soft Delete Convention

- Semua entitas utama menggunakan `deleted_at IS NULL` sebagai filter aktif.
- Hard delete hanya diizinkan untuk data teknis (log, temp files).
- **Rollback:** Setiap operasi keuangan menggunakan reversal journal, bukan delete.

### Merge / Consolidation

| Operasi | Pendekatan |
|---|---|
| Merge Company | Session replication role + CASE UPDATE untuk remap FK |
| Merge Vendor | Deduplikasi via `supplier_id` mapping |
| Merge Customer | Deduplikasi via `portalCustomers` mapping |
| Archive | Flag `is_archived`, data tetap ada di DB |

---

## Enterprise Dependency Matrix

### Ketergantungan Antar Modul

```
Platform Layer:
  Auth / RBAC ←── SEMUA modul bergantung

Data Layer:
  Master Data (Company, Customer, Vendor, Product, COA)
    ←── Finance, Procurement, Inventory, CRM, Marketplace bergantung

Transaction Layer:
  Procurement → Finance (Journal)
  CRM/Sales   → Finance (Journal)
  Logistics   → Finance (Journal)
  Marketplace → Finance (Journal)

AI Layer:
  COA Classification  ←── Finance (saat create journal)
  Tax Classification  ←── Finance (saat create invoice)
  OCR                 ←── Document Management
  AI Intake (WA)      ←── Notification Engine

Infrastructure Layer:
  GCP Secret Manager  ←── Semua service (saat startup)
  Supabase DB         ←── API Server
  Supabase Storage    ←── Document Management, Media
  OpenAI              ←── AI Engine
  Fonnte              ←── Notification (WA)
  Paylabs             ←── Payment
```

### Critical Path (tidak boleh down)

1. GCP Secret Manager → tanpa ini, semua service gagal start
2. Supabase DB → tanpa ini, API Server tidak bisa beroperasi
3. API Server → tanpa ini, semua frontend tidak bisa berfungsi
4. Gateway → tanpa ini, routing ke semua service terputus

---

## Enterprise Roadmap 5 Tahun

### Tahun 1 (2026) — Stabilisasi & Fondasi
- ✅ Core ERP (Accounting, Finance, Procurement, Inventory)
- ✅ Marketplace B2B (RFQ → PO → GR → Payment)
- ✅ Logistics (Air Freight, Ocean Freight, Trucking, PPJK)
- ✅ Vendor Management
- ✅ AI COA & Tax Classification
- ✅ Customer Portal
- 🔄 Sport Center (dalam pengembangan)
- 🔄 CST Driver Mobile App (dalam pengembangan)
- 📋 Auto-start workflows setelah restart

### Tahun 2 (2027) — Ekspansi & Integrasi
- Lead & Opportunity management (CRM lengkap)
- Shipping API integration (JNE, J&T, Sicepat)
- Advanced AI: Fraud Detection, Demand Forecasting
- Public API v2 (external developer access)
- SMS notification channel
- Advanced Analytics & BI dashboard
- Multi-currency support lengkap

### Tahun 3 (2028) — Scale & Intelligence
- AI-driven recommendation engine (vendor, produk, rute logistik)
- Predictive cash flow management
- ERP integration (SAP connector)
- Holding-level consolidated reporting
- AI-driven procurement optimization
- Real-time inventory tracking (IoT integration)

### Tahun 4 (2029) — Ecosystem
- Marketplace terbuka untuk third-party seller
- Open API platform (developer ecosystem)
- Mobile app CST Driver production-ready
- Advanced warehouse management (WMS)
- Automated 3-way match dengan AI
- Carbon footprint tracking per shipment

### Tahun 5 (2030) — Enterprise Platform
- Fully autonomous procurement (AI-driven, human oversight only)
- Cross-company data analytics (holding level)
- Enterprise AI governance framework
- ISO 27001 compliance
- Multi-country support
- White-label platform

---

## Gap Analysis

### Gap Kritis (Harus diselesaikan segera)

| Gap | Dampak | Prioritas |
|---|---|---|
| Auto-start workflows setelah restart | App mati setelah Replit restart | 🔴 Critical |
| CST Driver mobile app tidak dapat dijalankan | Driver tidak bisa akses app | 🔴 Critical |
| Customer Portal build error (esbuild scan) | Potensi silent build failure | 🟡 High |

### Gap Fungsional (Medium term)

| Gap | Dampak | Prioritas |
|---|---|---|
| CRM: Lead & Opportunity belum ada | Pipeline sales tidak terlacak | 🟡 High |
| Shipping API eksternal (JNE, dll) belum ada | Tracking otomatis tidak tersedia | 🟡 High |
| SMS notification channel belum ada | Fallback WA/email saja | 🟠 Medium |
| Review & Rating vendor belum ada tabel dedicated | Vendor performance manual | 🟠 Medium |
| Document versioning belum ada | Audit dokumen tidak lengkap | 🟠 Medium |

### Gap Arsitektur (Long term)

| Gap | Dampak | Prioritas |
|---|---|---|
| API versioning belum eksplisit (semua implicit v1) | Breaking changes sulit dikelola | 🟠 Medium |
| Forecasting / demand planning belum ada | Inventory over/under stock | 🟠 Medium |
| Fraud detection belum ada | Risiko transaksi anomali | 🟠 Medium |
| ERP eksternal connector belum ada | Integrasi enterprise terbatas | 🟢 Low |

---

## Final Enterprise Recommendation

### 10 Rekomendasi Utama

**1. Stabilisasi Infrastruktur (Segera)**
Aktifkan `autoStart: true` pada semua workflow agar app tidak mati setelah restart.

**2. Selesaikan CST Driver (Q3 2026)**
Mobile app driver adalah komponen kritis untuk operasional logistik. Harus bisa dijalankan dan ditest.

**3. Perkuat AI Governance (Q3 2026)**
Audit semua titik di mana AI memberikan rekomendasi — pastikan tidak ada yang auto-execute tanpa konfirmasi manusia.

**4. Implementasi Explicit API Versioning (Q4 2026)**
Tambahkan `/api/v1/` prefix pada semua route untuk mempersiapkan migrasi ke v2 tanpa breaking change.

**5. Lengkapi CRM Pipeline (Q1 2027)**
Lead → Opportunity → Quotation → Order sudah separuh ada (dari Quotation ke bawah). Tambahkan Lead & Opportunity untuk menutup loop sales.

**6. Integrasikan Shipping API (Q1 2027)**
JNE, J&T, atau Sicepat untuk tracking otomatis pengiriman domestik.

**7. Bangun Consolidated Holding Dashboard (Q2 2027)**
CEO/Holding perlu melihat semua company dalam satu dashboard. Saat ini masih per-company.

**8. Aktifkan Fraud Detection (Q2 2027)**
Dengan volume transaksi yang terus bertambah, anomaly detection berbasis AI perlu diaktifkan.

**9. Siapkan ISO 27001 Readiness (Q3 2027)**
Audit log, access control, dan secret management sudah ada. Gap utama: formal security policy documentation dan penetration testing.

**10. Kembangkan Developer Ecosystem (2028)**
Public API dengan dokumentasi (OpenAPI/Swagger) untuk memungkinkan integrasi pihak ketiga.

---

### Ringkasan Status Platform

| Domain | Kematangan | Catatan |
|---|---|---|
| Core ERP | ⭐⭐⭐⭐⭐ | Production-ready |
| Accounting / Finance | ⭐⭐⭐⭐⭐ | Immutable, audit-ready |
| Procurement / Vendor | ⭐⭐⭐⭐⭐ | Vendor Blueprint FINAL |
| Marketplace B2B | ⭐⭐⭐⭐☆ | Perlu review & rating |
| Logistics | ⭐⭐⭐⭐☆ | Shipping API belum terintegrasi |
| AI Engine | ⭐⭐⭐⭐☆ | Governance kuat, perlu fraud detection |
| CRM | ⭐⭐⭐☆☆ | Lead/Opportunity belum lengkap |
| Mobile (CST Driver) | ⭐⭐☆☆☆ | Perlu selesaikan dan test |
| Analytics | ⭐⭐⭐☆☆ | Perlu consolidated holding view |
| Security | ⭐⭐⭐⭐⭐ | Best practices diterapkan |
| Document Management | ⭐⭐⭐☆☆ | Versioning belum ada |
| Notification | ⭐⭐⭐⭐☆ | SMS belum ada |

---

*Dokumen ini adalah referensi arsitektur resmi CST Enterprise Platform.*  
*Setiap perubahan arsitektur harus didokumentasikan sebagai ADR (Architecture Decision Record) di `ARCHITECTURE_DECISIONS.md`.*  
*Vendor Blueprint berstatus FINAL dan tidak boleh dimodifikasi.*
