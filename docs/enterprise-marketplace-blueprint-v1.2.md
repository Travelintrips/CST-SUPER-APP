# Enterprise Marketplace — Blueprint v1.2

**Status:** DRAFT — AWAITING USER APPROVAL BEFORE ANY IMPLEMENTATION  
**Versi:** 1.2  
**Tanggal:** 2026-07-02  
**Berdasarkan:** Blueprint v1.1 + Architecture Freeze Review (23 temuan F01–F23)  
**Aturan:** Tidak ada kode, migration, atau perubahan schema sebelum approval eksplisit.

### Changelog v1.1 → v1.2

| Temuan | Perubahan |
|---|---|
| F01 | Tambah Section 18: Complete Index Plan |
| F02 | Tambah `mkt_activity_logs` ke Final Table List P0 (jadi 7 tabel) |
| F03 | Tambah endpoint `POST /admin/purchase-orders/:id/post-journal` |
| F04 | Hapus `GET /catalog` (duplikat) — ganti referensi ke endpoint existing `/products` |
| F05 | Tambah Section 19: Request Body Zod Schemas |
| F06 | Tambah pagination spec ke semua list endpoints |
| F07 | Tambah Section 20: Auth Middleware Mapping Table |
| F08 | Tambah kolom `line_count` + `quote_count` ke schema `mkt_rfqs` |
| F09 | Tambah Section 21: Edge Case Flows (buyer cancel, reject) |
| F10 | Masuk Section 21 |
| F11 | Tambah vendor quote expiry mechanism (cron-based) ke Section 21 |
| F12 | Tambah endpoint `POST /admin/quotes/:id/send-reminder` |
| F13 | `DELETE /vendor/quote/:token` → `POST /vendor/quote/:token/withdraw` |
| F14 | Tambah double-invite prevention rule ke Section 10 |
| F15 | `approve` → `select-winner` di semua endpoint names |
| F16 | Tambah Section 22: RBAC Permission Strings |
| F17 | Tambah Section 23: SSE / Real-time Strategy |
| F18 | Tambah commission → vendor payment flow ke Section 11 |
| F19 | Explicit order number format di Section 5 |
| F20 | Guest claim cleanup ditambah ke nightly reconciliation job |
| F21 | OpenAPI spec decision ditambahkan |
| F22 | Dashboard widget spec ditambahkan |
| F23 | `accounting_entries.source_id` = `mkt_purchase_orders.id` dikonfirmasi |

---

## Daftar Isi

