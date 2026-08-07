# CST ENTERPRISE MASTER BLUEPRINT

**Versi:** 1.0  
**Tanggal:** 2026-08-06  
**Status:** DRAFT — Menunggu Review dan Approval  
**Penulis:** Platform Architecture Team  
**Referensi Resmi:**
- Vendor Blueprint: `docs/enterprise-marketplace-blueprint-v1.2.md` (**FINAL — JANGAN DIUBAH**)
- Architecture Decisions: `ARCHITECTURE_DECISIONS.md` (ADR-0001 s/d ADR-0004)
- Guardrails: `AI_ARCHITECTURE_GUARDRAILS.md`

> **ATURAN UTAMA**
> Blueprint ini adalah dokumen perencanaan. Tidak ada kode, migration, endpoint, tabel, halaman,
> atau refactor yang boleh dibuat berdasarkan dokumen ini tanpa proses approval eksplisit.
> Vendor Blueprint (`enterprise-marketplace-blueprint-v1.2.md`) adalah FINAL dan tidak boleh diubah.

---

## Daftar Isi

1. [Enterprise Organization Blueprint](#1-enterprise-organization-blueprint)
2. [Enterprise Master Data Blueprint](#2-enterprise-master-data-blueprint)
3. [Enterprise Procurement Blueprint](#3-enterprise-procurement-blueprint)
4. [Enterprise Finance Blueprint](#4-enterprise-finance-blueprint)
5. [Enterprise Inventory Blueprint](#5-enterprise-inventory-blueprint)
6. [Enterprise CRM Blueprint](#6-enterprise-crm-blueprint)
7. [Enterprise Marketplace Blueprint](#7-enterprise-marketplace-blueprint)
8. [Enterprise Document Management Blueprint](#8-enterprise-document-management-blueprint)
9. [Enterprise Approval Blueprint](#9-enterprise-approval-blueprint)
10. [Enterprise Notification Blueprint](#10-enterprise-notification-blueprint)
11. [Enterprise AI Blueprint](#11-enterprise-ai-blueprint)
12. [Enterprise Analytics Blueprint](#12-enterprise-analytics-blueprint)
13. [Enterprise Security Blueprint](#13-enterprise-security-blueprint)
14. [Enterprise Integration Matrix](#14-enterprise-integration-matrix)
15. [Enterprise API Governance](#15-enterprise-api-governance)
16. [Enterprise Disaster Recovery Blueprint](#16-enterprise-disaster-recovery-blueprint)
17. [Enterprise Dependency Matrix](#17-enterprise-dependency-matrix)
18. [Enterprise Roadmap 5 Tahun](#18-enterprise-roadmap-5-tahun)
19. [Gap Analysis](#19-gap-analysis)
20. [Final Enterprise Recommendation](#20-final-enterprise-recommendation)

---

## 1. Enterprise Organization Blueprint

### 1.1 Hierarki Organisasi

```
Holding Company
    │  (is_holding = true, parent_company_id = NULL)
    │
    ├─── Company A (Divisi Logistik)
    │        │  parent_company_id = Holding.id
    │        │
    │        ├─── Business Unit: Freight Forwarding
    │        │        │
    │        │        ├─── Division: Export-Import
    │        │        │        │
    │        │        │        ├─── Department: Operations
    │        │        │        │        │
    │        │        │        │        └─── Branch / Warehouse
    │        │        │        │
    │        │        │        └─── Department: Finance
    │        │        │
    │        │        └─── Division: Domestic Logistics
    │        │
    │        └─── Business Unit: Sport Center
    │
    ├─── Company B (Divisi Trading / B2B Marketplace)
    │
    └─── Company C (Divisi Kreatif / Creative AI)
```

### 1.2 Ownership Setiap Level

| Level | Tabel Existing | Owner | Scope Data |
|---|---|---|---|
| **Holding** | `companies` (`is_holding=true`) | Platform Admin | Seluruh sistem |
| **Company** | `companies` (`parent_company_id`) | Company Admin | Data company sendiri + children |
| **Business Unit** | *(belum ada — lihat Gap Analysis)* | BU Head | Data BU sendiri |
| **Division** | `divisions` | Division Head | Data division sendiri |
| **Department** | `departments` | Dept Head | Data department sendiri |
| **Branch** | `branches` | Branch Manager | Data branch sendiri |
| **Warehouse** | `warehouses` | Warehouse Manager | Stock & movement di warehouse |
| **Users** | `users` | Self / Company Admin | Data sesuai role |
| **Roles** | `custom_roles` | Company Admin | Mapping ke permissions |
| **Permissions** | `rbac_role_permissions` | Platform Admin | Module + action level |

### 1.3 Org Structure yang Sudah Ada

```
companies
    └─ branches        (company_id FK)
           └─ divisions     (branch_id FK)
                  └─ departments   (division_id FK)
                         └─ sections     (department_id FK)
                                └─ users (section/dept/div/branch/company FK)
```

### 1.4 Multi-Company Access

- Tabel `user_allowed_companies` → user bisa akses lebih dari satu company
- Semua query wajib di-filter oleh `company_id` (multi-tenant isolation)
- Admin platform bisa akses lintas company melalui `is_holding` flag

### 1.5 Role & Permission Architecture

```
User ──► custom_role (company-scoped)
              │
              └──► rbac_role_permissions
                        ├── module: "procurement"
                        ├── action: "approve"
                        └── allowed: true

Built-in roles (enum): admin | ecommerce | trading | logistics
Custom roles: bebas dibuat per company
```

---

## 2. Enterprise Master Data Blueprint

### 2.1 Peta Master Data & Ownership

| Entitas | Tabel Utama | Owner | Scope |
|---|---|---|---|
| **Company** | `companies` | Holding/Platform Admin | Global |
| **Customer** | `customers` | Company | Per company |
| **Vendor/Supplier** | `suppliers` | Company | Per company |
| **Product** | `products` | Company | Per company |
| **Service** | `vendor_catalog_items` (type=service) | Vendor/Company | Per vendor |
| **Commodity** | `products` + `commodity_type` field | Company | Per company |
| **Warehouse** | `warehouses` | Company | Per company |
| **Vehicle** | `fleet_vehicles` | Company | Per company |
| **Driver** | `drivers` | Company | Per company |
| **Employee** | `users` + `employees` | Company | Per company |
| **Branch** | `branches` | Company | Per company |
| **COA** | `chart_of_accounts` | Company | Per company (+ global template) |
| **Currency** | `currencies` | Platform Admin | Global |
| **Tax** | `accounting_taxes` | Company | Per company |
| **Document** | `company_legal_documents` | Company | Per company |
| **Media** | Supabase Storage | Company | Per company bucket |
| **Notification** | `notifications` / `notification_templates` | System | Per user/company |

### 2.2 Master Data Governance

**Prinsip:**
1. Setiap master data memiliki satu source of truth (satu tabel master, tidak diduplikasi)
2. Referensi lintas domain selalu melalui FK, bukan copy data
3. Soft delete (`deleted_at`, `is_active`) wajib — tidak ada hard delete pada master data
4. Perubahan master data yang berdampak ke akuntansi (COA, Tax) harus melalui approval workflow (maker-checker)
5. Lifecycle minimum: `draft → active → inactive → archived`

### 2.3 Chart of Accounts (COA) — Governance Khusus

COA adalah master data yang paling kritis karena terhubung ke seluruh transaksi keuangan.

```
Proses perubahan COA:
  Maker buat DRAFT change request
       │
       └─► PENDING_APPROVAL
                 │
                 └─► Checker (bukan Maker) → APPROVED / REJECTED
                              │
                              └─► APPROVED: update master COA + append coa_versions snapshot
```

- Lihat detail: `COA_MASTER_GOVERNANCE.md`
- Prinsip immutable history: `coa_versions` append-only
- Posting validation: account harus ACTIVE, POSTABLE, non-header, efektif pada tanggal posting

---

## 3. Enterprise Procurement Blueprint

> **Referensi:** `docs/enterprise-marketplace-blueprint-v1.2.md` (FINAL — Vendor Blueprint)

### 3.1 Alur Procurement End-to-End

```
Purchase Request (PR)
    │
    ├─► PR Lines
    │
    └─► PR Approval (Approval Engine)
              │
              └─► RFQ / Vendor Quotation
                        │
                        ├─► Vendor Quote Lines
                        │
                        └─► Quotation Comparison
                                  │
                                  └─► Purchase Order (PO)
                                            │
                                            ├─► PO Lines
                                            │
                                            └─► Goods Receipt (GR)
                                                      │
                                                      ├─► GR Lines
                                                      ├─► QC Check
                                                      │
                                                      └─► 3-Way Match (PR ↔ PO ↔ GR)
                                                                │
                                                                └─► Vendor Invoice
                                                                          │
                                                                          ├─► Invoice Lines
                                                                          │
                                                                          └─► Payment Request
                                                                                    │
                                                                                    └─► AP Settlement
```

### 3.2 Tabel Procurement yang Sudah Ada

| Tabel | Deskripsi |
|---|---|
| `purchase_requests` | Header PR |
| `purchase_request_lines` | Line items PR |
| `purchase_request_approvals` | Approval history PR |
| `vendor_quotations` | Header quotasi dari vendor |
| `vendor_quotation_lines` | Line items quotasi |
| `purchase_documents` | PO (kind=`purchase_order`) + SO (kind=`sales_order`) dll |
| `goods_receipts` | Header GR |
| `goods_receipt_lines` | Line items GR |
| `vendor_invoices` | Invoice dari vendor |
| `vendor_invoice_lines` | Line items invoice |
| `payment_requests` | Request pembayaran AP |
| `payment_request_items` | Item dalam payment request |
| `landed_costs` | Biaya pengiriman/landed cost |

### 3.3 3-Way Match Logic

```
MATCH VALID bila:
  GR.quantity      ≈ PO.quantity      (toleransi ±2%)
  Invoice.amount   ≈ PO.unit_price × GR.quantity
  GR.vendor_id     = PO.vendor_id     = Invoice.vendor_id

Bila TIDAK MATCH:
  → Exception queue untuk Finance review
  → Tidak boleh auto-approve
```

### 3.4 Integrasi ke Accounting

| Event | Journal Entry | Debit | Kredit |
|---|---|---|---|
| GR diterima | Inventory Receipt | Persediaan (1-xxxx) | GR Clearing (2-xxxx) |
| Invoice vendor tiba | AP Recognition | GR Clearing (2-xxxx) | Hutang Dagang / AP (2-xxxx) |
| Payment AP | AP Settlement | Hutang Dagang / AP | Kas/Bank |

---

## 4. Enterprise Finance Blueprint

### 4.1 Alur Transaksi ke Laporan Keuangan

```
Seluruh Transaksi (Order, Invoice, Payment, GR, dll.)
    │
    └─► accounting_entries (IMMUTABLE — ADR-0002)
              │
              ├─► accounting_entry_lines (Debit / Kredit)
              │
              └─► accounting_journals
                        │
                        ├─► Accounts Payable (AP) Ledger
                        ├─► Accounts Receivable (AR) Ledger
                        ├─► Cash & Bank Ledger
                        │
                        └─► Trial Balance
                                  │
                                  ├─► Income Statement (Laba Rugi)
                                  ├─► Balance Sheet (Neraca)
                                  └─► Cash Flow Statement
```

### 4.2 Aturan Immutabilitas (ADR-0002)

```
DIIZINKAN:
  ✅ INSERT entry baru (status=draft)
  ✅ Promosi draft → posted
  ✅ Reversal: buat entry BARU dengan amount negatif, link ke original
  ✅ Void: set is_voided=true, buat reversal entry (asli TETAP ADA)

DILARANG:
  ❌ UPDATE accounting_entries (kecuali status transisi yang diizinkan)
  ❌ DELETE accounting_entries
  ❌ UPDATE/DELETE accounting_entry_lines yang sudah posted
```

### 4.3 Universal Journal Reuse (ADR-0003)

Sebelum membuat journal baru, WAJIB cek:
```
SELECT id FROM accounting_entries
WHERE source = '{domain}' AND source_id = {transaction_id}
LIMIT 1;
```
Jika ditemukan → REUSE, jangan buat baru.

### 4.4 Bank Reconciliation

```
Bank Statement (mutasi)
    │
    ├─► Auto-match engine
    │       ├─► Match by amount + date + reference
    │       └─► Match by pattern (AI-assisted)
    │
    ├─► MATCHED → post journal
    └─► UNMATCHED → manual review queue → COA Proposal → approval
```

### 4.5 Financial Modules yang Sudah Ada

| Modul | Status | Tabel Utama |
|---|---|---|
| Chart of Accounts | ✅ Production | `chart_of_accounts`, `coa_versions` |
| Journal Entry | ✅ Production | `accounting_entries`, `accounting_entry_lines` |
| AP/AR | ✅ Production | `accounting_payments`, `payment_requests` |
| Bank Reconciliation | ✅ Production | `bank_mutations`, `bank_reconciliation_candidates` |
| Tax | ✅ Production | `accounting_taxes`, `accounting_tax_lines` |
| Financial Statement | 🔶 Partial | Computed from ledger |
| Multi-currency | 🔶 Planned | `currencies` tabel ada, belum full implementation |
| Intercompany | 🔶 Planned | COA 2-1060 reserved |

---

## 5. Enterprise Inventory Blueprint

### 5.1 Hierarki Lokasi Stok

```
Company
    └─► Warehouse (type: CENTRAL | BRANCH | OUTLET)
              └─► Rack / Bin (warehouse_racks)
                        └─► inventory_stock (product + warehouse + rack)
```

### 5.2 Alur Pergerakan Stok

```
Goods Receipt (dari Procurement)
    │
    └─► stock_movements (type=purchase)
              │
              ├─► inventory_stock.on_hand += qty
              └─► inventory_stock.available = on_hand - reserved

Sales Order Confirmed
    │
    └─► stock_movements (type=sales_reserve)
              │
              └─► inventory_stock.reserved += qty

Delivery / Goods Issue
    │
    └─► stock_movements (type=sales)
              │
              └─► inventory_stock.on_hand -= qty
                  inventory_stock.reserved -= qty

Transfer (antar Warehouse)
    │
    ├─► stock_movements (type=transfer_out) → Source warehouse
    └─► stock_movements (type=transfer_in) → Destination warehouse

Stock Opname
    │
    └─► stock_movements (type=adjustment)
              │
              └─► Variance → Journal Entry (Cost of Goods Sold / Inventory Write-off)
```

### 5.3 Costing & Valuation

| Metode | Deskripsi | Status |
|---|---|---|
| **Weighted Average** | Rata-rata bergerak | ✅ Primary |
| **FIFO** | First In First Out | 🔶 Planned |
| **Standard Cost** | Harga standar tetap | 🔶 Planned |

**Inventory Valuation Journal:**
```
Debit:  Persediaan (1-xxxx)
Kredit: Hutang Dagang / AP (2-xxxx)
```

**Write-off / Kerusakan:**
```
Debit:  Beban Kerugian Stok (6-xxxx)
Kredit: Persediaan (1-xxxx)
```

### 5.4 Tabel Inventory yang Sudah Ada

| Tabel | Deskripsi |
|---|---|
| `warehouses` | Master gudang |
| `warehouse_racks` | Rak/bin dalam gudang |
| `inventory_stock` | Saldo stok per product+warehouse+rack |
| `stock_movements` | History semua pergerakan stok |
| `wh_stock` | Operational stock (WH module) |
| `wh_movements` | Operational movements |
| `wh_transfers` / `wh_transfer_lines` | Transfer antar gudang |
| `wh_damage_reports` / `wh_damage_lines` | Laporan kerusakan |
| `wh_returns` / `wh_return_lines` | Retur barang |
| `wh_stock_opname` / `wh_opname_lines` | Stock opname |

---

## 6. Enterprise CRM Blueprint

### 6.1 Alur CRM End-to-End

```
Lead (calon customer)
    │
    └─► Qualification
              │
              └─► Opportunity
                        │
                        └─► Quotation (SO draft)
                                  │
                                  ├─► Accepted → Sales Order
                                  │         │
                                  │         └─► Invoice (AR)
                                  │                   │
                                  │                   └─► Payment → Bank Recon
                                  │
                                  └─► Rejected → Feedback / Nurturing
                                              │
                                              └─► Support / After-Sales
                                                        │
                                                        └─► Retention / Upsell
```

### 6.2 Customer Profile (360°)

```
customers
    ├─► Profil (nama, alamat, NPWP, NIB, kontak)
    ├─► sales_documents (semua transaksi)
    ├─► portal_product_orders (order dari Customer Portal)
    ├─► mkt_rfqs (marketplace RFQ)
    ├─► portal_content (konten portal per customer)
    ├─► payment history
    └─► support tickets (planned)
```

### 6.3 Segmentasi Customer

| Segmen | Kriteria | Channel |
|---|---|---|
| **B2B Enterprise** | company_id terdaftar | BizPortal |
| **B2B SME** | Daftar via Customer Portal | Customer Portal |
| **Guest** | Belum register, akses via token | Customer Portal |
| **Internal** | `is_internal_vendor` | BizPortal only |

### 6.4 Modul CRM yang Perlu Dikembangkan

| Fitur | Status | Prioritas |
|---|---|---|
| Lead Management | ❌ Belum ada | P1 |
| Opportunity Pipeline | ❌ Belum ada | P1 |
| Activity Timeline | 🔶 Partial (mkt_activity_logs) | P2 |
| Support Tickets | ❌ Belum ada | P2 |
| Customer Segmentation | 🔶 Partial | P2 |
| Loyalty / Retention | ❌ Belum ada | P3 |
| NPS / Feedback | ❌ Belum ada | P3 |

---

## 7. Enterprise Marketplace Blueprint

> **REFERENSI RESMI & FINAL:** `docs/enterprise-marketplace-blueprint-v1.2.md`
> Blueprint di bagian ini adalah ringkasan posisi marketplace dalam enterprise context.
> Untuk detail schema, API, security, accounting — SELALU rujuk dokumen di atas.

### 7.1 Posisi Marketplace dalam Enterprise

```
Customer Portal ──► Marketplace (B2B RFQ)
                          │
                          ├─► Vendor Catalog (vendor_catalog_items)
                          ├─► RFQ Engine (mkt_rfqs)
                          ├─► Multi-vendor Quote (mkt_vendor_quotes)
                          ├─► Purchase Order (mkt_purchase_orders)
                          │
                          └─► ERP Integration
                                    ├─► Procurement (purchase_documents)
                                    ├─► Accounting (accounting_entries)
                                    └─► Inventory (stock_movements)
```

### 7.2 Entitas Utama Marketplace (dari Vendor Blueprint v1.2)

| Entitas | Tabel | Status |
|---|---|---|
| RFQ Header | `mkt_rfqs` | ✅ P0 — FINAL |
| RFQ Lines | `mkt_rfq_lines` | ✅ P0 — FINAL |
| Vendor Quote Header | `mkt_vendor_quotes` | ✅ P0 — FINAL |
| Vendor Quote Lines | `mkt_vendor_quote_lines` | ✅ P0 — FINAL |
| Purchase Order | `mkt_purchase_orders` | ✅ P0 — FINAL |
| Guest RFQ Claims | `mkt_rfq_guest_claims` | ✅ P0 — FINAL |
| Activity Log | `mkt_activity_logs` | ✅ P0 — FINAL |

### 7.3 Koneksi ke Modul Lain

| Marketplace Event | Modul Terdampak | Mekanisme |
|---|---|---|
| PO confirmed | Procurement | `purchase_documents.mkt_purchase_order_id` |
| PO completed | Accounting | `accounting_entries` (source=`marketplace_commission`) |
| PO fulfilled | Inventory | `stock_movements` |
| Vendor invited | Notification | WhatsApp / Email via token |
| Buyer registered | CRM | `customers` record |

### 7.4 Aturan Commission (dari Vendor Blueprint v1.2)

- Rate tidak boleh di-hardcode; selalu dari `system_settings` (`marketplace.default_commission_rate`)
- Tax commission: FK ke `accounting_taxes` (`commission_tax_id`)
- Journal posting: MANUAL melalui admin endpoint, hanya setelah PO `completed`
- Source ID convention: `source='marketplace_commission'`, `source_id=mkt_purchase_orders.id`

---

## 8. Enterprise Document Management Blueprint

### 8.1 Kategori Dokumen Enterprise

| Kategori | Contoh | Storage | Lifecycle |
|---|---|---|---|
| **Legal Entity** | NPWP, NIB, SIUP, TDP | Supabase Storage | active → expired → archived |
| **Transaksi** | Invoice, PO, SO, DO, GR | Supabase Storage | draft → issued → paid → archived |
| **Kontrak** | Kontrak vendor, customer, karyawan | Supabase Storage | draft → signed → expired → terminated |
| **Media** | Foto produk, video promosi | Supabase Storage | draft → published → archived |
| **Compliance** | Sertifikat halal, ISO, SNI | Supabase Storage | active → expired |
| **Internal** | SOP, kebijakan, memo | Supabase Storage | draft → approved → archived |

### 8.2 Document Architecture

```
Document Record (metadata, di DB)
    ├─► document_type (enum)
    ├─► entity_type + entity_id (polymorphic FK)
    ├─► storage_path (Supabase Storage URL)
    ├─► version (integer, increment on update)
    ├─► status (draft | active | expired | archived)
    ├─► expires_at (nullable)
    ├─► approval_status (jika butuh approval)
    └─► Document Versions (append-only history)
```

### 8.3 OCR Pipeline (AI-Assisted)

```
Upload Dokumen
    │
    └─► OCR Engine (AI)
              │
              ├─► Ekstrak: tanggal, nominal, vendor, nomor dokumen
              ├─► Validasi field wajib
              └─► Pre-fill form (user konfirmasi sebelum save)
```

### 8.4 Document Access Control

| Role | Akses |
|---|---|
| Platform Admin | Semua dokumen semua company |
| Company Admin | Semua dokumen company sendiri |
| Finance Staff | Dokumen keuangan company sendiri |
| Vendor (external) | Dokumen milik vendor sendiri |
| Customer (portal) | Dokumen transaksi sendiri (invoice, DO) |

### 8.5 Tabel yang Sudah Ada

| Tabel | Deskripsi |
|---|---|
| `company_legal_documents` | Dokumen legalitas company |
| `supplier_documents` | Dokumen vendor/supplier |
| `vendor_catalog_items.attachment_url` | Attachment katalog |
| `mkt_vendor_quotes.attachment_url` | Attachment quote |
| `purchase_documents` | SO/PO/Invoice dokumen |
| Supabase Storage | Binary file storage (CDN-backed) |

### 8.6 Gap: Document Management Terpusat

Saat ini dokumen tersebar di berbagai tabel. Dibutuhkan:
- Tabel `documents` terpusat (polymorphic, semua entity)
- Version history terpusat
- Approval workflow untuk dokumen legal/kontrak
- Expiry notification (via Notification Engine)

---

## 9. Enterprise Approval Blueprint

### 9.1 Universal Approval State Machine

```
                    ┌─────────┐
                    │  DRAFT  │ ◄──────────────────────────────┐
                    └────┬────┘                                 │
                         │ submit                               │ revisi diminta
                    ┌────▼────────┐                             │
                    │  SUBMITTED  │                             │
                    └────┬────────┘                      ┌─────┴──────┐
                         │ auto-route ke approver         │  REVISION  │
                    ┌────▼───────────┐                   └────────────┘
                    │ PENDING_L1     │ Manager                   ▲
                    └────┬─────┬─────┘                          │
               approve   │     │ reject/revisi                  │
                    ┌────▼──────────────┐                       │
                    │ PENDING_L2        │ Department Head        │
                    └────┬────┬─────────┘                       │
               approve   │    │ reject/revisi ──────────────────┘
                    ┌────▼──────────────┐
                    │ PENDING_L3        │ Director (if required)
                    └────┬────┬─────────┘
               approve   │    │ reject
            ┌────────────▼┐  ┌▼───────────┐
            │  APPROVED   │  │  REJECTED  │
            └──────┬──────┘  └────────────┘
                   │
            ┌──────▼──────┐
            │  COMPLETED  │ (setelah aksi post-approval selesai)
            └─────────────┘
```

### 9.2 Approval Engine — Prinsip Desain

1. **Universal / Reusable** — satu engine untuk semua domain (PR, COA, Invoice, Marketplace PO, dll.)
2. **Polymorphic** — `entity_type` + `entity_id` (bukan FK hardcode per domain)
3. **Configurable Levels** — jumlah level approval dikonfigurasi per document type per company
4. **Delegation** — approver bisa delegasi ke orang lain dengan audit trail
5. **Timeout** — jika approver tidak merespons dalam N hari → eskalasi otomatis
6. **Audit Trail** — setiap aksi tersimpan dengan timestamp, actor, komentar

### 9.3 Approval Routing Rules

```
Routing berdasarkan:
  - document_type (PR, Invoice, PO, COA Change, dll.)
  - amount threshold (PR < 10jt: 1 level; > 10jt: 2 level; > 100jt: 3 level)
  - department / division
  - company_id

Konfigurasi di: approval_workflow_configs (planned)
```

### 9.4 Implementasi Existing per Domain

| Domain | Approval Mekanisme | Status |
|---|---|---|
| COA Change | `coa_change_requests` | ✅ Production (maker-checker) |
| Purchase Request | `purchase_request_approvals` | ✅ Production |
| Marketplace PO | Via admin endpoint manual | 🔶 Partial |
| Vendor Invoice | `vendor_invoices.approval_status` | 🔶 Partial |
| Bank Recon Mutation | Manual approve per kandidat | ✅ Production |
| General (universal) | ❌ Belum ada universal engine | Gap |

---

## 10. Enterprise Notification Blueprint

### 10.1 Channel Notification

| Channel | Provider | Penggunaan | Status |
|---|---|---|---|
| **WhatsApp** | Fonnte API | OTP, transaksi penting, reminder | ✅ Production |
| **Email** | SMTP (configured) | Invoice, approval, welcome | ✅ Production |
| **SMS** | *(planned)* | OTP fallback | ❌ Planned |
| **Push** | Web Push (VAPID) | Real-time notif di browser | ✅ Production |
| **In-App** | SSE / Polling | Notif dalam aplikasi | 🔶 Partial |
| **Webhook** | HTTP callback | Integrasi third-party | 🔶 Planned |

### 10.2 Universal Notification Architecture

```
Event Source (domain apapun)
    │
    └─► Notification Dispatcher
              │
              ├─► Template Engine
              │       ├─► WhatsApp template
              │       ├─► Email template (HTML)
              │       └─► Push payload
              │
              ├─► Channel Router
              │       ├─► User preferences (mana channel aktif)
              │       └─► Fallback rules (WA gagal → Email)
              │
              ├─► Retry Queue (gagal → retry 3x dengan backoff)
              │
              └─► Delivery Log (audit trail pengiriman)
```

### 10.3 Notification Events per Domain

| Domain | Event | Channel |
|---|---|---|
| **Procurement** | PR submitted, PO approved, GR diterima | Email + WA |
| **Finance** | Invoice jatuh tempo, payment diterima | Email + WA |
| **Marketplace** | Vendor diundang, RFQ dikonfirmasi | Email + WA + Push |
| **Inventory** | Stok minimum, GR diterima | Email + Push |
| **Auth** | OTP login, new device | WA + Email |
| **Recurring** | Tagihan recurring reminder | Email + WA |
| **Approval** | Request approval, approved/rejected | Push + Email |

### 10.4 Workers yang Sudah Ada

| Worker | Interval | Fungsi |
|---|---|---|
| `wa-retry-worker` | 5 menit | Retry WA yang gagal |
| `fulfillment-expiry-notifier` | 1 jam | Notif fulfillment hampir expired |
| `vendor-invitation-approval-reminder` | 1 jam | Reminder undangan vendor |
| `member-reminder-worker` | 1 jam | Reminder member |
| `expense-reminder-worker` | Scheduled | Reminder expense |
| `wht-reminder-worker` | Scheduled | Reminder PPh |
| `daily-report-wa` | Daily | Laporan harian via WA |

---

## 11. Enterprise AI Blueprint

### 11.1 AI sebagai Advisor — Prinsip Utama

> **ADR-0004:** AI adalah advisor, BUKAN executor keuangan.
> AI TIDAK BOLEH auto-approve atau auto-post entri akuntansi.
> Semua rekomendasi AI wajib dikonfirmasi manusia.

### 11.2 AI Capabilities yang Sudah Ada

| Capability | Modul | Status |
|---|---|---|
| **COA Auto-suggestion** | Bank Recon → COA Proposal | ✅ Production |
| **Transaction Classification** | AI Transaction Intelligence | ✅ Production |
| **Intent Detection** | AI Transaction Understanding | ✅ Production |
| **Pattern Recognition** | Settlement Pattern Engine | ✅ Production |
| **Explainability** | AI Transaction Explainability | ✅ Production |
| **Adaptive Rules** | AI Transaction Adaptive Rule Engine | ✅ Production |
| **Learning Engine** | AI Transaction Learning | ✅ Production |

### 11.3 AI Capabilities yang Direncanakan

| Capability | Domain | Prioritas |
|---|---|---|
| **OCR** | Document Management | P1 |
| **Demand Forecasting** | Inventory / Procurement | P1 |
| **Price Recommendation** | Marketplace / Sales | P2 |
| **Fraud Detection** | Payment / Finance | P1 |
| **Vendor Matching** | Procurement / Marketplace | P2 |
| **Customer Churn Prediction** | CRM | P3 |
| **Anomaly Detection** | Accounting / Finance | P2 |
| **Smart Search / Recommendation** | Marketplace | P2 |

### 11.4 AI Governance Framework

```
AI Recommendation
    │
    ├─► Confidence Score (0–100%)
    ├─► Explanation (kenapa rekomendasi ini)
    ├─► Source Data (transaksi / pola apa yang dianalisis)
    │
    └─► Human Review Required?
              ├─► HIGH confidence (>85%): Pre-fill, user konfirmasi 1 klik
              ├─► MEDIUM confidence (60–85%): Tampilkan dengan warning
              └─► LOW confidence (<60%): Manual review, AI sebagai referensi saja
```

### 11.5 AI Infrastructure

- **Provider:** OpenAI (configured, `OPENAI_API_KEY` di secrets)
- **Persistence:** `ai_review_persistence` tables untuk learning
- **Governance Expire:** `ai-governance-expire` worker (scheduled)
- **Phase system:** Phase 1–4 sudah ada (lihat `PHASE4_EXPLAINABILITY_FINAL_REPORT.md`)

---

## 12. Enterprise Analytics Blueprint

### 12.1 Dashboard Hierarchy

| Dashboard | Audience | Konten |
|---|---|---|
| **CEO / Holding Dashboard** | CEO, Board | Revenue, profit, kas, KPI ringkasan lintas company |
| **Director Dashboard** | Director per BU | Revenue BU, pipeline, margin, headcount |
| **Finance Dashboard** | CFO, Finance Manager | P&L, cash flow, AP/AR aging, bank position |
| **Accounting Dashboard** | Controller, Accountant | Trial balance, open entries, reconciliation status |
| **Procurement Dashboard** | Procurement Head | PR aging, vendor performance, spend analysis |
| **Sales Dashboard** | Sales Manager | Pipeline, win rate, revenue forecast, customer acquisition |
| **Operations Dashboard** | Ops Manager | Fulfillment rate, SLA, fleet utilization |
| **Warehouse Dashboard** | Warehouse Manager | Stock level, movement velocity, opname schedule |
| **Vendor Dashboard** | Vendor (self-service) | Order history, payment status, katalog performance |
| **Customer Dashboard** | Customer (portal) | Order history, invoice, payment, shipment tracking |

### 12.2 Metric Framework (Per Domain)

**Finance KPI:**
- Cash balance (per account)
- AR aging (0-30, 31-60, 61-90, >90 hari)
- AP aging
- Revenue vs Budget
- Gross Margin %
- Net Profit %

**Procurement KPI:**
- PR-to-PO cycle time
- Vendor on-time delivery %
- Spend by vendor / category
- Savings vs target price

**Inventory KPI:**
- Stock turnover ratio
- Days Sales of Inventory (DSI)
- Stock-out frequency
- Write-off value

**Marketplace KPI:**
- RFQ conversion rate
- Average quote response time
- Commission revenue
- Vendor participation rate

### 12.3 Analytics Architecture

```
Source Systems (API, DB)
    │
    └─► Data Layer
              ├─► Real-time: Direct DB queries (OLTP)
              ├─► Near real-time: Materialized views
              └─► Historical: Data warehouse / Google Sheets sync (gsheet-nightly-sync worker)
                        │
                        └─► Dashboard Engine
                                  ├─► BizPortal (admin analytics)
                                  ├─► Customer Portal (customer analytics)
                                  └─► Export (Excel, PDF)
```

---

## 13. Enterprise Security Blueprint

### 13.1 Authentication

| Metode | Penggunaan | Status |
|---|---|---|
| **Email + Password** | BizPortal login | ✅ Production |
| **Google OAuth** | BizPortal login (SSO) | ✅ Production |
| **WhatsApp OTP** | BizPortal login alternatif | ✅ Production |
| **Email OTP** | Verifikasi Customer Portal | ✅ Production |
| **Vendor Token** | Akses vendor tanpa login (RFQ response) | ✅ Production |
| **Portal Admin Key** | Admin access Customer Portal | ✅ Production |
| **Driver JWT** | Driver app auth | ✅ Production |

### 13.2 Authorization (RBAC + ABAC)

```
RBAC (Role-Based):
  User → custom_role (company-scoped)
                │
                └─► rbac_role_permissions
                          ├─► module: string
                          ├─► action: string ("read" | "create" | "update" | "delete" | "approve")
                          └─► allowed: boolean

ABAC (Attribute-Based):
  Tambahan filter per request:
    - company_id (multi-tenant isolation)
    - own records only (user hanya bisa lihat data sendiri)
    - threshold amount (approve < 10jt vs > 10jt)
```

### 13.3 Secret Management

```
Replit Secrets (bootstrap only):
  GCP_PROJECT_ID, GCP_SECRET_ID, GCP_SECRET_MANAGER_BOOTSTRAP_JSON

          ↓ load-secrets.mjs

GCP Secret Manager (semua app secrets):
  SUPABASE_DATABASE_URL, OPENAI_API_KEY, PAYLABS_*, FONNTE_TOKEN,
  SESSION_SECRET, SMTP_*, VAPID_*, GOOGLE_CLIENT_*, dll.

APP_ENV → development: inject *_DEV keys sebagai canonical names
APP_ENV → production: inject production keys

TIDAK BOLEH:
  ❌ Simpan app secret di Replit Secrets langsung
  ❌ Hardcode secret di kode
  ❌ Log secret ke console / file
```

### 13.4 Data Security

| Layer | Mekanisme |
|---|---|
| **Transport** | HTTPS (mTLS via Replit proxy) |
| **Session** | Signed cookies (`SESSION_SECRET`), secure flag |
| **Database** | Supabase RLS (Row Level Security) |
| **Storage** | Supabase Storage policies (private bucket, signed URLs) |
| **API** | Auth middleware (wajib di semua route non-public) |
| **Audit Log** | `vendor_audit_logs`, `mkt_activity_logs`, `coa_versions` |

### 13.5 Audit Trail

| Domain | Tabel Audit | Coverage |
|---|---|---|
| COA | `coa_versions` | Append-only, full history |
| Marketplace | `mkt_activity_logs` | Semua event RFQ/quote/PO |
| Vendor | `vendor_audit_logs` | Perubahan data vendor |
| Accounting | `accounting_entries` (immutable) | Semua journal, tidak bisa dihapus |
| Auth | `token_access_log` | Login, token usage |
| General | *(planned)* `audit_logs` | Universal audit trail |

### 13.6 Trusted Devices & Session Management

- `wa_otp_codes` — OTP via WA, time-limited
- `trusted_devices` — device fingerprint, mengurangi re-auth
- `sessions` — server-side session store (PostgreSQL-backed)
- Session cleanup: `token-cleanup` worker (scheduled)

---

## 14. Enterprise Integration Matrix

### 14.1 Internal Service Integration

| From | To | Protocol | Mekanisme |
|---|---|---|---|
| Customer Portal | API Server | HTTP/REST | Via Gateway (port 5000) |
| BizPortal | API Server | HTTP/REST | Via Gateway (port 5000) |
| Logistic Order | API Server | HTTP/REST | Via Gateway (port 5000) |
| Driver Operations | API Server | HTTP/REST | Via BizPortal, WhatsApp, and tokenized progress links |
| API Server | API Server | Internal function call | Direct module import |

### 14.2 External Integration Matrix

| Integrasi | Tujuan | Status | Secret/Config |
|---|---|---|---|
| **Supabase (dev)** | Database + Storage (dev) | ✅ Active | `SUPABASE_*_DEV` |
| **Supabase (prod)** | Database + Storage (prod) | ✅ Active | `SUPABASE_*` |
| **GCP Secret Manager** | Secret storage | ✅ Active | `GCP_PROJECT_ID`, `GCP_SECRET_ID` |
| **OpenAI** | AI/ML inference | ✅ Active | `OPENAI_API_KEY` |
| **Fonnte** | WhatsApp gateway | ✅ Active | `FONNTE_TOKEN` |
| **Google OAuth** | SSO login | ✅ Active | `GOOGLE_CLIENT_*` |
| **Google Sheets** | Nightly sync / reporting | ✅ Active | `GOOGLE_SERVICE_ACCOUNT_JSON` |
| **Paylabs** | Payment gateway | ✅ Active | `PAYLABS_*` |
| **SMTP (Email)** | Transactional email | ✅ Active | `SMTP_FROM`, `SMTP_PASS` |
| **Web Push (VAPID)** | Browser push notification | ✅ Active | `VAPID_*` |
| **GitHub** | Source control / deploy | ✅ Active | `GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN` |

### 14.3 Integration Architecture

```
External Services
    │
    └─► load-secrets.mjs (injeksi credentials saat startup)
              │
              └─► Application Code
                        ├─► Supabase Client (DB + Storage)
                        ├─► OpenAI Client
                        ├─► Fonnte HTTP Client
                        ├─► Google APIs (Sheets + OAuth)
                        ├─► Paylabs SDK
                        └─── SMTP Client (Nodemailer)
```

### 14.4 Integration Governance Rules

1. Semua credential eksternal harus ada di GCP Secret Manager — tidak boleh hardcode
2. Setiap integrasi memiliki health check (lihat `integration-health-check` worker)
3. Failure integrasi wajib logging dan alerting (WA admin)
4. Rate limiting: semua outbound call ke third-party wajib memiliki retry + backoff
5. PII tidak boleh dikirim ke third-party tanpa masking (kecuali payment gateway)

---

## 15. Enterprise API Governance

### 15.1 API Versioning Strategy

| Strategi | Keputusan | Alasan |
|---|---|---|
| URL versioning | `/api/v1/...` | Eksplisit, mudah di-proxy |
| Header versioning | Tidak digunakan | Kompleks, sulit test |
| Breaking changes | Harus buat versi baru `/api/v2/...` | Backward compatibility |
| Deprecation period | Minimum 3 bulan notice | Memberi waktu client migrate |

### 15.2 Naming Convention

| Elemen | Konvensi | Contoh |
|---|---|---|
| Resource noun | kebab-case, plural | `/purchase-orders`, `/vendor-quotes` |
| Action (non-CRUD) | POST + verb | `POST /quotes/:id/submit` |
| Filter/sort | query params | `?status=active&sort=created_at` |
| Pagination | `?page=1&limit=20` | Standard pagination |
| Response envelope | `{ data, meta, error }` | Konsisten di semua endpoint |
| Error codes | `{ code: "VALIDATION_ERROR", message: "...", details: [] }` | Machine-readable |

### 15.3 API Ownership Matrix

| Domain Prefix | Owner | Auth Required |
|---|---|---|
| `/api/auth/*` | Auth Module | Public (beberapa route) |
| `/api/admin/*` | Platform Admin | Admin JWT |
| `/api/accounting/*` | Finance Team | Company Admin + Finance |
| `/api/procurement/*` | Procurement Module | Authenticated + Role |
| `/api/marketplace/*` (internal) | Marketplace Module | Admin / Company Auth |
| `/api/vendor/*` (external) | Vendor Module | Vendor Token |
| `/api/portal/*` | Customer Portal | Portal Auth |
| `/api/logistics/*` | Logistics Module | Authenticated + Role |
| `/api/sport-center/*` | Sport Center Module | Authenticated + Role |

### 15.4 Public vs Internal API

| Type | Exposure | Auth | Rate Limit |
|---|---|---|---|
| **Public API** | Customer Portal, Vendor Portal | Token / No Auth | Strict (100 req/min) |
| **Internal API** | BizPortal, Logistic App | JWT Session | Relaxed (1000 req/min) |
| **Service-to-Service** | Internal microservice calls | Service token / None | None (same process) |
| **Webhook** | Third-party callbacks | HMAC signature | Per provider rules |

### 15.5 Deprecation Policy

```
1. Announce: dokumentasi di changelog + response header `Sunset: {date}`
2. Warning Period: minimum 3 bulan
3. Migration Guide: sediakan guide ke versi baru
4. Sunset: return HTTP 410 Gone setelah tanggal sunset
5. Remove: hapus kode setelah 6 bulan sunset
```

### 15.6 API Standards yang Harus Diterapkan

- [ ] OpenAPI 3.0 spec untuk semua endpoint (saat ini belum ada — lihat Gap Analysis)
- [ ] Zod validation di semua request body (partial sudah ada)
- [ ] Consistent error format `{ code, message, details }`
- [ ] Pagination di semua list endpoint
- [ ] Request ID tracing (`X-Request-ID` header)

---

## 16. Enterprise Disaster Recovery Blueprint

### 16.1 Backup Strategy

| Aset | Backup Method | Frekuensi | Retention |
|---|---|---|---|
| **Database (Supabase)** | Supabase automated backup | Daily (+ PITR 7 hari) | 7 hari rolling |
| **Database (manual)** | `pg_dump` scheduled | Weekly | 4 minggu |
| **Supabase Storage** | Supabase replication | Continuous | Permanent |
| **Codebase** | GitHub repository | Per commit | Permanent |
| **Secrets** | GCP Secret Manager versioning | Per update | 10 versions |
| **Config** | `replit.md` + `.replit` di git | Per commit | Permanent |

### 16.2 Recovery Procedures

**Scenario A: Database corruption / data loss**
```
1. Identify: tentukan waktu terakhir data valid
2. Supabase PITR (Point-in-Time Recovery) → restore ke timestamp tertentu
3. Verifikasi: jalankan integrity checks
4. Notify: informasikan downtime dan affected data range
```

**Scenario B: Deployment failure (code rollback)**
```
1. Identify: version yang bermasalah
2. Git revert ke commit sebelumnya
3. Rebuild & redeploy
4. Atau: Replit checkpoint rollback (tersedia di UI)
```

**Scenario C: Secret compromise**
```
1. Rotate key di provider (GCP, OpenAI, Paylabs, dll.)
2. Update di GCP Secret Manager
3. Restart application (load-secrets.mjs reload)
4. Audit log: cek semua akses dengan key lama
5. Notify affected parties jika diperlukan
```

### 16.3 Data Merge Procedures

**Merge Company (Akuisisi / Restrukturisasi):**
```
1. Audit: map semua entitas (customers, vendors, transactions) source → target
2. COA Reconciliation: remap account_id source ke target company COA
3. Data Migration: INSERT ke company target dengan new IDs
4. Accounting: create opening balance entries di target
5. Deactivate: soft-delete company source (is_active=false)
6. Verification: trial balance match sebelum dan sesudah
```

**Merge Vendor:**
```
1. Canonical vendor: tentukan satu supplier sebagai master
2. Remap: update semua FK (purchase_documents, vendor_invoices, dll.) ke canonical vendor
3. Catalog: merge vendor_catalog_items (deduplicate)
4. Deactivate: soft-delete vendor duplikat
5. Audit trail: log merge event
```

**Merge Customer:**
```
1. Canonical customer: tentukan satu customers record sebagai master
2. Remap: update semua FK (sales_documents, portal_product_orders, mkt_rfqs) ke canonical
3. Deactivate: soft-delete customer duplikat
4. Notify: inform customer yang affected
```

### 16.4 Soft Delete Policy

| Entitas | Soft Delete Field | Hard Delete Allowed? |
|---|---|---|
| Master Data (companies, suppliers, customers, products) | `is_active=false` | ❌ Tidak |
| Transactions (accounting_entries, invoices, PO) | `is_voided=true` + reversal | ❌ Tidak |
| Users | `deleted_at timestamp` | ❌ Tidak (audit trail) |
| Documents | `status='archived'` | ❌ Tidak |
| COA | `status='inactive'` | ❌ Tidak |
| Marketplace (RFQ, Quote) | `status='cancelled'/'expired'` | ❌ Tidak |

### 16.5 RTO & RPO Target

| Service | RTO (Recovery Time) | RPO (Data Loss) |
|---|---|---|
| API Server | < 5 menit | 0 (database di Supabase) |
| BizPortal | < 5 menit | N/A (stateless frontend) |
| Customer Portal | < 5 menit | N/A (stateless frontend) |
| Database | < 30 menit | < 1 menit (PITR) |
| Secrets | < 5 menit | 0 (GCP Secret Manager) |

---

## 17. Enterprise Dependency Matrix

### 17.1 Service Dependencies

```
Customer Portal (23434)
    └─► API Server (18444) ── via Gateway (5000)
              │
              ├─► Supabase PostgreSQL
              ├─► Supabase Storage
              ├─► OpenAI API
              ├─► Fonnte (WhatsApp)
              ├─► Paylabs (Payment)
              ├─► SMTP (Email)
              ├─► Google OAuth
              └─► Google Sheets

BizPortal (18442)
    └─► API Server (18444) ── via Gateway (5000)

Logistic Order (19368)
    └─► API Server (18444) ── via Gateway (5000)

```

### 17.2 Domain Dependency Map

| Domain | Depends On | Depended By |
|---|---|---|
| **Organization** | — | ALL domains |
| **Master Data** | Organization | ALL domains |
| **Auth / Security** | Master Data | ALL domains |
| **COA / Accounting** | Master Data, Organization | Finance, Procurement, Marketplace, Inventory |
| **Procurement** | Master Data, COA, Approval, Notification, Inventory | Finance |
| **Finance** | COA, Procurement, CRM, Marketplace | Analytics, Reporting |
| **Inventory** | Master Data (Product, Warehouse) | Procurement, Sales, Logistics |
| **CRM** | Master Data, Notification | Sales, Marketplace |
| **Marketplace** | Master Data, Procurement, Finance, Notification, AI | CRM, Analytics |
| **Document Mgmt** | Master Data, Storage | ALL domains |
| **Approval Engine** | Auth, Organization, Notification | Procurement, COA, Finance, Marketplace |
| **Notification** | Organization, Auth | ALL domains |
| **AI Engine** | Accounting, Marketplace, Document Mgmt | ALL AI-enabled features |
| **Analytics** | ALL domains | Reporting, Dashboard |
| **Integration** | Security (Secrets) | ALL external-facing features |

### 17.3 Critical Path Dependencies

Urutan implementasi yang aman (topological order):

```
Phase 0: Organization + Master Data + Auth + Security
Phase 1: COA + Basic Accounting + Approval Engine
Phase 2: Procurement + Inventory + Notification
Phase 3: Finance + Bank Recon + CRM
Phase 4: Marketplace (Vendor Blueprint v1.2)
Phase 5: Document Management + AI Engine
Phase 6: Analytics + Reporting
Phase 7: Full Integration + API Governance
```

---

## 18. Enterprise Roadmap 5 Tahun

### 2026 — Foundation & Core Platform

| Quarter | Milestone |
|---|---|
| **Q3 2026** | ✅ API Server production-ready, BizPortal live, Customer Portal live |
| **Q3 2026** | ✅ Vendor Blueprint v1.2 FINAL (Marketplace P0 siap implementasi) |
| **Q3 2026** | ✅ Accounting immutable, COA governance, Bank Recon live |
| **Q3 2026** | Marketplace P0 implementation (7 tabel, RFQ→Quote→PO flow) |
| **Q4 2026** | Procurement full 3-way match |
| **Q4 2026** | AI OCR dokumen (invoice, PO) |
| **Q4 2026** | Universal Approval Engine |
| **Q4 2026** | Document Management terpusat |

### 2027 — Enterprise Expansion

| Quarter | Milestone |
|---|---|
| **Q1 2027** | CRM (Lead, Opportunity, Pipeline) |
| **Q1 2027** | Multi-currency full implementation |
| **Q1 2027** | Inventory: FIFO costing |
| **Q2 2027** | CEO/Director analytics dashboard |
| **Q3 2027** | Intercompany transactions |
| **Q3 2027** | AI Demand Forecasting (Inventory + Procurement) |
| **Q4 2027** | Business Unit level (organizational) |
| **Q4 2027** | OpenAPI 3.0 spec seluruh endpoint |

### 2028 — Intelligence & Scale

| Quarter | Milestone |
|---|---|
| **Q1 2028** | AI Fraud Detection (payment + accounting) |
| **Q2 2028** | Smart Vendor Matching (Marketplace) |
| **Q3 2028** | Customer 360 Dashboard (CRM + Analytics) |
| **Q4 2028** | Predictive Cash Flow |
| **Q4 2028** | External API (Public API untuk third-party integration) |

### 2029 — Ecosystem

| Quarter | Milestone |
|---|---|
| **Q1-Q2** | Partner ecosystem (vendor self-service portal lengkap) |
| **Q3-Q4** | Enterprise mobile apps (BizPortal mobile) |
| **Q4** | API Marketplace (third-party developers) |

### 2030 — Platform Maturity

| Quarter | Milestone |
|---|---|
| **2030** | Full ISO 27001 compliance |
| **2030** | SOC2 Type II ready |
| **2030** | Multi-region deployment |
| **2030** | Platform-as-a-Service (white-label untuk klien enterprise lain) |

---

## 19. Gap Analysis

### 19.1 Gap Kritis (P0 — Harus Segera)

| Gap | Modul | Dampak | Solusi |
|---|---|---|---|
| **G01: Business Unit layer tidak ada** | Organization | Hierarki tidak lengkap | Tambah `business_units` tabel antara company dan division |
| **G02: Universal Approval Engine tidak ada** | Approval | Setiap domain punya approval sendiri, tidak reusable | Buat `approval_workflows` + `approval_requests` terpusat |
| **G03: Document Management terpusat tidak ada** | Document | Dokumen tersebar di 10+ tabel | Buat `documents` polymorphic tabel + `document_versions` |
| **G04: Marketplace P0 belum diimplementasi** | Marketplace | RFQ/Quote/PO flow belum live | Implementasi berdasarkan Vendor Blueprint v1.2 |
| **G05: OpenAPI spec tidak ada** | API | Tidak ada kontrak API formal | Buat OpenAPI 3.0 spec + auto-generate dari route definitions |

### 19.2 Gap Penting (P1 — Kuartal Ini)

| Gap | Modul | Dampak | Solusi |
|---|---|---|---|
| **G06: CRM tidak ada** | CRM | Tidak ada pipeline sales | Lead + Opportunity + Ticket tables |
| **G07: Multi-currency partial** | Finance | Tidak bisa handle transaksi multi-currency | Forex rate table + currency conversion engine |
| **G08: Financial Statement belum otomatis** | Finance | Trial balance manual, tidak ada P&L/BS otomatis | Report generation engine |
| **G09: Universal Audit Log tidak ada** | Security | Coverage audit trail tidak merata | `audit_logs` polymorphic table |
| **G10: Intercompany transactions tidak ada** | Finance | Holding tidak bisa transaksi lintas company | Intercompany journal + elimination entries |

### 19.3 Gap Teknis (P2 — Semester Ini)

| Gap | Domain | Dampak | Solusi |
|---|---|---|---|
| **G11: Request ID tracing tidak konsisten** | API | Sulit trace error lintas service | `X-Request-ID` middleware di semua route |
| **G12: Rate limiting belum ada** | API | Risiko DDoS / abuse | `express-rate-limit` per endpoint type |
| **G13: FIFO inventory costing** | Inventory | Hanya weighted average | FIFO calculation engine |
| **G14: AI OCR belum ada** | Document / AI | Manual entry dokumen | OCR pipeline dengan OpenAI Vision |
| **G15: Webhook outbound tidak ada** | Integration | Third-party tidak bisa subscribe event | Webhook delivery + retry system |

### 19.4 Gap Infrastruktur (P3 — Tahun Ini)

| Gap | Domain | Dampak | Solusi |
|---|---|---|---|
| **G16: SMS channel tidak ada** | Notification | OTP fallback tidak ada jika WA down | SMS provider integration |
| **G17: Data warehouse / OLAP tidak ada** | Analytics | Analytics query berat → lambat | Read replica / Supabase Analytics |
| **G18: API versioning tidak ada** | API | Breaking changes tidak terkontrol | Implementasi `/api/v1/` prefix + version strategy |
| **G19: E2E testing coverage rendah** | QA | Regresi tidak terdeteksi otomatis | Playwright E2E test suite |
| **G20: Event sourcing / outbox tidak konsisten** | Integration | Event hilang saat service down | Standardisasi financial outbox pattern ke semua domain |

---

## 20. Final Enterprise Recommendation

### 20.1 Architectural Strengths (Yang Sudah Bagus)

1. **Monorepo pnpm workspaces** — dependency management bersih, code sharing efisien
2. **Secret management via GCP** — zero hardcoded secrets, skalabel
3. **Accounting immutability (ADR-0002)** — journal entry tidak bisa dimanipulasi, audit-proof
4. **Universal Journal Reuse (ADR-0003)** — mencegah double-counting
5. **Dev/Prod isolation absolut (ADR-0001)** — tidak ada risiko kontaminasi data
6. **AI Advisor pattern (ADR-0004)** — AI tidak bisa auto-approve finansial
7. **Vendor Blueprint v1.2 FINAL** — marketplace design mature dengan edge cases tertangani
8. **COA Governance** — maker-checker, append-only history, posting validation
9. **Startup workers** — background jobs ter-orchestrate dengan baik

### 20.2 Risiko Utama yang Harus Ditangani

| Risiko | Severity | Mitigasi |
|---|---|---|
| **R01: Approval tidak universal** — setiap domain punya approval sendiri | HIGH | Buat Universal Approval Engine (Gap G02) |
| **R02: Document scattered** — dokumen di 10+ tabel tanpa unified management | HIGH | Document Management terpusat (Gap G03) |
| **R03: Marketplace P0 belum live** — Vendor Blueprint sudah FINAL tapi belum diimplementasi | HIGH | Implementasi segera berdasarkan blueprint |
| **R04: Tidak ada CRM** — tidak ada tracking lead/opportunity | MEDIUM | CRM module (Gap G06) |
| **R05: OpenAPI spec tidak ada** — API contract tidak terdokumentasi | MEDIUM | OpenAPI 3.0 + auto-sync (Gap G05) |
| **R06: Multi-currency partial** — bisnis internasional terhambat | MEDIUM | Forex engine (Gap G07) |
| **R07: Analytics berat di OLTP** — query analytics memperlambat produksi | MEDIUM | Read replica / OLAP layer (Gap G17) |

### 20.3 Urutan Prioritas Implementasi yang Direkomendasikan

```
IMMEDIATE (Q3 2026):
  1. Marketplace P0 (berdasarkan Vendor Blueprint v1.2) — sudah FINAL, siap implementasi
  2. Universal Approval Engine — semua domain butuh ini
  3. Procurement 3-way match — closing P1 procurement loop

SHORT TERM (Q4 2026):
  4. Document Management terpusat
  5. AI OCR (invoice, PO)
  6. Financial Statement otomatis (P&L, Balance Sheet)
  7. OpenAPI 3.0 spec

MEDIUM TERM (2027 H1):
  8. CRM (Lead, Opportunity)
  9. Multi-currency
  10. Business Unit organizational layer
  11. CEO/Analytics Dashboard
```

### 20.4 Guiding Principles untuk Seluruh Pengembangan

1. **No silos** — setiap modul baru wajib terkoneksi ke Accounting, Notification, dan Approval Engine
2. **Vendor Blueprint is sacred** — jangan ubah `enterprise-marketplace-blueprint-v1.2.md`
3. **ADRs are law** — ADR-0001 s/d ADR-0004 tidak boleh di-reverse
4. **AI advises, humans decide** — tidak ada auto-post, auto-approve pada entri keuangan
5. **Append-only audit** — setiap domain harus punya audit trail yang tidak bisa dihapus
6. **Universal over custom** — approval, notification, document, analytics harus reusable lintas domain
7. **Test before ship** — setiap fitur baru wajib punya unit test minimum 80% coverage critical paths
8. **Secret centralization** — TIDAK ADA secret baru yang boleh di-hardcode atau masuk Replit Secrets langsung

### 20.5 Dokumen Turunan yang Diperlukan

Dari blueprint ini, dokumen detail berikut perlu dibuat sebelum implementasi:

| Dokumen | Untuk Fase |
|---|---|
| Universal Approval Engine Blueprint | Immediate |
| Document Management Blueprint | Q4 2026 |
| CRM Module Blueprint | Q4 2026 |
| Financial Statement Engine Blueprint | Q4 2026 |
| Multi-currency Blueprint | 2027 H1 |
| Business Unit Organizational Blueprint | 2027 H1 |
| Analytics & Dashboard Blueprint | 2027 H1 |
| OpenAPI Specification | Q4 2026 |

---

## Appendix: Referensi Dokumen

| Dokumen | Path | Status |
|---|---|---|
| Vendor Blueprint | `docs/enterprise-marketplace-blueprint-v1.2.md` | **FINAL — JANGAN DIUBAH** |
| Architecture Decisions | `ARCHITECTURE_DECISIONS.md` | ACCEPTED |
| AI Architecture Guardrails | `AI_ARCHITECTURE_GUARDRAILS.md` | ENFORCED |
| AI Rules | `AI_RULES.md` | ENFORCED |
| COA Governance | `COA_MASTER_GOVERNANCE.md` | PRODUCTION |
| AI Transaction Intelligence | `AI_TRANSACTION_UNDERSTANDING.md` | PRODUCTION |
| Bank Recon Config | `BANK_RECONCILIATION_CONFIGURATION.md` | PRODUCTION |
| Secret Architecture | `docs/secret-architecture.md` | PRODUCTION |
| End-to-End Accounting Flow | `artifacts/api-server/docs/END_TO_END_ACCOUNTING_FLOW.md` | PRODUCTION |

---

*CST Enterprise Master Blueprint v1.0 — 2026-08-06*
*Blueprint ini adalah dokumen hidup. Update setiap kali ada keputusan arsitektur baru.*
*TIDAK ADA kode yang boleh dibuat berdasarkan dokumen ini tanpa approval eksplisit.*