1. [Overview Arsitektur](#1-overview-arsitektur)
2. [Final Table List P0](#2-final-table-list-p0)
3. [Tabel Dihapus dari P0](#3-tabel-dihapus-dari-p0)
4. [Tabel Reuse Existing ERP](#4-tabel-reuse-existing-erp)
5. [Final Naming Convention](#5-final-naming-convention)
6. [Schema Detail Tabel P0](#6-schema-detail-tabel-p0)
7. [Final FK Matrix](#7-final-fk-matrix)
8. [Final Enum List](#8-final-enum-list)
9. [Final API Naming](#9-final-api-naming)
10. [Final Security Rules](#10-final-security-rules)
11. [Final Accounting Rules](#11-final-accounting-rules)
12. [Final Migration Rules](#12-final-migration-rules)
13. [Feature Flag & Dual-Write](#13-feature-flag--dual-write)
14. [Guest RFQ Claim Mechanism](#14-guest-rfq-claim-mechanism)
15. [COA Mapping Marketplace](#15-coa-mapping-marketplace)
16. [Final Risk Register](#16-final-risk-register)
17. [Phase 1 Readiness Checklist](#17-phase-1-readiness-checklist)
18. [Complete Index Plan **[NEW F01]**](#18-complete-index-plan)
19. [Request Body Zod Schemas **[NEW F05]**](#19-request-body-zod-schemas)
20. [Auth Middleware Mapping **[NEW F07]**](#20-auth-middleware-mapping)
21. [Edge Case Flows **[NEW F09–F11]**](#21-edge-case-flows)
22. [RBAC Permission Strings **[NEW F16]**](#22-rbac-permission-strings)
23. [SSE / Real-time Strategy **[NEW F17]**](#23-sse--real-time-strategy)

---

## 1. Overview Arsitektur

### Model Bisnis

Enterprise Marketplace adalah modul baru di atas ERP existing yang memungkinkan:
- **Buyer** (perusahaan CST client / portal customer) melihat katalog dari banyak vendor, membuat RFQ, dan menerima multi-vendor quote.
- **Vendor** (supplier terdaftar di `suppliers`) merespons RFQ per-line dengan harga dan kondisi masing-masing.
- **Admin** mengatur komisi, approve quote, dan merekonsiliasi settlement ke accounting.

### Posisi Marketplace dalam ERP

```
vendor_catalog_items  ←── existing (reuse)
        │
        ▼
   mkt_rfqs           ←── NEW P0 (buyer mengirim kebutuhan)
        │
        ├──► mkt_rfq_lines         ←── NEW P0 (per line item)
        │         │
        │         ▼
        │    mkt_vendor_quotes      ←── NEW P0 (vendor dipilih merespons)
        │         │
        │         ▼
        │    mkt_vendor_quote_lines ←── NEW P0 (quote per line)
        │
        ├──► mkt_activity_logs     ←── NEW P0 (audit trail) [F02]
        │
        ▼
   mkt_purchase_orders ←── NEW P0 (buyer confirm → PO dibuat)
        │
        ├──► purchase_documents     ←── existing (reuse, ditambah nullable FK)
        └──► sales_documents        ←── existing reuse untuk buyer invoice
```

---

## 2. Final Table List P0

**7 tabel baru** di P0. [F02: `mkt_activity_logs` ditambahkan]

| # | Nama Tabel | Keterangan |
|---|---|---|
| 1 | `mkt_rfqs` | Header RFQ dari buyer (guest atau registered) |
| 2 | `mkt_rfq_lines` | Line items dalam RFQ |
| 3 | `mkt_vendor_quotes` | Header quote dari satu vendor untuk satu RFQ |
| 4 | `mkt_vendor_quote_lines` | Quote per line item oleh vendor |
| 5 | `mkt_purchase_orders` | Konfirmasi buyer setelah vendor quote disetujui |
| 6 | `mkt_rfq_guest_claims` | Mekanisme claim RFQ guest setelah register |
| 7 | `mkt_activity_logs` | **[F02]** Audit trail semua marketplace events |

---

## 3. Tabel Dihapus dari P0

| Tabel Lama | Alasan | Digantikan Oleh |
|---|---|---|
| `mkt_pos` | Nama bentrok dengan POS kasir | `mkt_purchase_orders` |
| `mkt_invoices` | Duplikasi | `sales_documents` (buyer) + `vendor_invoices` (vendor) |
| `mkt_payments` | Duplikasi | `sales_documents.payment_proof_token` + `payment_requests` |

---

## 4. Tabel Reuse Existing ERP

| Tabel Existing | Cara Dipakai Marketplace |
|---|---|
| `vendor_catalog_items` | Source item di-RFQ. FK dari `mkt_rfq_lines.vendor_catalog_item_id` |
| `suppliers` | Master vendor. FK dari `mkt_rfqs.catalog_vendor_id` dan `mkt_vendor_quotes.vendor_id` |
| `sales_documents` | Invoice buyer setelah PO confirmed. Buat SO kind=`order` |
| `purchase_documents` | Internal PO ke vendor. Ditambah nullable FK `mkt_purchase_order_id` |
| `accounting_taxes` | Pajak komisi. Tidak hardcode rate |
| `chart_of_accounts` | COA mapping untuk jurnal komisi |
| `accounting_entries` | Jurnal komisi. Source=`marketplace_commission`, **source_id=`mkt_purchase_orders.id`** [F23] |
| `accounting_journals` | Journal untuk posting komisi |

---

## 5. Final Naming Convention

### Prefix Tabel

| Konteks | Prefix | Contoh |
|---|---|---|
| Tabel marketplace baru | `mkt_` | `mkt_rfqs`, `mkt_rfq_lines` |
| Line items | `_lines` | `mkt_rfq_lines`, `mkt_vendor_quote_lines` |
| FK ke vendor asal catalog | `catalog_vendor_id` | `mkt_rfqs.catalog_vendor_id` |
| FK ke catalog item | `vendor_catalog_item_id` | `mkt_rfq_lines.vendor_catalog_item_id` |

### Order Number Format [F19]

Format digunakan secara eksplisit untuk menghindari conflict dengan `portal_product_orders.order_number`:

| Tipe Dokumen | Format | Contoh |
|---|---|---|
| Legacy portal product order | `PPO-YYYYMM-XXXX` | `PPO-202607-0001` |
| Marketplace RFQ | `MKT-RFQ-YYYYMM-XXXX` | `MKT-RFQ-202607-0001` |
| Marketplace PO | `MKT-PO-YYYYMM-XXXX` | `MKT-PO-202607-0001` |

Format ini mencegah conflict di `portal_product_orders.order_number` (TEXT UNIQUE) selama dual-write.

### Konvensi Field Internal

| Field | Visibilitas |
|---|---|
| `commission_rate`, `commission_amount`, `net_vendor_amount` | INTERNAL — hanya admin |
| `rank_score`, `rank_badges` | INTERNAL — hanya admin |

---

## 6. Schema Detail Tabel P0

### 6.1 `mkt_rfqs` — Header RFQ [F08: tambah counter columns]

```
mkt_rfqs
├── id                    serial PK
├── rfq_number            text UNIQUE NOT NULL          -- format: MKT-RFQ-YYYYMM-XXXX [F19]
├── company_id            integer FK → companies(id) ON DELETE SET NULL
├── catalog_vendor_id     integer FK → suppliers(id) ON DELETE SET NULL
├── buyer_name            text NOT NULL
├── buyer_email           text NOT NULL
├── buyer_phone           text
├── buyer_company         text
├── guest_token           text UNIQUE
├── guest_claimed_at      timestamp
├── guest_claimed_by      text
├── status                mkt_rfq_status NOT NULL DEFAULT 'draft'
├── priority              mkt_rfq_priority DEFAULT 'normal'
├── required_delivery_date date
├── delivery_address      text
├── notes                 text
├── email_verified        boolean NOT NULL DEFAULT false
├── email_verified_at     timestamp
├── line_count            integer NOT NULL DEFAULT 0    -- [F08] denormalized counter
├── quote_count           integer NOT NULL DEFAULT 0    -- [F08] denormalized counter
├── created_at            timestamp NOT NULL DEFAULT now()
└── updated_at            timestamp NOT NULL DEFAULT now()
```

**Update rule untuk counters [F08]:**
- `line_count`: increment saat INSERT ke `mkt_rfq_lines`, decrement saat DELETE.
- `quote_count`: increment saat INSERT ke `mkt_vendor_quotes` dengan status `submitted`/`revised`.

### 6.2 `mkt_rfq_lines` — Line Item RFQ

```
mkt_rfq_lines
├── id                      serial PK
├── rfq_id                  integer FK → mkt_rfqs(id) ON DELETE CASCADE NOT NULL
├── vendor_catalog_item_id  integer FK → vendor_catalog_items(id) ON DELETE SET NULL
├── item_name               text NOT NULL
├── item_description        text
├── item_unit               text
├── requested_qty           numeric(12,3) NOT NULL DEFAULT 1
├── target_price_per_unit   numeric(14,2)
├── notes                   text
├── sort_order              integer NOT NULL DEFAULT 0
├── created_at              timestamp NOT NULL DEFAULT now()
└── updated_at              timestamp NOT NULL DEFAULT now()
```

### 6.3 `mkt_vendor_quotes` — Header Quote Vendor

```
mkt_vendor_quotes
├── id                    serial PK
├── rfq_id                integer FK → mkt_rfqs(id) ON DELETE CASCADE NOT NULL
├── vendor_id             integer FK → suppliers(id) ON DELETE RESTRICT NOT NULL
├── token                 text UNIQUE NOT NULL
├── status                mkt_quote_status NOT NULL DEFAULT 'invited'
├── valid_until           timestamp
├── delivery_date_offered date
├── notes                 text
├── attachment_url        text
│
│   -- INTERNAL FIELDS (tidak pernah expose ke vendor/buyer API)
├── commission_rate       numeric(5,3)
├── commission_tax_id     integer FK → accounting_taxes(id) ON DELETE SET NULL
├── commission_amount     numeric(14,2)
├── net_vendor_amount     numeric(14,2)
├── rank_score            numeric(8,4)
├── rank_badges           jsonb
│
├── submitted_at          timestamp
├── opened_at             timestamp
├── created_at            timestamp NOT NULL DEFAULT now()
└── updated_at            timestamp NOT NULL DEFAULT now()
```

**Constraint double-invite [F14]:**
```sql
UNIQUE (rfq_id, vendor_id)
-- Satu vendor hanya boleh diinvite sekali per RFQ.
-- Jika admin perlu re-invite, gunakan endpoint send-reminder.
```

### 6.4 `mkt_vendor_quote_lines` — Quote Per Line

```
mkt_vendor_quote_lines
├── id                      serial PK
├── quote_id                integer FK → mkt_vendor_quotes(id) ON DELETE CASCADE NOT NULL
├── rfq_line_id             integer FK → mkt_rfq_lines(id) ON DELETE CASCADE NOT NULL
├── vendor_catalog_item_id  integer FK → vendor_catalog_items(id) ON DELETE SET NULL
├── offered_unit_price      numeric(14,2) NOT NULL
├── offered_qty             numeric(12,3) NOT NULL
├── subtotal                numeric(14,2) NOT NULL DEFAULT 0
├── lead_time_days          integer
├── stock_status            mkt_stock_status DEFAULT 'available'
├── notes                   text
├── created_at              timestamp NOT NULL DEFAULT now()
└── updated_at              timestamp NOT NULL DEFAULT now()
```

### 6.5 `mkt_purchase_orders` — PO Buyer

```
mkt_purchase_orders
├── id                    serial PK
├── po_number             text UNIQUE NOT NULL           -- format: MKT-PO-YYYYMM-XXXX [F19]
├── rfq_id                integer FK → mkt_rfqs(id) ON DELETE RESTRICT NOT NULL
├── quote_id              integer FK → mkt_vendor_quotes(id) ON DELETE RESTRICT NOT NULL
├── company_id            integer FK → companies(id) ON DELETE SET NULL
├── vendor_id             integer FK → suppliers(id) ON DELETE RESTRICT NOT NULL
├── status                mkt_po_status NOT NULL DEFAULT 'pending'
├── total_amount          numeric(14,2) NOT NULL DEFAULT 0
├── tax_amount            numeric(14,2) NOT NULL DEFAULT 0
├── grand_total           numeric(14,2) NOT NULL DEFAULT 0
├── sales_document_id     integer FK → sales_documents(id) ON DELETE SET NULL
├── confirmed_at          timestamp
├── cancelled_at          timestamp
├── cancel_reason         text
├── created_by            text
├── accounting_posted_at  timestamp                      -- kapan jurnal di-post [F18]
├── vendor_payment_req_id integer                        -- FK ke payment_requests.id [F18]
├── created_at            timestamp NOT NULL DEFAULT now()
└── updated_at            timestamp NOT NULL DEFAULT now()
```

### 6.6 `mkt_rfq_guest_claims` — Guest Claim

```
mkt_rfq_guest_claims
├── id                    serial PK
├── rfq_id                integer FK → mkt_rfqs(id) ON DELETE CASCADE NOT NULL
├── guest_email           text NOT NULL
├── guest_token           text NOT NULL
├── claimed_by_user_id    text
├── claim_status          mkt_claim_status NOT NULL DEFAULT 'pending'
├── claimed_at            timestamp
├── expires_at            timestamp NOT NULL
├── created_at            timestamp NOT NULL DEFAULT now()
```

### 6.7 `mkt_activity_logs` — Audit Trail [F02 NEW]

```
mkt_activity_logs
├── id              serial PK
├── entity_type     text NOT NULL   -- 'rfq' | 'quote' | 'purchase_order'
├── entity_id       integer NOT NULL
├── rfq_id          integer         -- selalu diisi untuk query per-RFQ
├── actor_type      text NOT NULL   -- 'buyer' | 'vendor' | 'admin' | 'system'
├── actor_id        text            -- user_id, vendor token suffix, atau 'system'
├── actor_name      text            -- display name
├── action          text NOT NULL   -- lihat canonical action list di bawah
├── description     text            -- human-readable log message
├── meta            jsonb           -- data tambahan (old_status, new_status, price, dll)
├── created_at      timestamp NOT NULL DEFAULT now()
```

**Canonical action values untuk `action` field:**
```
rfq_submitted          vendor_invited        vendor_opened
vendor_quote_submitted vendor_quote_revised  vendor_quote_withdrawn
vendor_quote_selected  vendor_quote_rejected vendor_reminder_sent
po_created             po_confirmed          po_cancelled
journal_posted         buyer_cancelled       buyer_rejected_all_quotes
guest_claim_attempted  guest_claim_success   email_verified
```

---

## 7. Final FK Matrix

| Dari | Field | → Target | Field | On Delete |
|---|---|---|---|---|
| `mkt_rfqs` | `company_id` | `companies` | `id` | SET NULL |
| `mkt_rfqs` | `catalog_vendor_id` | `suppliers` | `id` | SET NULL |
| `mkt_rfq_lines` | `rfq_id` | `mkt_rfqs` | `id` | CASCADE |
| `mkt_rfq_lines` | `vendor_catalog_item_id` | `vendor_catalog_items` | `id` | SET NULL |
| `mkt_vendor_quotes` | `rfq_id` | `mkt_rfqs` | `id` | CASCADE |
| `mkt_vendor_quotes` | `vendor_id` | `suppliers` | `id` | RESTRICT |
| `mkt_vendor_quotes` | `commission_tax_id` | `accounting_taxes` | `id` | SET NULL |
| `mkt_vendor_quote_lines` | `quote_id` | `mkt_vendor_quotes` | `id` | CASCADE |
| `mkt_vendor_quote_lines` | `rfq_line_id` | `mkt_rfq_lines` | `id` | CASCADE |
| `mkt_vendor_quote_lines` | `vendor_catalog_item_id` | `vendor_catalog_items` | `id` | SET NULL |
| `mkt_purchase_orders` | `rfq_id` | `mkt_rfqs` | `id` | RESTRICT |
| `mkt_purchase_orders` | `quote_id` | `mkt_vendor_quotes` | `id` | RESTRICT |
| `mkt_purchase_orders` | `company_id` | `companies` | `id` | SET NULL |
| `mkt_purchase_orders` | `vendor_id` | `suppliers` | `id` | RESTRICT |
| `mkt_purchase_orders` | `sales_document_id` | `sales_documents` | `id` | SET NULL |
| `mkt_rfq_guest_claims` | `rfq_id` | `mkt_rfqs` | `id` | CASCADE |
| **`purchase_documents`** | **`mkt_purchase_order_id`** (ADD COLUMN) | **`mkt_purchase_orders`** | **`id`** | SET NULL |

---

## 8. Final Enum List

### `mkt_rfq_status`
```
draft → submitted → in_review → quoted → accepted → cancelled | expired
```
`buyer_rejected` ditambah untuk kasus buyer reject semua quote [F10]:
```
draft, submitted, in_review, quoted, accepted, buyer_rejected, cancelled, expired
```

### `mkt_rfq_priority`
```
low, normal, high, urgent
```

### `mkt_quote_status`
```
invited, opened, submitted, revised, withdrawn, not_selected, rejected, accepted, expired
```
`not_selected` ditambah [F10] — vendor yang "kalah" tapi tidak di-reject secara eksplisit:
```
invited → opened → submitted → revised → accepted
                              ↘ not_selected (winner dipilih, vendor ini tidak)
                              ↘ rejected (admin tolak eksplisit)
                              ↘ withdrawn (vendor tarik diri)
invited → expired (vendor tidak respons sebelum deadline)
```

### `mkt_po_status`
```
pending, confirmed, in_fulfillment, completed, cancelled
```

### `mkt_stock_status`
```
available, partial, backorder, unavailable
```

### `mkt_claim_status`
```
pending, claimed, expired, failed
```

### Peringatan DDL Enum

> ⚠️ `ALTER TYPE <enum_name> ADD VALUE` **harus dijalankan di luar transaction block**, via session pooler port 5432 (bukan 6543). Setiap CREATE TYPE harus satu statement terpisah per `db.execute()`.

---

## 9. Final API Naming

### Base Path: `/api/marketplace/`

### Catalog Endpoints (Public — Sudah Exist)

> **[F04]** Endpoint katalog **sudah ada** di `marketplace.ts`. Blueprint tidak membuat endpoint baru untuk ini.

| Method | Path | Auth | Status |
|---|---|---|---|
| `GET` | `/api/marketplace/products` | None | ✅ EXISTS — gunakan ini |
| `GET` | `/api/marketplace/vendors` | None | ✅ EXISTS |
| `GET` | `/api/marketplace/categories` | None | ✅ EXISTS |
| `GET` | `/api/marketplace/products/:id` | None | ✅ EXISTS |

### Buyer Endpoints

| Method | Path | Auth | Paginasi | Keterangan |
|---|---|---|---|---|
| `POST` | `/api/marketplace/rfqs` | None / Portal bearer | — | Submit RFQ baru |
| `GET` | `/api/marketplace/rfqs` | Portal bearer | ✅ `?page&limit&status` | List RFQ buyer |
| `GET` | `/api/marketplace/rfqs/:rfqNumber` | Portal bearer | — | Detail RFQ + quotes |
| `POST` | `/api/marketplace/rfqs/:rfqNumber/accept` | Portal bearer | — | Accept satu quote |
| `POST` | `/api/marketplace/rfqs/:rfqNumber/cancel` | Portal bearer | — | Cancel RFQ [F09] |
| `POST` | `/api/marketplace/rfqs/:rfqNumber/reject-all-quotes` | Portal bearer | — | Reject semua quote [F10] |
| `GET` | `/api/marketplace/rfqs/guest/:token` | None (token) | — | Tracking RFQ guest |
| `POST` | `/api/marketplace/rfqs/claim` | Portal bearer | — | Claim guest RFQ |
| `GET` | `/api/marketplace/purchase-orders` | Portal bearer | ✅ `?page&limit&status` | List PO buyer |
| `GET` | `/api/marketplace/purchase-orders/:poNumber` | Portal bearer | — | Detail PO |

### Vendor Endpoints (Token-Based, No Login)

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| `GET` | `/api/marketplace/vendor/quote/:token` | Token-only | Buka RFQ invitation + lines |
| `POST` | `/api/marketplace/vendor/quote/:token` | Token-only | Submit quote + lines |
| `PUT` | `/api/marketplace/vendor/quote/:token` | Token-only | Revisi quote |
| `POST` | `/api/marketplace/vendor/quote/:token/withdraw` | Token-only | **[F13]** Withdraw quote |

> `VendorQuotePublic` schema wajib dipakai — **tidak boleh expose** `commission_rate`, `commission_amount`, `net_vendor_amount`, `rank_score`, `rank_badges`.

### Admin Endpoints (Internal Session Required)

| Method | Path | Auth | Paginasi | Keterangan |
|---|---|---|---|---|
| `GET` | `/api/marketplace/admin/rfqs` | `requireAdmin` | ✅ `?page&limit&status&vendor_id&date_from&date_to&search` | List semua RFQ |
| `GET` | `/api/marketplace/admin/rfqs/:rfqNumber` | `requireAdmin` | — | Detail RFQ lengkap (termasuk internal fields) |
| `POST` | `/api/marketplace/admin/rfqs/:rfqNumber/invite-vendor` | `requireAdmin` | — | Undang vendor |
| `POST` | `/api/marketplace/admin/quotes/:id/select-winner` | `requireAdmin` | — | **[F15]** Pilih vendor pemenang |
| `POST` | `/api/marketplace/admin/quotes/:id/reject` | `requireAdmin` | — | Reject quote vendor |
| `POST` | `/api/marketplace/admin/quotes/:id/send-reminder` | `requireAdmin` | — | **[F12]** Kirim reminder ke vendor |
| `GET` | `/api/marketplace/admin/purchase-orders` | `requireAdmin` | ✅ `?page&limit&status` | List semua PO |
| `POST` | `/api/marketplace/admin/purchase-orders/:id/confirm` | `requireAdmin` | — | Konfirmasi PO → buat SO |
| `POST` | `/api/marketplace/admin/purchase-orders/:id/post-journal` | `requireAdmin` | — | **[F03]** Post jurnal akuntansi manual |
| `POST` | `/api/marketplace/admin/purchase-orders/:id/cancel` | `requireAdmin` | — | Cancel PO |
| `GET` | `/api/marketplace/admin/commission-report` | `requireAdmin` | ✅ `?page&limit&date_from&date_to&vendor_id` | Laporan komisi |
| `GET` | `/api/marketplace/admin/reconciliation` | `requireAdmin` | — | Dual-write reconciliation |

### Dashboard Widget Endpoints [F22]

| Method | Path | Auth | Response |
|---|---|---|---|
| `GET` | `/api/marketplace/admin/dashboard-stats` | `requireAdmin` | `{ open_rfqs, pending_pos, commission_mtd, unverified_rfqs }` |

---

## 10. Final Security Rules

### 10.1 Field Visibility

Field INTERNAL ONLY — wajib tidak terekspos ke vendor atau buyer API:

| Field | Tabel |
|---|---|
| `commission_rate` | `mkt_vendor_quotes` |
| `commission_amount` | `mkt_vendor_quotes` |
| `net_vendor_amount` | `mkt_vendor_quotes` |
| `rank_score` | `mkt_vendor_quotes` |
| `rank_badges` | `mkt_vendor_quotes` |

**Implementasi:** Zod schema `VendorQuotePublic` (untuk vendor/buyer) vs `VendorQuoteInternal` (untuk admin).

### 10.2 Rate Limiting Guest RFQ

| Endpoint | Limit | Window |
|---|---|---|
| `POST /rfqs` (guest) | 3 RFQ | per email per jam |
| `POST /rfqs` (guest) | 10 RFQ | per IP per hari |
| `POST /rfqs/claim` | 5 percobaan | per email per hari |

Gunakan `rfqRateLimit` middleware yang sudah ada di `middlewares/rfqRateLimit.ts`.

### 10.3 Double-Invite Prevention [F14]

Constraint UNIQUE `(rfq_id, vendor_id)` di `mkt_vendor_quotes` mencegah admin invite vendor yang sama dua kali ke RFQ yang sama.

Jika admin perlu kirim ulang notifikasi ke vendor yang sudah diinvite → gunakan `POST /admin/quotes/:id/send-reminder`, bukan buat invite baru.

### 10.4 Token Security

- `guest_token` di `mkt_rfqs`: UUID v4 random — tidak sequential.
- `mkt_vendor_quotes.token`: UUID v4 random — tidak mengandung `vendor_id`.
- Claim token di `mkt_rfq_guest_claims`: expired dalam 7 hari.

### 10.5 Buyer Ownership Check

Setiap endpoint buyer (authenticated) wajib verifikasi kepemilikan:
- `mkt_rfqs.company_id == req.user.companyId` ATAU
- `mkt_rfqs.buyer_email == req.user.email`

Tanpa ownership check → buyer bisa akses RFQ orang lain.

### 10.6 Sales Documents Conflict Avoidance

`sales_documents` punya unique index `sales_documents_logistic_order_id_unique_idx` pada `logistic_order_id`. Saat marketplace membuat SO baru, field `logistic_order_id` **wajib NULL** (tidak boleh diisi). Ini aman karena PostgreSQL UNIQUE index tidak menganggap NULL=NULL (banyak NULL diperbolehkan).

---

## 11. Final Accounting Rules

### 11.1 Tidak Ada Hardcode Rate

`commission_tax_id` FK ke `accounting_taxes`. Tidak boleh ada rate numerik hardcoded.

### 11.2 Source ID Confirmation [F23]

Untuk `accounting_entries`:
```
source      = 'marketplace_commission'
source_id   = mkt_purchase_orders.id   ← WAJIB ini, bukan mkt_rfqs.id
```

Ini memastikan partial unique index `(source, source_id) WHERE source <> 'manual'` tidak conflict — satu PO hanya menghasilkan satu journal entry.

### 11.3 COA Mapping (7 Keys)

| Setting Key | Tipe COA |
|---|---|
| `marketplace.coa_commission_revenue` | revenue |
| `marketplace.coa_commission_tax` | liability |
| `marketplace.coa_vendor_payable` | liability |
| `marketplace.coa_buyer_receivable` | asset |
| `marketplace.coa_clearing` | asset:cash_bank |
| `marketplace.journal_id` | journal |
| `marketplace.default_commission_tax_id` | tax |

Disimpan di `system_settings` dengan prefix `marketplace.`. Validasi wajib sebelum go-live.

### 11.4 Jurnal Entry Format

Post **hanya setelah** `mkt_purchase_orders.status = 'completed'` (manual via admin di P0):

```
DEBIT  : Marketplace Buyer Receivable    grand_total buyer
CREDIT : Marketplace Vendor Payable      net_vendor_amount
CREDIT : Marketplace Commission Revenue  commission_amount (net of tax)
CREDIT : Commission Tax Payable          tax_amount
```

Dipanggil via endpoint `POST /api/marketplace/admin/purchase-orders/:id/post-journal` [F03].  
Setelah berhasil: set `mkt_purchase_orders.accounting_posted_at = now()`.

### 11.5 Commission → Vendor Payment Flow [F18]

Setelah jurnal komisi di-post, alur pembayaran ke vendor adalah:

```
Step 1: Admin post jurnal (endpoint /post-journal)
         → mkt_purchase_orders.accounting_posted_at = now()
         → accounting_entries dibuat (source='marketplace_commission')

Step 2: Admin buat vendor payment request (existing: payment_requests table)
         → vendor_payment_req_id = payment_request.id (disimpan di mkt_purchase_orders)
         → amount = mkt_vendor_quotes.net_vendor_amount

Step 3: Admin proses pembayaran via existing bank disbursements flow
         → bank_disbursements atau payment_requests existing dipakai
         → Tidak perlu tabel baru

Step 4: Vendor konfirmasi penerimaan (opsional, via WA/email)
```

Tidak ada tabel baru untuk pembayaran vendor — semua mereuse `payment_requests` dan `bank_disbursements` yang sudah ada.

---

## 12. Final Migration Rules

### 12.1 Peringatan ALTER TYPE

> ⚠️ `ALTER TYPE ADD VALUE` harus di luar transaction, via session pooler port 5432.

### 12.2 Urutan DDL (15 Steps)

```
Step 1:  CREATE TYPE mkt_rfq_status AS ENUM (...)        -- luar transaction
Step 2:  CREATE TYPE mkt_rfq_priority AS ENUM (...)       -- luar transaction
Step 3:  CREATE TYPE mkt_quote_status AS ENUM (...)       -- luar transaction
Step 4:  CREATE TYPE mkt_po_status AS ENUM (...)          -- luar transaction
Step 5:  CREATE TYPE mkt_stock_status AS ENUM (...)       -- luar transaction
Step 6:  CREATE TYPE mkt_claim_status AS ENUM (...)       -- luar transaction
Step 7:  CREATE TABLE mkt_rfqs (...)
Step 8:  CREATE TABLE mkt_rfq_lines (...)
Step 9:  CREATE TABLE mkt_vendor_quotes (...)
         + UNIQUE (rfq_id, vendor_id)                     -- [F14] double-invite constraint
Step 10: CREATE TABLE mkt_vendor_quote_lines (...)
Step 11: CREATE TABLE mkt_purchase_orders (...)
Step 12: CREATE TABLE mkt_rfq_guest_claims (...)
Step 13: CREATE TABLE mkt_activity_logs (...)             -- [F02] audit trail
Step 14: ALTER TABLE purchase_documents
           ADD COLUMN IF NOT EXISTS mkt_purchase_order_id integer
           REFERENCES mkt_purchase_orders(id) ON DELETE SET NULL
Step 15: ALTER TYPE accounting_entry_source
           ADD VALUE IF NOT EXISTS 'marketplace_commission'  -- [F23] luar transaction, port 5432
```

### 12.3 Idempotency

- `CREATE TABLE IF NOT EXISTS` untuk semua tabel baru.
- `ALTER TABLE ADD COLUMN IF NOT EXISTS` untuk semua kolom baru.
- `CREATE TYPE` cek dulu via `SELECT EXISTS (SELECT FROM pg_type WHERE typname = '...')`.
- `ALTER TYPE ADD VALUE` gunakan `IF NOT EXISTS`.

---

## 13. Feature Flag & Dual-Write

### 13.1 Kill Switch

```
FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE = true | false
```
Default: `false`. Saat deploy pertama, pipeline lama tetap aktif.

### 13.2 Dual-Write Strategy

Selama flag `false`, setiap order marketplace tulis ke dua tempat:
1. `portal_product_orders` (legacy — tetap master)
2. `mkt_rfqs` + `mkt_purchase_orders` (baru)

Jika write legacy gagal → rollback write baru → return error.  
Jika write baru gagal → log error → TIDAK rollback legacy.

### 13.3 Reconciliation Job (Nightly)

Job cron nightly melaporkan:
- `portal_product_orders` tanpa pasangan `mkt_purchase_orders`
- `mkt_purchase_orders` tanpa pasangan `portal_product_orders`
- `mkt_rfq_guest_claims` dengan `claim_status='pending'` dan `expires_at < now()` [F20] → set `claim_status='expired'`

**Dashboard:** BizPortal → `/admin/marketplace/reconciliation`

---

## 14. Guest RFQ Claim Mechanism

### 14.1 Flow (9 Langkah)

```
1. Guest submit RFQ → rfq dibuat: guest_token (UUID), email_verified=false
2. Sistem kirim email verifikasi ke buyer_email
3. Guest klik link → email_verified=true → admin bisa invite vendor
4. Guest tracking: GET /marketplace/rfqs/guest/:guest_token
5. Guest register/login dengan email SAMA
6. POST /marketplace/rfqs/claim { rfq_number, guest_token }
7. Sistem validasi: guest_token cocok + email akun == buyer_email + belum diklaim
8. Jika valid → mkt_rfqs.company_id diisi, guest_claimed_at = now()
              → mkt_rfq_guest_claims.claim_status = 'claimed'
9. RFQ muncul di dashboard buyer
```

### 14.2 Edge Cases

| Skenario | Handling |
|---|---|
| Email berbeda saat claim | Reject — email wajib sama |
| Klaim setelah > 7 hari | Token expired → kontak admin |
| RFQ sudah diklaim | Reject — satu RFQ hanya sekali |
| Spam RFQ (email palsu) | Rate limit + email verification wajib |

---

## 15. COA Mapping Marketplace

### 15.1 Setup Wajib Sebelum Go-Live

Admin wajib mengisi 7 setting di BizPortal sebelum flag diaktifkan:

| Setting Key | Nilai | Tipe |
|---|---|---|
| `marketplace.coa_commission_revenue` | COA revenue | FK → COA |
| `marketplace.coa_commission_tax` | COA liability | FK → COA |
| `marketplace.coa_vendor_payable` | COA liability | FK → COA |
| `marketplace.coa_buyer_receivable` | COA asset | FK → COA |
| `marketplace.coa_clearing` | COA asset:cash_bank | FK → COA |
| `marketplace.journal_id` | Journal general | FK → Journal |
| `marketplace.default_commission_tax_id` | Tax | FK → Tax |

### 15.2 Validasi Pre-Go-Live

Sistem block aktivasi flag jika salah satu dari 7 mapping di atas belum diisi atau COA/journal/tax inactive.

---

## 16. Final Risk Register

| ID | Risiko | Likelihood | Impact | Mitigasi |
|---|---|---|---|---|
| R01 | Vendor lihat field komisi | High | High | `VendorQuotePublic` schema, field tidak pernah di-select untuk vendor route |
| R02 | Guest RFQ spam | High | Medium | Rate limit + email verification wajib |
| R03 | Double-invite vendor ke RFQ | Medium | Low | UNIQUE constraint `(rfq_id, vendor_id)` [F14] |
| R04 | ALTER TYPE dalam transaction | Confirmed | High | Session pooler port 5432, luar transaction |
| R05 | Legacy `portal_product_orders` tanpa pasangan | Medium | Medium | Nightly reconciliation job |
| R06 | Hardcode PPN komisi | Medium | Medium | Reuse `accounting_taxes` |
| R07 | COA belum dikonfigurasi → jurnal gagal silent | High | High | Validasi wajib + block go-live |
| R08 | `purchase_documents` FK rusak | Medium | High | FK nullable + `IF NOT EXISTS` |
| R09 | Guest claim RFQ orang lain | Low | High | Token UUID + exact email match |
| R10 | Dual-write race condition | Medium | High | Feature flag kill switch |
| R11 | Free-text status inkonsisten | Confirmed | Medium | Canonical enum 6 tipe |
| R12 | Vendor gaming rank_score | Low | Medium | rank_score tidak pernah expose |
| R13 | `sales_documents` logistic_order_id unique conflict | Low | High | Wajib set NULL saat buat SO untuk marketplace |
| R14 | Order number format overlap | Medium | High | Format berbeda eksplisit [F19]: MKT-RFQ-*, MKT-PO-* |
| R15 | Admin list view lambat tanpa index | High | High | Counter denormalized + 23 index terdefinisi [F01, F08] |
| R16 | Tidak ada audit trail marketplace | High | High | Tabel `mkt_activity_logs` di P0 [F02] |

---

## 17. Phase 1 Readiness Checklist

### Perubahan dari v1.1

Semua 23 temuan dari Architecture Freeze Review sudah diincorporate di v1.2:

- [x] F01 — Index plan lengkap (Section 18)
- [x] F02 — `mkt_activity_logs` ada di P0 (Section 2 + 6.7)
- [x] F03 — Endpoint `POST .../post-journal` ada (Section 9)
- [x] F04 — `GET /catalog` dihapus, referensi ke existing `/products` (Section 9)
- [x] F05 — Zod schemas untuk 5 endpoint kritis (Section 19)
- [x] F06 — Pagination spec di semua list endpoints (Section 9)
- [x] F07 — Auth middleware mapping (Section 20)
- [x] F08 — `line_count` + `quote_count` di `mkt_rfqs` (Section 6.1)
- [x] F09 — Buyer cancel flow (Section 21)
- [x] F10 — Buyer reject all quotes flow + enum `buyer_rejected` (Section 8 + 21)
- [x] F11 — Vendor quote expiry cron mechanism (Section 21)
- [x] F12 — Endpoint `send-reminder` (Section 9)
- [x] F13 — Withdraw via `POST .../withdraw` (Section 9)
- [x] F14 — Double-invite UNIQUE constraint (Section 6.3 + 10.3)
- [x] F15 — `select-winner` menggantikan `approve` (Section 9)
- [x] F16 — RBAC permissions (Section 22)
- [x] F17 — SSE strategy (Section 23)
- [x] F18 — Commission → vendor payment flow (Section 11.5)
- [x] F19 — Order number format eksplisit (Section 5)
- [x] F20 — Guest claims cleanup di nightly job (Section 13.3)
- [x] F21 — OpenAPI decision (Section 21 note)
- [x] F22 — Dashboard widget endpoint (Section 9)
- [x] F23 — `source_id = mkt_purchase_orders.id` (Section 11.2)

### Final Checklist Sebelum Approval Phase 1

#### A. Schema & Naming
- [ ] 7 tabel baru terkonfirmasi (termasuk `mkt_activity_logs`)
- [ ] Kolom `line_count` dan `quote_count` ada di `mkt_rfqs`
- [ ] Kolom `accounting_posted_at` dan `vendor_payment_req_id` ada di `mkt_purchase_orders`
- [ ] UNIQUE constraint `(rfq_id, vendor_id)` ada di `mkt_vendor_quotes`
- [ ] Format order number MKT-RFQ-* dan MKT-PO-* terkonfirmasi

#### B. Tabel Dihapus dari P0
- [ ] `mkt_invoices` tidak ada
- [ ] `mkt_payments` tidak ada

#### C. Security
- [ ] Field internal terdokumentasi INTERNAL ONLY
- [ ] Rate limit guest terdokumentasi
- [ ] Double-invite prevention ada
- [ ] Buyer ownership check terdokumentasi

#### D. Guest RFQ
- [ ] Flow 9 langkah terdokumentasi
- [ ] Edge cases terdokumentasi
- [ ] Cleanup expired claims ada di nightly job

#### E. Accounting
- [ ] Source_id = `mkt_purchase_orders.id` dikonfirmasi
- [ ] COA 7 keys terdokumentasi
- [ ] Vendor payment flow (Section 11.5) terdokumentasi
- [ ] Endpoint post-journal ada di API spec

#### F. Migration
- [ ] 15 DDL steps terdokumentasi dengan benar
- [ ] ALTER TYPE warning terdokumentasi
- [ ] Idempotency terdokumentasi

#### G. Feature Flag
- [ ] Kill switch terdokumentasi
- [ ] Dual-write strategy terdokumentasi
- [ ] Reconciliation job (dengan cleanup guest claims) terdokumentasi

#### H. Index Plan
- [ ] Section 18 berisi semua index untuk 7 tabel baru + 1 existing

#### I. API Contract
- [ ] Semua endpoint ada auth spec
- [ ] Semua list endpoint ada pagination spec
- [ ] Zod schemas untuk 5 endpoint kritis ada
- [ ] Withdraw endpoint menggunakan POST .../withdraw
- [ ] Naming: `select-winner`, bukan `approve`
- [ ] Dashboard stats endpoint ada
- [ ] Catalog endpoints mereference existing, tidak membuat baru

#### J. RBAC & SSE
- [ ] Permission strings terdefinisi (Section 22)
- [ ] SSE strategy terdokumentasi (Section 23)

---

## 18. Complete Index Plan

**[F01]** Index wajib untuk semua tabel marketplace P0.

### `mkt_rfqs`
```sql
CREATE INDEX mkt_rfqs_status_idx          ON mkt_rfqs (status);
CREATE INDEX mkt_rfqs_buyer_email_idx     ON mkt_rfqs (buyer_email);
CREATE UNIQUE INDEX mkt_rfqs_guest_token_uidx ON mkt_rfqs (guest_token)
  WHERE guest_token IS NOT NULL;
CREATE INDEX mkt_rfqs_company_status_idx  ON mkt_rfqs (company_id, status);
CREATE INDEX mkt_rfqs_catalog_vendor_idx  ON mkt_rfqs (catalog_vendor_id)
  WHERE catalog_vendor_id IS NOT NULL;
CREATE INDEX mkt_rfqs_created_at_idx      ON mkt_rfqs (created_at DESC);
```

### `mkt_rfq_lines`
```sql
CREATE INDEX mkt_rfq_lines_rfq_idx           ON mkt_rfq_lines (rfq_id);
CREATE INDEX mkt_rfq_lines_catalog_item_idx  ON mkt_rfq_lines (vendor_catalog_item_id)
  WHERE vendor_catalog_item_id IS NOT NULL;
```

### `mkt_vendor_quotes`
```sql
CREATE UNIQUE INDEX mkt_vendor_quotes_token_uidx     ON mkt_vendor_quotes (token);
CREATE UNIQUE INDEX mkt_vendor_quotes_rfq_vendor_uidx ON mkt_vendor_quotes (rfq_id, vendor_id);
CREATE INDEX mkt_vendor_quotes_rfq_idx               ON mkt_vendor_quotes (rfq_id);
CREATE INDEX mkt_vendor_quotes_vendor_idx            ON mkt_vendor_quotes (vendor_id);
CREATE INDEX mkt_vendor_quotes_status_idx            ON mkt_vendor_quotes (status);
```

### `mkt_vendor_quote_lines`
```sql
CREATE INDEX mkt_vql_quote_idx         ON mkt_vendor_quote_lines (quote_id);
CREATE INDEX mkt_vql_rfqline_idx       ON mkt_vendor_quote_lines (rfq_line_id);
CREATE INDEX mkt_vql_quote_rfqline_idx ON mkt_vendor_quote_lines (quote_id, rfq_line_id);
```

### `mkt_purchase_orders`
```sql
CREATE UNIQUE INDEX mkt_po_number_uidx  ON mkt_purchase_orders (po_number);
CREATE INDEX mkt_po_rfq_idx            ON mkt_purchase_orders (rfq_id);
CREATE INDEX mkt_po_vendor_idx         ON mkt_purchase_orders (vendor_id);
CREATE INDEX mkt_po_status_idx         ON mkt_purchase_orders (status);
CREATE INDEX mkt_po_sales_doc_idx      ON mkt_purchase_orders (sales_document_id)
  WHERE sales_document_id IS NOT NULL;
```

### `mkt_rfq_guest_claims`
```sql
CREATE INDEX mkt_guest_claims_rfq_idx      ON mkt_rfq_guest_claims (rfq_id);
CREATE INDEX mkt_guest_claims_email_idx    ON mkt_rfq_guest_claims (guest_email);
CREATE INDEX mkt_guest_claims_token_idx    ON mkt_rfq_guest_claims (guest_token);
CREATE INDEX mkt_guest_claims_expires_idx  ON mkt_rfq_guest_claims (expires_at)
  WHERE claim_status = 'pending';
```

### `mkt_activity_logs`
```sql
CREATE INDEX mkt_activity_logs_rfq_idx        ON mkt_activity_logs (rfq_id);
CREATE INDEX mkt_activity_logs_entity_idx     ON mkt_activity_logs (entity_type, entity_id);
CREATE INDEX mkt_activity_logs_created_at_idx ON mkt_activity_logs (created_at DESC);
CREATE INDEX mkt_activity_logs_actor_idx      ON mkt_activity_logs (actor_type, actor_id);
```

### `purchase_documents` (Existing — ADD COLUMN)
```sql
CREATE INDEX purchase_docs_mkt_po_idx ON purchase_documents (mkt_purchase_order_id)
  WHERE mkt_purchase_order_id IS NOT NULL;
```

**Total: 27 index** (23 baru di tabel marketplace + 4 unique constraints + 1 di existing `purchase_documents`).

---

## 19. Request Body Zod Schemas

**[F05]** Zod schema untuk 5 endpoint kritis. Ini adalah schema kontrak — implementasi di service layer.

### 19.1 `POST /api/marketplace/rfqs` — Submit RFQ

```typescript
const SubmitRfqSchema = z.object({
  buyer_name:             z.string().min(2).max(200),
  buyer_email:            z.string().email(),
  buyer_phone:            z.string().max(50).optional(),
  buyer_company:          z.string().max(200).optional(),
  required_delivery_date: z.string().date().optional(),          // format: YYYY-MM-DD
  delivery_address:       z.string().max(500).optional(),
  priority:               z.enum(['low','normal','high','urgent']).default('normal'),
  notes:                  z.string().max(1000).optional(),
  catalog_vendor_id:      z.number().int().positive().optional(), // jika dari catalog vendor tertentu
  items: z.array(z.object({
    vendor_catalog_item_id: z.number().int().positive().optional(),
    item_name:              z.string().min(1).max(500),
    item_description:       z.string().max(1000).optional(),
    item_unit:              z.string().max(50).optional(),
    requested_qty:          z.number().positive(),
    target_price_per_unit:  z.number().positive().optional(),
    notes:                  z.string().max(500).optional(),
  })).min(1).max(50),
});
```

### 19.2 `POST /api/marketplace/vendor/quote/:token` — Submit Quote

```typescript
const SubmitVendorQuoteSchema = z.object({
  valid_until:           z.string().datetime().optional(),
  delivery_date_offered: z.string().date().optional(),
  notes:                 z.string().max(1000).optional(),
  attachment_url:        z.string().url().optional(),
  lines: z.array(z.object({
    rfq_line_id:         z.number().int().positive(),
    offered_unit_price:  z.number().positive(),
    offered_qty:         z.number().positive(),
    lead_time_days:      z.number().int().min(0).optional(),
    stock_status:        z.enum(['available','partial','backorder','unavailable'])
                           .default('available'),
    notes:               z.string().max(500).optional(),
  })).min(1),
});
```

### 19.3 `POST /api/marketplace/admin/rfqs/:rfqNumber/invite-vendor` — Invite Vendor

```typescript
const InviteVendorSchema = z.object({
  vendor_id:   z.number().int().positive(),
  message:     z.string().max(1000).optional(),  // pesan custom ke vendor
  valid_until: z.string().datetime().optional(), // deadline respons vendor
});
```

### 19.4 `POST /api/marketplace/rfqs/:rfqNumber/accept` — Buyer Accept Quote

```typescript
const BuyerAcceptQuoteSchema = z.object({
  quote_id: z.number().int().positive(),
  notes:    z.string().max(500).optional(),
});
```

### 19.5 `POST /api/marketplace/admin/purchase-orders/:id/confirm` — Admin Confirm PO

```typescript
const ConfirmPoSchema = z.object({
  notes:              z.string().max(500).optional(),
  create_sales_order: z.boolean().default(true),  // default: buat SO buyer otomatis
  so_due_date:        z.string().date().optional(),
});
```

---

## 20. Auth Middleware Mapping

**[F07]** Peta lengkap endpoint → middleware yang dipakai.

| Endpoint | Middleware | Catatan |
|---|---|---|
| `GET /marketplace/products` | — (none) | Public catalog |
| `GET /marketplace/vendors` | — (none) | Public |
| `GET /marketplace/categories` | — (none) | Public |
| `POST /marketplace/rfqs` | Optional: `requirePortalAuth` | Guest = no auth; registered = bearer |
| `GET /marketplace/rfqs` | `requirePortalAuth` | Ownership check wajib |
| `GET /marketplace/rfqs/:rfqNumber` | `requirePortalAuth` OR token check | Bearer atau guest_token |
| `POST /marketplace/rfqs/:rfqNumber/accept` | `requirePortalAuth` | Ownership check wajib |
| `POST /marketplace/rfqs/:rfqNumber/cancel` | `requirePortalAuth` | Ownership check wajib |
| `POST /marketplace/rfqs/:rfqNumber/reject-all-quotes` | `requirePortalAuth` | Ownership check wajib |
| `GET /marketplace/rfqs/guest/:token` | — (none) | Token sebagai auth |
| `POST /marketplace/rfqs/claim` | `requirePortalAuth` | Wajib login |
| `GET /marketplace/purchase-orders` | `requirePortalAuth` | Ownership check wajib |
| `GET /marketplace/purchase-orders/:poNumber` | `requirePortalAuth` | Ownership check wajib |
| `GET /marketplace/vendor/quote/:token` | — (none) | Token sebagai auth |
| `POST /marketplace/vendor/quote/:token` | — (none) | Token sebagai auth |
| `PUT /marketplace/vendor/quote/:token` | — (none) | Token sebagai auth |
| `POST /marketplace/vendor/quote/:token/withdraw` | — (none) | Token sebagai auth |
| `GET /marketplace/admin/*` | `requireAdmin` | Internal session wajib |
| `POST /marketplace/admin/*` | `requireAdmin` | Internal session wajib |

---

## 21. Edge Case Flows

**[F09, F10, F11]**

### 21.1 Buyer Cancel RFQ Setelah Vendor Diinvite [F09]

```
Kondisi yang diperbolehkan untuk cancel:
  - status: 'draft', 'submitted', 'in_review', 'quoted'
  - status 'accepted' TIDAK BISA dicancel

Jika cancel saat vendor sudah diinvite (ada mkt_vendor_quotes):
  1. Set mkt_rfqs.status = 'cancelled'
  2. Untuk setiap mkt_vendor_quotes yang status 'invited'/'opened'/'submitted':
     - Set status = 'rejected' (bukan 'withdrawn' — ini keputusan buyer)
  3. Kirim notifikasi WA/email ke vendor yang sudah submit quote:
     "RFQ [number] telah dibatalkan oleh buyer."
  4. Log ke mkt_activity_logs: action='buyer_cancelled', meta: { cancelled_quotes_count }
```

### 21.2 Buyer Reject Semua Quote [F10]

```
Kondisi: mkt_rfqs.status = 'quoted' (ada quote masuk, tapi buyer tidak puas)

Flow:
  1. POST /marketplace/rfqs/:rfqNumber/reject-all-quotes { reason? }
  2. Set mkt_rfqs.status = 'buyer_rejected'
  3. Untuk semua mkt_vendor_quotes status 'submitted'/'revised':
     - Set status = 'not_selected'
  4. Admin mendapat notifikasi: "Buyer menolak semua quote untuk RFQ [number]"
  5. Admin bisa:
     a. Invite ulang vendor yang berbeda
     b. Cancel RFQ
     c. Hubungi buyer untuk negosiasi

Jika admin invite ulang vendor setelah 'buyer_rejected':
  - Set mkt_rfqs.status kembali ke 'in_review'
  - Vendor baru bisa submit quote baru
```

### 21.3 Vendor Quote Expiry Mechanism [F11]

**Keputusan:** Expiry diset oleh **cron job nightly** (bukan manual admin, bukan real-time).

```
Cron job nightly — query:
  UPDATE mkt_vendor_quotes
  SET status = 'expired', updated_at = now()
  WHERE status IN ('invited', 'opened')
    AND valid_until IS NOT NULL
    AND valid_until < now();

Setelah update:
  - Log ke mkt_activity_logs per quote yang di-expire
  - Kirim notifikasi ke admin: "X vendor quote expired untuk RFQ [number]"
  - Jika SEMUA vendor quotes untuk satu RFQ expired → set mkt_rfqs.status = 'expired'

Jika `valid_until` NULL → quote tidak pernah auto-expire (admin yang set manual).
```

---

## 22. RBAC Permission Strings

**[F16]** Permission strings baru yang perlu didaftarkan di `custom_roles.permissions` array.

| Permission String | Deskripsi | Siapa yang Butuh |
|---|---|---|
| `marketplace.view` | Bisa lihat list RFQ dan PO di BizPortal | Staff, Sales, Finance |
| `marketplace.admin` | Full access: invite vendor, approve, confirm PO | Marketplace Manager |
| `marketplace.vendor_invite` | Bisa invite vendor ke RFQ | Procurement Staff |
| `marketplace.accounting` | Bisa post jurnal komisi | Finance Staff |
| `marketplace.reconciliation` | Bisa lihat halaman reconciliation | Admin, Finance |

**Aturan:**
- Role `admin` global otomatis punya semua permission di atas.
- Permission ini perlu ditambahkan ke `custom_roles.permissions` JSONB array untuk non-admin staff.
- Ditambahkan ke UI BizPortal RBAC settings sebagai checkbox baru.

---

## 23. SSE / Real-time Strategy

**[F17]** Keputusan: Marketplace menggunakan **SSE (Server-Sent Events)** untuk real-time update, konsisten dengan pola existing di `sseManager.ts` yang sudah dipakai oleh `logisticRfq.ts`.

### Events yang Di-broadcast

| Event Name | Trigger | Penerima |
|---|---|---|
| `mkt:quote_received` | Vendor submit quote | Admin (BizPortal) |
| `mkt:rfq_status_changed` | Status RFQ berubah | Buyer (Portal) + Admin |
| `mkt:po_confirmed` | Admin confirm PO | Buyer (Portal) |
| `mkt:po_cancelled` | Admin/buyer cancel PO | Buyer (Portal) + Admin |
| `mkt:quote_expired` | Cron set quote expired | Admin (BizPortal) |

### Implementasi

Gunakan `broadcastToAdmins()` dan `broadcastToPortal()` dari `sseManager.ts` yang sudah ada.  
Tidak perlu WebSocket baru atau library tambahan.

### Polling Fallback

Jika SSE connection terputus (mobile, slow network), frontend fallback ke polling 30 detik untuk `GET /marketplace/rfqs/:rfqNumber` dan `GET /marketplace/purchase-orders/:poNumber`.

---

## Status Blueprint v1.2

| Item | Status |
|---|---|
| 18 keputusan v1.1 ter-incorporate | ✅ |
| 23 temuan Architecture Freeze Review ter-incorporate | ✅ |
| Tidak ada kode yang ditulis | ✅ |
| Tidak ada migration yang dibuat | ✅ |
| Tidak ada schema yang diubah | ✅ |
| Menunggu approval user sebelum Phase 1 | ⏳ |

**BLUEPRINT v1.2 SIAP UNTUK FINAL APPROVAL.**  
Setelah approval, langkah pertama Phase 1 adalah migration schema sesuai urutan DDL di Section 12.

---

*Enterprise Marketplace Blueprint v1.2 — incorporates v1.1 (18 decisions) + Architecture Freeze Review (23 findings)*
