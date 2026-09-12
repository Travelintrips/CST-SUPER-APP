# Enterprise Marketplace — Blueprint v1.1.1

**Status:** Phase 1C Migration Completed — 2026-07-02
**Versi:** 1.1.1
**Tanggal Revisi:** 2026-07-02
**Berdasarkan:** Blueprint v1.1 + Architecture Freeze Review (24 temuan)
**Aturan:** Tidak ada kode, migration, atau perubahan schema sebelum approval eksplisit dari user.

---

## Changelog v1.1 → v1.1.1

| Item | Perubahan |
|---|---|
| Section 18 | **BARU** — Index Plan Lengkap |
| Section 19 | **BARU** — API Contract (pagination, error envelope, auth mapping, Zod, REST naming) |
| Section 20 | **BARU** — RBAC Permission Matrix |
| Section 21 | **BARU** — Buyer Journey |
| Section 22 | **BARU** — Vendor Journey |
| Section 23 | **BARU** — Admin Journey |
| Section 24 | **BARU** — Commission Flow |
| Section 25 | **BARU** — OpenAPI Readiness |
| Section 26 | **BARU** — Event Flow |
| Section 27 | **BARU** — Dashboard Widget Specification |
| Section 6.1 | Counter `line_count` + `quote_count` ditambahkan ke `mkt_rfqs` |
| Section 7 | FK `mkt_purchase_order_id` di `purchase_documents` dikonfirmasi |
| F02 resolved | Audit trail: REUSE `activity_logs` (extend) bukan tabel baru |
| F24 resolved | Order number: MCT legacy dipertahankan, format baru hanya untuk tabel `mkt_*` |
| F25 resolved | Rate limit: IP-based reuse + email-based counter in DB |
| F26 resolved | `system_settings` (public schema) TIDAK di-reuse — isinya payroll/BPJS, kemungkinan milik modul/app lain. COA mapping marketplace memakai tabel baru khusus `mkt_company_settings`, ditambahkan ke P0 sebagai tabel ke-7. |

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
18. [**Index Plan**](#18-index-plan)
19. [**API Contract**](#19-api-contract)
20. [**RBAC Permission Matrix**](#20-rbac-permission-matrix)
21. [**Buyer Journey**](#21-buyer-journey)
22. [**Vendor Journey**](#22-vendor-journey)
23. [**Admin Journey**](#23-admin-journey)
24. [**Commission Flow**](#24-commission-flow)
25. [**OpenAPI Readiness**](#25-openapi-readiness)
26. [**Event Flow**](#26-event-flow)
27. [**Dashboard Widget Specification**](#27-dashboard-widget-specification)

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
        │    mkt_vendor_quote_lines ←── NEW P0 (quote per line) [KEPUTUSAN #7]
        │
        ▼
   mkt_purchase_orders ←── NEW P0 (buyer confirm → PO dibuat) [KEPUTUSAN #1]
        │
        ├──► purchase_documents     ←── existing (reuse, ditambah nullable FK) [KEPUTUSAN #8]
        └──► sales_documents        ←── existing reuse untuk buyer invoice [KEPUTUSAN #5]

   activity_logs       ←── existing (REUSE + extend) untuk audit trail [F02 resolved]
```

---

## 2. Final Table List P0

**7 tabel baru** dibuat di P0 (sebelumnya 6 — `mkt_company_settings` ditambahkan sebagai hasil resolusi F26). Audit trail mereuse `activity_logs` existing (extend).

| # | Nama Tabel (Final) | Keterangan |
|---|---|---|
| 1 | `mkt_rfqs` | Header RFQ dari buyer (guest atau registered) |
| 2 | `mkt_rfq_lines` | Line items dalam RFQ [KEPUTUSAN #2] |
| 3 | `mkt_vendor_quotes` | Header quote dari satu vendor untuk satu RFQ |
| 4 | `mkt_vendor_quote_lines` | Quote per line item oleh vendor [KEPUTUSAN #7] |
| 5 | `mkt_purchase_orders` | Konfirmasi buyer setelah vendor quote disetujui [KEPUTUSAN #1] |
| 6 | `mkt_rfq_guest_claims` | Mekanisme claim RFQ guest setelah register [KEPUTUSAN #9] |
| 7 | `mkt_company_settings` | **[BARU — F26 resolved]** Config key-value khusus marketplace (COA mapping, journal, default commission tax). Menggantikan rencana reuse `public.system_settings` yang DITOLAK karena isinya payroll/BPJS milik modul lain. |

### Audit Trail: REUSE `activity_logs` [F02 resolved]

Setelah audit seluruh tabel log yang ada di ERP:

| Tabel | Bisa Reuse? | Alasan |
|---|---|---|
| `activity_logs` | ✅ **YA — dengan extension** | Nullable `rfq_id`, `order_id`, actor fields sudah ada. Perlu tambah 3 kolom nullable. |
| `order_audit_logs` | ❌ Tidak | FK `order_id` ke `logistic_orders.id` NOT NULL + CASCADE — hard-coupled ke logistic. |
| `rfq_activity_logs` | ❌ Tidak | Tied semantically ke logistic RFQ, tidak ada flexibility entity_type. |
| `freight_shipment_audit_logs` | ❌ Tidak | Hard FK ke `freight_shipments.id` NOT NULL. |

**Keputusan: EXTEND `activity_logs`** dengan 3 kolom nullable:

```sql
-- Dijalankan saat migration P0, idempotent:
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS mkt_rfq_id integer REFERENCES mkt_rfqs(id) ON DELETE SET NULL;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS mkt_vendor_quote_id integer REFERENCES mkt_vendor_quotes(id) ON DELETE SET NULL;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS mkt_purchase_order_id integer REFERENCES mkt_purchase_orders(id) ON DELETE SET NULL;
```

Dengan ini, semua audit trail marketplace tersimpan di tabel yang sudah mature dan sudah ada monitoring-nya. Tidak ada tabel baru diperlukan.

---

## 3. Tabel Dihapus dari P0

| Tabel Lama | Alasan Dihapus | Digantikan Oleh |
|---|---|---|
| `mkt_pos` | Nama bentrok dengan POS kasir | Diganti `mkt_purchase_orders` [KEPUTUSAN #1] |
| `mkt_invoices` | Duplikasi, terlalu dini | Reuse `sales_documents` (buyer) + `vendor_invoices` (vendor) [KEPUTUSAN #5] |
| `mkt_payments` | Duplikasi, terlalu dini | Reuse `sales_documents.payment_proof_token` flow + `payment_requests` (vendor) [KEPUTUSAN #6] |
| `mkt_activity_logs` | Tidak perlu tabel baru | Extend `activity_logs` existing [F02 resolved] |

---

## 4. Tabel Reuse Existing ERP

| Tabel Existing | Cara Dipakai Marketplace |
|---|---|
| `vendor_catalog_items` | Source item yang di-RFQ. FK dari `mkt_rfq_lines.vendor_catalog_item_id` [KEPUTUSAN #4] |
| `suppliers` | Master vendor. FK dari `mkt_rfqs.catalog_vendor_id` dan `mkt_vendor_quotes.vendor_id` |
| `sales_documents` | Invoice buyer setelah PO confirmed. Buat SO kind=`order` + status tracking existing |
| `purchase_documents` | Internal PO ke vendor setelah quote diterima. Ditambah nullable FK `mkt_purchase_order_id` [KEPUTUSAN #8] |
| `accounting_taxes` | Pajak komisi (PPN/withholding). Tidak hardcode rate [KEPUTUSAN #12] |
| `chart_of_accounts` | COA mapping untuk jurnal komisi marketplace [KEPUTUSAN #13] |
| `accounting_entries` | Jurnal komisi di-post setelah settlement, dengan source baru `marketplace_commission` |
| `accounting_journals` | Journal MARKETPLACE_REVENUE dipakai untuk posting komisi |
| `activity_logs` | Audit trail semua event marketplace (extend 3 kolom nullable) [F02 resolved] |

---

## 5. Final Naming Convention

### Prefix

| Konteks | Prefix | Contoh |
|---|---|---|
| Tabel marketplace baru | `mkt_` | `mkt_rfqs`, `mkt_rfq_lines` |
| Line items / detail tabel | `_lines` (bukan `_items`) | `mkt_rfq_lines`, `mkt_vendor_quote_lines` |
| FK ke vendor asal catalog | `catalog_vendor_id` | `mkt_rfqs.catalog_vendor_id` [KEPUTUSAN #3] |
| FK ke catalog item | `vendor_catalog_item_id` | `mkt_rfq_lines.vendor_catalog_item_id` [KEPUTUSAN #4] |

### Order Number Format [F24 resolved]

| Konteks | Format | Contoh | Keterangan |
|---|---|---|---|
| Legacy `portal_product_orders` | `MCT-YYMMDD-RAND5` | `MCT-260702-45231` | **DIPERTAHANKAN** — jangan diubah |
| `mkt_rfqs.rfq_number` | `MKT-RFQ-YYYYMM-XXXX` | `MKT-RFQ-202607-0001` | Format baru, hanya untuk tabel baru |
| `mkt_purchase_orders.po_number` | `MKT-PO-YYYYMM-XXXX` | `MKT-PO-202607-0001` | Format baru, hanya untuk tabel baru |

**Rule:** Tidak ada perubahan pada fungsi `mkMarketplaceOrderNumber()` di `portal.ts`. Format baru diimplementasikan di service layer marketplace yang baru (belum dibuat).

**Reconciliation Impact:** Query reconciliation job harus menggunakan FK/ID join, bukan format string matching, karena kedua format berbeda secara intentional.

---

## 6. Schema Detail Tabel P0

> **REMINDER:** Ini proposal schema, bukan implementasi. Semua kolom perlu konfirmasi sebelum DDL dijalankan.

### 6.1 `mkt_rfqs` — Header RFQ

```
mkt_rfqs
├── id                    serial PK
├── rfq_number            text UNIQUE NOT NULL          -- format: MKT-RFQ-YYYYMM-XXXX
├── company_id            integer FK → companies(id)    -- NULL = guest
├── catalog_vendor_id     integer FK → suppliers(id)   -- vendor pemilik catalog item awal [KEPUTUSAN #3]
├── buyer_name            text NOT NULL
├── buyer_email           text NOT NULL
├── buyer_phone           text
├── buyer_company         text
├── guest_token           text UNIQUE                   -- token untuk guest tracking [KEPUTUSAN #9]
├── guest_claimed_at      timestamp                     -- kapan guest claim RFQ ini [KEPUTUSAN #9]
├── guest_claimed_by      text                          -- user_id yang claim [KEPUTUSAN #9]
├── status                mkt_rfq_status NOT NULL DEFAULT 'draft'
├── priority              mkt_rfq_priority DEFAULT 'normal'
├── required_delivery_date date
├── delivery_address      text
├── notes                 text
├── email_verified        boolean NOT NULL DEFAULT false [KEPUTUSAN #11]
├── email_verified_at     timestamp
│
│   -- Counter denormalized [F08 resolved]
├── line_count            integer NOT NULL DEFAULT 0    -- update via trigger atau service layer
├── quote_count           integer NOT NULL DEFAULT 0    -- update via service layer
│
├── created_at            timestamp NOT NULL DEFAULT now()
└── updated_at            timestamp NOT NULL DEFAULT now()
```

### 6.2 `mkt_rfq_lines` — Line Item RFQ [KEPUTUSAN #2]

```
mkt_rfq_lines
├── id                      serial PK
├── rfq_id                  integer FK → mkt_rfqs(id) ON DELETE CASCADE NOT NULL
├── vendor_catalog_item_id  integer FK → vendor_catalog_items(id) ON DELETE SET NULL [KEPUTUSAN #4]
├── item_name               text NOT NULL                -- snapshot nama item saat RFQ dibuat
├── item_description        text
├── item_unit               text
├── requested_qty           numeric(12,3) NOT NULL DEFAULT 1
├── target_price_per_unit   numeric(14,2)               -- budget/harga target buyer (opsional)
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
├── vendor_id             integer FK → suppliers(id) NOT NULL
├── token                 text UNIQUE NOT NULL           -- token akses vendor (tanpa login)
├── status                mkt_quote_status NOT NULL DEFAULT 'invited'
├── valid_until           timestamp
├── delivery_date_offered date
├── notes                 text
├── attachment_url        text
│
│   -- INTERNAL FIELDS — WAJIB disembunyikan dari vendor API [KEPUTUSAN #10]
├── commission_rate       numeric(5,3)                   -- % komisi platform (INTERNAL)
├── commission_tax_id     integer FK → accounting_taxes(id) [KEPUTUSAN #12]
├── commission_amount     numeric(14,2)                  -- nominal komisi (INTERNAL)
├── net_vendor_amount     numeric(14,2)                  -- yg dibayar ke vendor (INTERNAL)
├── rank_score            numeric(8,4)                   -- skor ranking algoritma (INTERNAL)
├── rank_badges           jsonb                          -- badge: fastest/cheapest/best (INTERNAL)
│
├── submitted_at          timestamp
├── opened_at             timestamp
├── created_at            timestamp NOT NULL DEFAULT now()
└── updated_at            timestamp NOT NULL DEFAULT now()
```

### 6.4 `mkt_vendor_quote_lines` — Quote Per Line [KEPUTUSAN #7]

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

### 6.5 `mkt_purchase_orders` — PO Buyer [KEPUTUSAN #1]

```
mkt_purchase_orders
├── id                    serial PK
├── po_number             text UNIQUE NOT NULL           -- format: MKT-PO-YYYYMM-XXXX
├── rfq_id                integer FK → mkt_rfqs(id) NOT NULL
├── quote_id              integer FK → mkt_vendor_quotes(id) NOT NULL
├── company_id            integer FK → companies(id)
├── vendor_id             integer FK → suppliers(id) NOT NULL
├── status                mkt_po_status NOT NULL DEFAULT 'pending'
├── total_amount          numeric(14,2) NOT NULL DEFAULT 0
├── tax_amount            numeric(14,2) NOT NULL DEFAULT 0
├── grand_total           numeric(14,2) NOT NULL DEFAULT 0
│
│   -- Link ke ERP documents (dibuat setelah PO confirmed)
├── sales_document_id     integer FK → sales_documents(id)  -- SO untuk buyer
├── confirmed_at          timestamp
├── cancelled_at          timestamp
├── cancel_reason         text
├── journal_posted_at     timestamp                         -- set saat post-journal berhasil
├── created_by            text
├── created_at            timestamp NOT NULL DEFAULT now()
└── updated_at            timestamp NOT NULL DEFAULT now()
```

### 6.6 `mkt_rfq_guest_claims` — Guest Claim Mechanism [KEPUTUSAN #9]

```
mkt_rfq_guest_claims
├── id                    serial PK
├── rfq_id                integer FK → mkt_rfqs(id) ON DELETE CASCADE NOT NULL
├── guest_email           text NOT NULL
├── guest_token           text NOT NULL                  -- token dari mkt_rfqs.guest_token
├── claimed_by_user_id    text                           -- user_id setelah login/register
├── claim_status          mkt_claim_status NOT NULL DEFAULT 'pending'
├── claimed_at            timestamp
├── expires_at            timestamp NOT NULL             -- token claim expired dalam 7 hari
└── created_at            timestamp NOT NULL DEFAULT now()
```

### 6.7 `mkt_company_settings` — Config Marketplace [BARU — F26 resolved]

> Menggantikan rencana reuse `public.system_settings` (DITOLAK — tabel itu milik modul payroll/BPJS, bukan marketplace). Key-value config table khusus marketplace, dipakai untuk COA mapping (Section 15) dan setting operasional lain.

```
mkt_company_settings
├── id                    serial PK
├── company_id            integer FK → companies(id) ON DELETE CASCADE  -- NULL = global default
├── setting_key           text NOT NULL                 -- contoh: 'mkt_coa_commission_revenue'
├── setting_value         jsonb NOT NULL                 -- fleksibel: FK id, angka, string, dll
├── description            text
├── created_at            timestamp NOT NULL DEFAULT now()
└── updated_at            timestamp NOT NULL DEFAULT now()

UNIQUE (company_id, setting_key)   -- satu key per company (atau satu key global jika company_id NULL)
```

**Catatan desain:**
- Tabel ini berdiri sendiri di namespace `mkt_*` — tidak ada dependency ke `public.system_settings`.
- `company_id` nullable memungkinkan default global sekaligus override per-company di masa depan (P1+), tapi P0 hanya memakai baris `company_id IS NULL` (single-tenant COA mapping).
- Semua 7 COA mapping key di Section 15.2 disimpan sebagai baris di tabel ini.

---

## 7. Final FK Matrix

| Dari Tabel | Field FK | → Tabel Target | Field | On Delete |
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
| `mkt_company_settings` | `company_id` | `companies` | `id` | CASCADE |
| **`purchase_documents`** | **`mkt_purchase_order_id`** (ADD COLUMN) | **`mkt_purchase_orders`** | **`id`** | **SET NULL** |
| **`activity_logs`** | **`mkt_rfq_id`** (ADD COLUMN) | **`mkt_rfqs`** | **`id`** | **SET NULL** |
| **`activity_logs`** | **`mkt_vendor_quote_id`** (ADD COLUMN) | **`mkt_vendor_quotes`** | **`id`** | **SET NULL** |
| **`activity_logs`** | **`mkt_purchase_order_id`** (ADD COLUMN) | **`mkt_purchase_orders`** | **`id`** | **SET NULL** |

### Catatan Penting FK

- `purchase_documents.mkt_purchase_order_id` nullable — PD non-marketplace tetap NULL. [KEPUTUSAN #8]
- `sales_documents.logistic_order_id` punya UNIQUE index — aman, PostgreSQL tidak menganggap `NULL = NULL`, banyak SO marketplace dengan `logistic_order_id = NULL` diperbolehkan.
- `accounting_entries` partial UNIQUE index: `(source, source_id) WHERE source <> 'manual'`. Gunakan `mkt_purchase_orders.id` sebagai `source_id` (bukan `mkt_rfqs.id`). [F23 resolved]

---

## 8. Final Enum List

### `mkt_rfq_status`
```
draft           → RFQ baru dibuat, belum dikirim
submitted       → Buyer sudah submit, menunggu vendor response
in_review       → Admin sedang review / vendor-matching berjalan
quoted          → Minimal 1 vendor sudah submit quote
accepted        → Buyer accept salah satu quote
cancelled       → RFQ dibatalkan (buyer atau admin)
expired         → Tidak ada quote dalam batas waktu
```

### `mkt_rfq_priority`
```
low
normal
high
urgent
```

### `mkt_quote_status`
```
invited         → Vendor diundang, belum buka token
opened          → Vendor sudah buka token
submitted       → Vendor sudah submit quote
revised         → Vendor submit revisi quote
withdrawn       → Vendor tarik diri
not_selected    → Quote tidak dipilih (setelah winner ditentukan) [F15 resolved]
accepted        → Quote ini yang dipilih buyer
expired         → Vendor tidak respons dalam batas waktu
```

### `mkt_po_status`
```
pending         → PO dibuat, menunggu konfirmasi internal
confirmed       → PO dikonfirmasi, SO buyer sudah dibuat
in_fulfillment  → Vendor sedang memproses
completed       → Delivery/invoice confirmed
cancelled       → PO dibatalkan
```

### `mkt_stock_status`
```
available       → Stok tersedia penuh
partial         → Stok sebagian tersedia
backorder       → Bisa dipesan, ada lead time lebih panjang
unavailable     → Tidak tersedia
```

### `mkt_claim_status`
```
pending         → Guest submit email, menunggu verifikasi/login
claimed         → RFQ berhasil diklaim oleh user
expired         → Klaim tidak selesai sebelum token expired
failed          → Klaim gagal (email tidak cocok, dll.)
```

### Peringatan DDL Enum [KEPUTUSAN #14]

> ⚠️ `ALTER TYPE <enum_name> ADD VALUE` HARUS dijalankan **di luar transaction block**.
> Gunakan **session pooler (port 5432)**, bukan transaction pooler (6543).
> Urutan DDL wajib ikuti Section 12.

---

## 9. Final API Naming

Endpoint lengkap dengan semantik dan HTTP method yang benar. Lihat Section 19 untuk detail request/response.

### Buyer Endpoints

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| `POST` | `/api/marketplace/rfqs` | None / Portal bearer | Submit RFQ baru |
| `GET` | `/api/marketplace/rfqs` | Portal bearer | List RFQ milik buyer (paginasi) |
| `GET` | `/api/marketplace/rfqs/:rfqNumber` | Portal bearer | Detail RFQ |
| `DELETE` | `/api/marketplace/rfqs/:rfqNumber` | Portal bearer | Cancel RFQ (hanya status draft/submitted/quoted) |
| `GET` | `/api/marketplace/rfqs/guest/:token` | None | Tracking RFQ guest via token |
| `POST` | `/api/marketplace/rfqs/claim` | Portal bearer | Claim guest RFQ setelah login |
| `GET` | `/api/marketplace/purchase-orders` | Portal bearer | List PO buyer (paginasi) |
| `GET` | `/api/marketplace/purchase-orders/:poNumber` | Portal bearer | Detail PO buyer |

### Vendor Endpoints

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| `GET` | `/api/marketplace/vendor/quote/:token` | None (token) | Lihat RFQ yang diinvite |
| `POST` | `/api/marketplace/vendor/quote/:token` | None (token) | Submit quote |
| `PATCH` | `/api/marketplace/vendor/quote/:token` | None (token) | Revisi quote (status submitted → revised) |
| `POST` | `/api/marketplace/vendor/quote/:token/withdraw` | None (token) | Tarik quote [F13 resolved] |

### Admin Endpoints

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| `GET` | `/api/marketplace/admin/rfqs` | Admin | List semua RFQ (paginasi, filter) |
| `GET` | `/api/marketplace/admin/rfqs/:rfqNumber` | Admin | Detail RFQ + semua vendor quotes |
| `POST` | `/api/marketplace/admin/rfqs/:rfqNumber/invite-vendor` | Admin | Invite vendor ke RFQ |
| `POST` | `/api/marketplace/admin/quotes/:id/select-winner` | Admin | Pilih quote winner [F15 resolved] |
| `POST` | `/api/marketplace/admin/quotes/:id/send-reminder` | Admin | Kirim reminder ke vendor [F12 resolved] |
| `GET` | `/api/marketplace/admin/purchase-orders` | Admin | List semua PO (paginasi) |
| `POST` | `/api/marketplace/admin/purchase-orders/:id/confirm` | Admin | Konfirmasi PO → buat SO + PD |
| `POST` | `/api/marketplace/admin/purchase-orders/:id/post-journal` | Admin | Post jurnal komisi ke accounting [F03 resolved] |
| `GET` | `/api/marketplace/admin/reconciliation` | Admin | Report dual-write reconciliation |

---

## 10. Final Security Rules

### Field Internal — DILARANG Keluar via API Vendor [KEPUTUSAN #10]

Field berikut di `mkt_vendor_quotes` **TIDAK BOLEH** ada di response vendor endpoint:
- `commission_rate`
- `commission_amount`
- `net_vendor_amount`
- `rank_score`
- `rank_badges`

Implementasi: Schema response terpisah `VendorQuotePublic` (Zod) yang di-strip dari field internal. Lihat Section 19 untuk definisi schema.

### Rate Limit [F25 resolved]

**IP-based (layer 1):** Reuse `marketplaceSubmitLimiter` yang sudah ada (`5 request / 15 menit per IP`). Berlaku untuk semua endpoint publik marketplace.

**Email-based (layer 2 — tambahan untuk guest RFQ):** Counter di DB tabel `mkt_rfq_guest_claims` atau Redis (jika tersedia). Logic: jika `buyer_email` muncul > 3x dalam 1 jam → reject dengan status 429. Implementasi via service layer, bukan express-rate-limit.

**Double-invite prevention [F14 resolved]:** Sebelum INSERT ke `mkt_vendor_quotes`, cek:
```sql
SELECT id FROM mkt_vendor_quotes
WHERE rfq_id = $1 AND vendor_id = $2 AND status NOT IN ('withdrawn', 'expired')
```
Jika ada → return 409 Conflict.

---

## 11. Final Accounting Rules

### Source Enum Baru

Tambahkan nilai `marketplace_commission` ke enum `accounting_entries.source`. [KEPUTUSAN #13]

> ⚠️ `ALTER TYPE` untuk enum ini harus di luar transaction block — ikuti Section 12.

### accounting_entries untuk Marketplace

```
source          = 'marketplace_commission'
source_id       = mkt_purchase_orders.id   [F23 resolved — bukan mkt_rfqs.id]
company_id      = company dari mkt_purchase_orders
journal_id      = mkt_company_settings['mkt_journal_id']   [F26 resolved — bukan system_settings]
```

### Jurnal Entry Format

```
Saat PO completed + admin klik "Post Journal":

DEBIT:  Receivable Buyer   (mkt_coa_buyer_receivable)   = grand_total
CREDIT: Vendor Payable      (mkt_coa_vendor_payable)    = net_vendor_amount
CREDIT: Commission Revenue  (mkt_coa_commission_revenue) = commission_amount (ex-tax)
CREDIT: Commission Tax      (mkt_coa_commission_tax)     = commission_tax_amount

Dimana:
  commission_amount = grand_total × commission_rate
  commission_tax_amount = commission_amount × tax_rate (dari accounting_taxes)
  net_vendor_amount = grand_total - commission_amount - commission_tax_amount
```

---

## 12. Final Migration Rules

### Prasyarat Sebelum DDL

1. Backup Supabase dilakukan.
2. Koneksi menggunakan **session pooler port 5432** (bukan 6543).
3. Jalankan satu statement per `db.execute()` — pgBouncer tidak support multi-statement.

### Urutan DDL (15 Steps) — updated F26: `mkt_company_settings` ditambahkan sebagai Step 13

```
Step 1:  CREATE TYPE mkt_rfq_status AS ENUM (...)           -- di luar transaction
Step 2:  CREATE TYPE mkt_rfq_priority AS ENUM (...)          -- di luar transaction
Step 3:  CREATE TYPE mkt_quote_status AS ENUM (...)           -- di luar transaction
Step 4:  CREATE TYPE mkt_po_status AS ENUM (...)              -- di luar transaction
Step 5:  CREATE TYPE mkt_stock_status AS ENUM (...)           -- di luar transaction
Step 6:  CREATE TYPE mkt_claim_status AS ENUM (...)           -- di luar transaction
Step 7:  ALTER TYPE accounting_entry_source ADD VALUE 'marketplace_commission'  -- di luar transaction
Step 8:  CREATE TABLE IF NOT EXISTS mkt_rfqs (...)
Step 9:  CREATE TABLE IF NOT EXISTS mkt_rfq_lines (...)
Step 10: CREATE TABLE IF NOT EXISTS mkt_vendor_quotes (...)
Step 11: CREATE TABLE IF NOT EXISTS mkt_vendor_quote_lines (...)
Step 12: CREATE TABLE IF NOT EXISTS mkt_purchase_orders (...)
Step 13: CREATE TABLE IF NOT EXISTS mkt_rfq_guest_claims (...)
Step 14: CREATE TABLE IF NOT EXISTS mkt_company_settings (...)   -- [BARU — F26 resolved]
Step 15: ALTER TABLE purchase_documents ADD COLUMN IF NOT EXISTS mkt_purchase_order_id integer REFERENCES mkt_purchase_orders(id) ON DELETE SET NULL
Step 16: ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS mkt_rfq_id integer REFERENCES mkt_rfqs(id) ON DELETE SET NULL
Step 17: ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS mkt_vendor_quote_id integer REFERENCES mkt_vendor_quotes(id) ON DELETE SET NULL
Step 18: ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS mkt_purchase_order_id integer REFERENCES mkt_purchase_orders(id) ON DELETE SET NULL
-- Index plan: lihat Section 18
```

**Idempotency:** Semua CREATE TABLE menggunakan `IF NOT EXISTS`. Semua ALTER TABLE menggunakan `ADD COLUMN IF NOT EXISTS`. Migration aman dijalankan ulang.

### Rollback Plan

```
DROP TABLE IF EXISTS mkt_rfq_guest_claims;
DROP TABLE IF EXISTS mkt_purchase_orders;
DROP TABLE IF EXISTS mkt_vendor_quote_lines;
DROP TABLE IF EXISTS mkt_vendor_quotes;
DROP TABLE IF EXISTS mkt_rfq_lines;
DROP TABLE IF EXISTS mkt_rfqs;
DROP TABLE IF EXISTS mkt_company_settings;
ALTER TABLE purchase_documents DROP COLUMN IF EXISTS mkt_purchase_order_id;
ALTER TABLE activity_logs DROP COLUMN IF EXISTS mkt_rfq_id;
ALTER TABLE activity_logs DROP COLUMN IF EXISTS mkt_vendor_quote_id;
ALTER TABLE activity_logs DROP COLUMN IF EXISTS mkt_purchase_order_id;
DROP TYPE IF EXISTS mkt_rfq_status;
DROP TYPE IF EXISTS mkt_rfq_priority;
DROP TYPE IF EXISTS mkt_quote_status;
DROP TYPE IF EXISTS mkt_po_status;
DROP TYPE IF EXISTS mkt_stock_status;
DROP TYPE IF EXISTS mkt_claim_status;
-- NOTE: ALTER TYPE ADD VALUE tidak bisa di-rollback — tidak ada DROP VALUE di PostgreSQL.
-- marketplace_commission source value tetap ada di enum tapi tidak dipakai.
```

---

## 13. Feature Flag & Dual-Write

### 13.1 Feature Flag

```
FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE=false
```

**Lokasi:** Environment variable di `.replit` `[userenv.shared]`. Tidak hardcode di kode.

### 13.2 Dual-Write Strategy

Selama flag masih `false`:
1. `portal_product_orders` (legacy) — tetap master, format MCT- dipertahankan
2. `mkt_rfqs` + `mkt_purchase_orders` (baru) — format MKT-RFQ- dan MKT-PO-

**Kegagalan write:**
- Jika write legacy gagal → rollback write baru → return error.
- Jika write baru gagal → log ke `activity_logs` (action: `dual_write_failed`) → TIDAK rollback legacy.

### 13.3 Reconciliation Job

Reconciliation job berjalan nightly. Query berdasarkan FK/ID join — BUKAN string format matching:

```sql
SELECT ppo.order_number, ppo.created_at, ppo.status
FROM portal_product_orders ppo
LEFT JOIN mkt_purchase_orders mpo ON mpo.id = (
  SELECT mpo2.id FROM mkt_purchase_orders mpo2
  JOIN mkt_rfqs mr ON mr.id = mpo2.rfq_id
  WHERE mr.guest_token IS NOT NULL
    AND mr.buyer_email = ppo.customer_email
    AND mpo2.created_at BETWEEN ppo.created_at - interval '5 minutes'
                             AND ppo.created_at + interval '5 minutes'
  LIMIT 1
)
WHERE mpo.id IS NULL
  AND ppo.created_at > <feature_flag_activation_date>
ORDER BY ppo.created_at DESC;
```

**Output:** BizPortal `/admin/marketplace/reconciliation` — count unmatched per side + link ke record.

---

## 14. Guest RFQ Claim Mechanism

### 14.1 Flow Lengkap [KEPUTUSAN #9]

```
1. Guest submit RFQ → rfq dibuat dengan guest_token (UUID) + email_verified=false
2. Sistem kirim email verifikasi ke buyer_email
3. Guest klik link verifikasi → email_verified=true → admin bisa invite vendor
4. Vendor respond → buyer tracking via: GET /marketplace/rfqs/guest/:guest_token
5. Guest memutuskan register/login dengan email SAMA
6. Setelah login: POST /marketplace/rfqs/claim {rfq_number, guest_token}
7. Sistem validasi:
   - guest_token cocok
   - buyer_email == email akun yang login
   - claim belum pernah dilakukan (mkt_rfq_guest_claims.claim_status != 'claimed')
8. Jika valid → mkt_rfqs.company_id diisi dengan company user
             → mkt_rfqs.guest_claimed_at = now()
             → mkt_rfq_guest_claims.claim_status = 'claimed'
9. RFQ sekarang muncul di dashboard buyer yang login
```

### 14.2 Edge Cases

| Skenario | Handling |
|---|---|
| Guest daftar dengan email berbeda | Claim gagal, email harus sama |
| Guest claim setelah > 7 hari | Token expired, perlu kontak admin |
| RFQ sudah diklaim user lain | Reject — satu RFQ hanya bisa diklaim sekali |
| Guest submit RFQ duplikat (email + item sama dalam 1 jam) | Email-based rate limit block [F25 resolved] |

---

## 15. COA Mapping Marketplace

### 15.1 Keputusan F26 — RESOLVED

> ✅ **F26 RESOLVED (2026-07-02)**
>
> Verification query dijalankan terhadap Supabase:
> ```sql
> SELECT table_name, table_schema
> FROM information_schema.tables
> WHERE table_name = 'system_settings';
> ```
> Hasil: `system_settings` **ADA** di schema `public`, tapi isinya adalah kolom payroll/BPJS (`bpjs_jht_employee_rate`, `ptkp_tk0`...`k3`, `kasbon_max_pct`, dll) — kemungkinan besar milik modul/app lain yang berbagi instance Supabase yang sama. Tabel ini **TIDAK** ada di Drizzle schema project ini.
>
> **Keputusan: JANGAN reuse `public.system_settings`.** COA mapping marketplace memakai tabel baru khusus: **`mkt_company_settings`** (lihat Section 6.7), ditambahkan ke Final Table List P0 sebagai tabel ke-7 (Section 2).
>
> Implementasi COA mapping **TIDAK LAGI DIBLOKIR** — storage sudah didefinisikan.

### 15.2 Setup Admin Sebelum Go-Live [KEPUTUSAN #13]

Admin **wajib** menyelesaikan mapping berikut di BizPortal sebelum `FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE = true`. Setiap key disimpan sebagai satu baris di `mkt_company_settings` (`company_id IS NULL` untuk P0):

| Setting Key | Nilai yang Dipilih | Tipe |
|---|---|---|
| `mkt_coa_commission_revenue` | COA dari `chart_of_accounts` (revenue) | FK → COA |
| `mkt_coa_commission_tax` | COA dari `chart_of_accounts` (liability) | FK → COA |
| `mkt_coa_vendor_payable` | COA dari `chart_of_accounts` (liability) | FK → COA |
| `mkt_coa_buyer_receivable` | COA dari `chart_of_accounts` (asset) | FK → COA |
| `mkt_coa_clearing` | COA dari `chart_of_accounts` (asset:cash_bank) | FK → COA |
| `mkt_journal_id` | Journal dari `accounting_journals` | FK → Journal |
| `mkt_default_commission_tax_id` | Tax dari `accounting_taxes` | FK → Tax |

### 15.3 Validasi Pre-Go-Live

Sebelum flag diaktifkan, health check otomatis:
- Semua 7 keys di atas terisi sebagai baris di `mkt_company_settings`
- COA/Journal/Tax yang dipilih masih `is_active = true`
- `mkt_company_settings` sudah dibuat via migration P0 (bagian dari 7 tabel baru)

---

## 16. Final Risk Register

| ID | Risiko | Likelihood | Impact | Mitigasi |
|---|---|---|---|---|
| R01 | Vendor bisa lihat field komisi | High | High | `VendorQuotePublic` Zod schema [KEPUTUSAN #10] |
| R02 | Guest RFQ spam | High | Medium | IP-based + email-based rate limit [F25 resolved] |
| R03 | `mkt_pos` bentrok POS | Confirmed | High | Fixed → `mkt_purchase_orders` [KEPUTUSAN #1] |
| R04 | ALTER TYPE dalam transaction fail | Confirmed | High | Migration warning + session pooler [KEPUTUSAN #14] |
| R05 | Legacy portal_product_orders tanpa pasangan | Medium | Medium | Reconciliation nightly job [KEPUTUSAN #16] |
| R06 | Hardcode PPN | Medium | Medium | Reuse `accounting_taxes` [KEPUTUSAN #12] |
| R07 | COA tidak dikonfigurasi → jurnal gagal silent | High | High | Validasi wajib + block go-live [KEPUTUSAN #13] |
| R08 | PD existing rusak karena FK baru | Medium | High | FK nullable + IF NOT EXISTS [KEPUTUSAN #8] |
| R09 | Guest claim RFQ orang lain | Low | High | Token UUID + email exact match [KEPUTUSAN #9] |
| R10 | Dual-write race condition | Medium | High | Feature flag kill switch [KEPUTUSAN #15] |
| R11 | Enum free-text status inkonsisten | Confirmed | Medium | Canonical enum list enforced [KEPUTUSAN #17] |
| R12 | Vendor gaming rank_score | Low | Medium | rank_score tidak expose ke vendor [KEPUTUSAN #10] |
| R13 | Order number format conflict dual-write | Medium | Medium | Format berbeda intentional + join FK-based [F24 resolved] |
| R14 | Salah reuse `system_settings` milik modul lain → data payroll ter-cross-contaminate | Confirmed (dicegah) | High | Tabel baru khusus `mkt_company_settings`, tidak reuse `public.system_settings` [F26 resolved] |
| R15 | double-invite vendor ke RFQ sama | Medium | Low | Pre-insert check query [F14 resolved] |

---

## 17. Phase 1 Readiness Checklist

### A. Schema & Naming

- [x] `mkt_pos` → `mkt_purchase_orders`
- [x] `mkt_rfq_items` → `mkt_rfq_lines`
- [x] `vendor_id` → `catalog_vendor_id` di `mkt_rfqs`
- [x] `catalog_item_id` → `vendor_catalog_item_id`
- [x] `mkt_vendor_quote_lines` ada di schema dan FK matrix
- [x] `purchase_documents.mkt_purchase_order_id` nullable FK terdokumentasi
- [x] Tidak ada `mkt_rfq_id` di `purchase_documents`
- [x] Counter `line_count` + `quote_count` di `mkt_rfqs`
- [x] `mkt_purchase_orders.journal_posted_at` ditambahkan

### B. Tabel Dihapus dari P0

- [x] `mkt_invoices` tidak ada
- [x] `mkt_payments` tidak ada
- [x] `mkt_activity_logs` tidak ada — diganti extend `activity_logs`
- [x] Reuse `sales_documents` untuk buyer invoice dikonfirmasi
- [x] Reuse `vendor_invoices`/`payment_requests` untuk vendor dikonfirmasi

### C. Security

- [x] Field internal terdokumentasi sebagai INTERNAL ONLY
- [x] `VendorQuotePublic` schema (Zod) disebutkan di Section 19
- [x] Rate limit dual-layer terdokumentasi (IP + email)
- [x] Email verification flow terdokumentasi
- [x] Double-invite prevention terdokumentasi

### D. Guest RFQ

- [x] `mkt_rfq_guest_claims` ada di final table list
- [x] Flow claim 9 langkah terdokumentasi
- [x] Edge cases terdokumentasi

### E. Accounting

- [x] `commission_tax_id` FK ke `accounting_taxes`
- [x] COA mapping 7 keys terdokumentasi
- [x] Validasi pre-go-live COA terdokumentasi
- [x] Jurnal entry format terdokumentasi
- [x] `source_id = mkt_purchase_orders.id` eksplisit
- [x] `system_settings` DB verification — **RESOLVED** (F26): tidak di-reuse, diganti `mkt_company_settings`

### F. Migration Safety

- [x] Migration warning ALTER TYPE terdokumentasi
- [x] Urutan DDL 18 steps terdokumentasi (sebelumnya 14, +1 tabel F26 +3 kolom activity_logs)
- [x] Idempotency rule terdokumentasi
- [x] Rollback plan terdokumentasi

### G. Feature Flag & Dual-Write

- [x] `FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE` terdokumentasi
- [x] Dual-write strategy terdokumentasi
- [x] Reconciliation job query terdokumentasi (FK-based, bukan format-based)
- [x] BizPortal reconciliation page terdokumentasi

### H. Enum Canonical

- [x] Semua enum list final terdokumentasi (6 enum baru)
- [x] `not_selected` ditambahkan ke `mkt_quote_status`
- [x] Tidak ada free-text status

### I. Risk Register

- [x] 15 risiko terdokumentasi dengan mitigasi

### J. Index Plan (Section 18)

- [x] Index plan lengkap terdokumentasi

### K. API Contract (Section 19)

- [x] Pagination spec
- [x] Error envelope spec
- [x] Auth middleware mapping
- [x] Zod schema 5 endpoint kritis
- [x] REST naming final

### L. RBAC (Section 20)

- [x] Permission matrix terdokumentasi

### M. Journey Maps (Section 21–23)

- [x] Buyer journey lengkap dengan edge cases
- [x] Vendor journey lengkap
- [x] Admin journey lengkap

### N. Commission Flow (Section 24)

- [x] Commission calculation terdokumentasi

### O. OpenAPI (Section 25)

- [x] Readiness decision terdokumentasi

### P. Event Flow (Section 26)

- [x] Event catalog terdokumentasi

### Q. Dashboard Widgets (Section 27)

- [x] Widget spec terdokumentasi

---

## 18. Index Plan

**WAJIB dibuat bersamaan dengan DDL tabel di Section 12.**

### `mkt_rfqs`

```sql
CREATE INDEX mkt_rfqs_status_idx         ON mkt_rfqs (status);
CREATE INDEX mkt_rfqs_buyer_email_idx    ON mkt_rfqs (buyer_email);
CREATE UNIQUE INDEX mkt_rfqs_guest_token_uidx ON mkt_rfqs (guest_token) WHERE guest_token IS NOT NULL;
CREATE INDEX mkt_rfqs_company_status_idx ON mkt_rfqs (company_id, status);
CREATE INDEX mkt_rfqs_catalog_vendor_idx ON mkt_rfqs (catalog_vendor_id) WHERE catalog_vendor_id IS NOT NULL;
CREATE INDEX mkt_rfqs_created_at_idx     ON mkt_rfqs (created_at DESC);
CREATE UNIQUE INDEX mkt_rfqs_rfq_number_uidx ON mkt_rfqs (rfq_number);
```

### `mkt_rfq_lines`

```sql
CREATE INDEX mkt_rfq_lines_rfq_idx          ON mkt_rfq_lines (rfq_id);
CREATE INDEX mkt_rfq_lines_sort_idx         ON mkt_rfq_lines (rfq_id, sort_order);
CREATE INDEX mkt_rfq_lines_catalog_item_idx ON mkt_rfq_lines (vendor_catalog_item_id)
  WHERE vendor_catalog_item_id IS NOT NULL;
```

### `mkt_vendor_quotes`

```sql
CREATE UNIQUE INDEX mkt_vendor_quotes_token_uidx     ON mkt_vendor_quotes (token);
CREATE INDEX mkt_vendor_quotes_rfq_idx               ON mkt_vendor_quotes (rfq_id);
CREATE INDEX mkt_vendor_quotes_vendor_idx            ON mkt_vendor_quotes (vendor_id);
CREATE INDEX mkt_vendor_quotes_status_idx            ON mkt_vendor_quotes (status);
CREATE INDEX mkt_vendor_quotes_rfq_vendor_idx        ON mkt_vendor_quotes (rfq_id, vendor_id);
CREATE INDEX mkt_vendor_quotes_submitted_at_idx      ON mkt_vendor_quotes (submitted_at DESC)
  WHERE submitted_at IS NOT NULL;
```

### `mkt_vendor_quote_lines`

```sql
CREATE INDEX mkt_vql_quote_idx         ON mkt_vendor_quote_lines (quote_id);
CREATE INDEX mkt_vql_rfqline_idx       ON mkt_vendor_quote_lines (rfq_line_id);
CREATE INDEX mkt_vql_quote_rfqline_idx ON mkt_vendor_quote_lines (quote_id, rfq_line_id);
```

### `mkt_purchase_orders`

```sql
CREATE UNIQUE INDEX mkt_po_number_uidx     ON mkt_purchase_orders (po_number);
CREATE INDEX mkt_po_rfq_idx               ON mkt_purchase_orders (rfq_id);
CREATE INDEX mkt_po_quote_idx             ON mkt_purchase_orders (quote_id);
CREATE INDEX mkt_po_vendor_status_idx     ON mkt_purchase_orders (vendor_id, status);
CREATE INDEX mkt_po_company_status_idx    ON mkt_purchase_orders (company_id, status);
CREATE INDEX mkt_po_sales_doc_idx         ON mkt_purchase_orders (sales_document_id)
  WHERE sales_document_id IS NOT NULL;
CREATE INDEX mkt_po_created_at_idx        ON mkt_purchase_orders (created_at DESC);
```

### `mkt_rfq_guest_claims`

```sql
CREATE INDEX mkt_guest_claims_rfq_idx     ON mkt_rfq_guest_claims (rfq_id);
CREATE INDEX mkt_guest_claims_email_idx   ON mkt_rfq_guest_claims (guest_email);
CREATE INDEX mkt_guest_claims_token_idx   ON mkt_rfq_guest_claims (guest_token);
CREATE INDEX mkt_guest_claims_expires_idx ON mkt_rfq_guest_claims (expires_at)
  WHERE claim_status = 'pending';
```

### `purchase_documents` (ADD COLUMN + INDEX)

```sql
CREATE INDEX purchase_docs_mkt_po_idx ON purchase_documents (mkt_purchase_order_id)
  WHERE mkt_purchase_order_id IS NOT NULL;
```

### `activity_logs` (ADD COLUMNS + INDEX)

```sql
CREATE INDEX activity_logs_mkt_rfq_idx   ON activity_logs (mkt_rfq_id) WHERE mkt_rfq_id IS NOT NULL;
CREATE INDEX activity_logs_mkt_quote_idx ON activity_logs (mkt_vendor_quote_id) WHERE mkt_vendor_quote_id IS NOT NULL;
CREATE INDEX activity_logs_mkt_po_idx    ON activity_logs (mkt_purchase_order_id) WHERE mkt_purchase_order_id IS NOT NULL;
```

---

## 19. API Contract

### 19.1 Pagination Envelope (Standar)

Semua `GET` list endpoint mengembalikan:

```json
{
  "data": [ ...items ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 123,
    "totalPages": 3
  }
}
```

Query params standar: `?page=1&limit=50`. Default: `page=1`, `limit=50`, `maxLimit=200`.

### 19.2 Error Envelope (Standar)

```json
{
  "error": "VALIDATION_ERROR",
  "message": "buyer_email is required",
  "details": [ { "field": "buyer_email", "issue": "Required" } ]
}
```

| HTTP Code | error code | Kapan |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod parse fail |
| 401 | `UNAUTHORIZED` | Tidak ada auth / token expired |
| 403 | `FORBIDDEN` | Auth ada tapi tidak punya akses |
| 404 | `NOT_FOUND` | Resource tidak ditemukan |
| 409 | `CONFLICT` | Double-invite, duplikat claim, dll. |
| 429 | `RATE_LIMITED` | Melampaui rate limit |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

### 19.3 Auth Middleware Mapping [F07 resolved]

| Endpoint | Middleware | Catatan |
|---|---|---|
| `POST /marketplace/rfqs` | None atau `requirePortalAuth` (optional) | Guest boleh submit tanpa login |
| `GET /marketplace/rfqs` | `requirePortalAuth` | Ownership check: hanya RFQ milik user |
| `GET /marketplace/rfqs/:rfqNumber` | `requirePortalAuth` | Ownership check |
| `DELETE /marketplace/rfqs/:rfqNumber` | `requirePortalAuth` | Ownership check + status guard |
| `GET /marketplace/rfqs/guest/:token` | None | Token sebagai auth |
| `POST /marketplace/rfqs/claim` | `requirePortalAuth` | Wajib login |
| `GET /marketplace/vendor/quote/:token` | None | Token sebagai auth |
| `POST /marketplace/vendor/quote/:token` | None | Token sebagai auth |
| `PATCH /marketplace/vendor/quote/:token` | None | Token sebagai auth |
| `POST /marketplace/vendor/quote/:token/withdraw` | None | Token sebagai auth |
| `GET /marketplace/purchase-orders` | `requirePortalAuth` | Ownership check |
| `GET /marketplace/purchase-orders/:poNumber` | `requirePortalAuth` | Ownership check |
| `GET /marketplace/admin/*` | `requireAdmin` | Internal session |
| `POST /marketplace/admin/*` | `requireAdmin` | Internal session |
| `PATCH /marketplace/admin/*` | `requireAdmin` | Internal session |

### 19.4 Zod Request Body Schemas [F05 resolved]

#### `SubmitRfqSchema` — `POST /marketplace/rfqs`

```typescript
const SubmitRfqSchema = z.object({
  buyer_name:    z.string().min(2).max(100),
  buyer_email:   z.string().email(),
  buyer_phone:   z.string().max(20).optional(),
  buyer_company: z.string().max(100).optional(),
  required_delivery_date: z.string().date().optional(),
  delivery_address: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  items: z.array(z.object({
    vendor_catalog_item_id: z.number().int().positive().optional(),
    item_name:    z.string().min(1).max(200),
    item_unit:    z.string().max(50).optional(),
    requested_qty: z.number().positive().max(99999),
    target_price_per_unit: z.number().positive().optional(),
    notes: z.string().max(500).optional(),
  })).min(1).max(50),
});
```

#### `SubmitVendorQuoteSchema` — `POST /marketplace/vendor/quote/:token`

```typescript
const SubmitVendorQuoteSchema = z.object({
  valid_until: z.string().datetime().optional(),
  delivery_date_offered: z.string().date().optional(),
  notes: z.string().max(1000).optional(),
  attachment_url: z.string().url().optional(),
  lines: z.array(z.object({
    rfq_line_id: z.number().int().positive(),
    vendor_catalog_item_id: z.number().int().positive().optional(),
    offered_unit_price: z.number().positive(),
    offered_qty: z.number().positive(),
    subtotal: z.number().positive(),
    lead_time_days: z.number().int().min(0).optional(),
    stock_status: z.enum(['available','partial','backorder','unavailable']).optional(),
    notes: z.string().max(500).optional(),
  })).min(1),
});
```

#### `InviteVendorSchema` — `POST /marketplace/admin/rfqs/:rfqNumber/invite-vendor`

```typescript
const InviteVendorSchema = z.object({
  vendor_id: z.number().int().positive(),
  commission_rate: z.number().min(0).max(1).optional(), // 0.0 – 1.0
  commission_tax_id: z.number().int().positive().optional(),
});
```

#### `ClaimRfqSchema` — `POST /marketplace/rfqs/claim`

```typescript
const ClaimRfqSchema = z.object({
  rfq_number:  z.string().startsWith('MKT-RFQ-'),
  guest_token: z.string().uuid(),
});
```

#### `ConfirmPoSchema` — `POST /marketplace/admin/purchase-orders/:id/confirm`

```typescript
const ConfirmPoSchema = z.object({
  notes: z.string().max(500).optional(),
  // commission fields bisa di-override di sini sebelum konfirmasi final
  commission_rate: z.number().min(0).max(1).optional(),
});
```

### 19.5 `VendorQuotePublic` Schema — Field Internal Disembunyikan [KEPUTUSAN #10]

```typescript
const VendorQuotePublicSchema = z.object({
  id: z.number(),
  rfq_id: z.number(),
  status: z.enum(['invited','opened','submitted','revised','withdrawn','not_selected','accepted','expired']),
  valid_until: z.string().datetime().nullable(),
  delivery_date_offered: z.string().date().nullable(),
  notes: z.string().nullable(),
  attachment_url: z.string().nullable(),
  submitted_at: z.string().datetime().nullable(),
  // commission_rate        → TIDAK ADA
  // commission_amount      → TIDAK ADA
  // net_vendor_amount      → TIDAK ADA
  // rank_score             → TIDAK ADA
  // rank_badges            → TIDAK ADA
});
```

### 19.6 Buyer Cancel RFQ — Status Guard [F09 resolved]

`DELETE /marketplace/rfqs/:rfqNumber` hanya diperbolehkan jika status adalah `draft`, `submitted`, atau `quoted`.

Jika status `accepted`, `in_fulfillment`, `completed` → return 409 CONFLICT: "RFQ tidak dapat dibatalkan setelah quote diterima."

Jika ada vendor yang sudah submit quote (status `submitted`) saat RFQ dicancel:
- Vendor quote → status `withdrawn` (sistem set otomatis)
- Kirim notifikasi ke vendor yang sudah submit
- Catat di `activity_logs` (action: `rfq_cancelled_by_buyer`)

### 19.7 Buyer Reject All Quotes [F10 resolved]

Endpoint baru: `POST /api/marketplace/rfqs/:rfqNumber/reject-all-quotes`

Status flow:
```
RFQ status: 'quoted' → 'in_review'  (kembali ke review, buyer tidak puas)
Semua quote yang submitted → status tetap, tapi RFQ turun kembali ke in_review
Admin bisa invite vendor baru atau negosiasi ulang
```

Jika buyer ingin cancel total → gunakan `DELETE /marketplace/rfqs/:rfqNumber`.

### 19.8 Vendor Quote Expiry Mechanism [F11 resolved]

**Keputusan: Admin manual untuk P0, cron job untuk P1.**

Di P0:
- Admin bisa manually set status quote → `expired` via `PATCH /marketplace/admin/quotes/:id`
- Field `valid_until` di `mkt_vendor_quotes` dipakai sebagai panduan visual di BizPortal
- Tidak ada auto-expire cron di P0

Di P1:
- Tambahkan cron job yang scan `mkt_vendor_quotes WHERE valid_until < now() AND status NOT IN ('accepted','withdrawn','expired')`
- Set status → `expired` + log ke `activity_logs`

### 19.9 SSE vs Polling [F17 resolved]

**Keputusan: Polling untuk P0.**

Marketplace P0 menggunakan polling standard (client refresh / manual) — tidak ada SSE/WebSocket. BizPortal portal buyer menggunakan TanStack Query refetch interval. Pertimbangkan SSE di P1 jika UX realtime diperlukan untuk "vendor baru submit quote".

---

## 20. RBAC Permission Matrix

### Permission Strings Marketplace [F16 resolved]

| Permission String | Deskripsi |
|---|---|
| `marketplace.view` | Bisa melihat dashboard marketplace, list RFQ, list PO |
| `marketplace.manage_rfq` | Bisa set priority RFQ, move status, assign ke vendor |
| `marketplace.vendor_invite` | Bisa invite vendor ke RFQ |
| `marketplace.select_winner` | Bisa pilih winner quote dan set commission |
| `marketplace.confirm_po` | Bisa konfirmasi PO dan trigger pembuatan SO/PD |
| `marketplace.post_journal` | Bisa post jurnal komisi ke accounting |
| `marketplace.reconciliation` | Bisa akses halaman reconciliation |
| `marketplace.admin` | Super — mencakup semua permission di atas |

### Mapping Role → Permission

| Role | Permissions |
|---|---|
| `admin` (global) | `marketplace.admin` (semua) |
| `finance_manager` | `marketplace.view`, `marketplace.post_journal`, `marketplace.reconciliation` |
| `procurement_staff` | `marketplace.view`, `marketplace.manage_rfq`, `marketplace.vendor_invite` |
| `procurement_manager` | `marketplace.view`, `marketplace.manage_rfq`, `marketplace.vendor_invite`, `marketplace.select_winner`, `marketplace.confirm_po` |
| `portal_buyer` | Hanya akses buyer endpoints (bukan admin) |
| `vendor` | Hanya akses vendor token endpoints (tanpa login) |

### Enforcement

Semua admin marketplace endpoint: check `requireAdmin(req, res)` PLUS check permission string:
```typescript
// Contoh:
if (!hasPermission(req.admin, 'marketplace.vendor_invite')) {
  return res.status(403).json({ error: 'FORBIDDEN', message: 'Butuh permission marketplace.vendor_invite' });
}
```

Permission check menggunakan `rbac.ts` dan `customRoles.ts` yang sudah ada di ERP.

---

## 21. Buyer Journey

### 21.1 Happy Path — Guest Buyer

```
Step 1: BROWSE CATALOG
  ├── Buyer membuka customer portal → halaman marketplace
  ├── Filter/search vendor catalog items
  └── Klik item → lihat detail harga, spesifikasi

Step 2: BUILD RFQ
  ├── Klik "Request for Quote" pada item atau button "Buat RFQ"
  ├── Tambah item satu per satu (dari catalog atau manual entry)
  ├── Set quantity, target harga (opsional), delivery date, alamat
  └── Review: lihat semua item yang di-request sebelum submit

Step 3: SUBMIT RFQ (sebagai guest)
  ├── Isi: nama, email, nomor telepon, nama perusahaan
  ├── Submit → sistem buat mkt_rfqs (status: draft → submitted)
  ├── Sistem kirim email verifikasi ke buyer_email
  ├── Buyer redirect ke halaman konfirmasi:
  │     "RFQ kamu (MKT-RFQ-202607-0001) sudah diterima.
  │      Silakan cek email untuk verifikasi. Estimasi respons 1×24 jam."
  └── guest_token tersimpan di browser (localStorage atau URL param)

Step 4: VERIFIKASI EMAIL
  ├── Buyer klik link di email → endpoint verifikasi
  ├── mkt_rfqs.email_verified = true
  └── Admin baru bisa mulai proses vendor matching

Step 5: TRACKING (sebagai guest)
  ├── Buyer akses: GET /marketplace/rfqs/guest/:token
  ├── Lihat status: "Menunggu vendor" / "Ada 2 quote masuk" / dll.
  └── Buyer tidak perlu login untuk tracking

Step 6: MENERIMA QUOTE
  ├── Buyer terima notifikasi (email/WA) bahwa quote sudah masuk
  ├── Lihat summary quote via tracking page (tanpa login)
  ├── Bandingkan: harga total, lead time, kondisi
  └── Pilih quote yang paling cocok

Step 7: ACCEPT QUOTE
  ├── Buyer klik "Accept Quote" → jika guest, diminta register/login
  ├── Setelah login (dengan email SAMA):
  │     → Sistem tawarkan claim RFQ (POST /marketplace/rfqs/claim)
  │     → RFQ ditransfer ke akun buyer
  ├── POST /marketplace/rfqs/:rfqNumber/accept { quote_id }
  ├── mkt_rfqs.status = 'accepted'
  ├── mkt_vendor_quotes.status = 'accepted' (yang dipilih)
  ├── mkt_vendor_quotes.status = 'not_selected' (yang lain)
  └── Admin diberi notifikasi → PO dibuat

Step 8: TERIMA KONFIRMASI PO
  ├── Admin konfirmasi PO → SO buyer dibuat (sales_documents)
  ├── Buyer terima email/WA: "PO dikonfirmasi, invoice akan dikirim"
  └── Buyer lihat detail PO di dashboard

Step 9: BAYAR INVOICE
  ├── Buyer upload bukti transfer ke SO
  ├── Admin konfirmasi pembayaran
  └── Status SO → paid

Step 10: SELESAI
  └── Buyer terima konfirmasi fulfillment
```

### 21.2 Edge Cases Buyer

| Skenario | Handling |
|---|---|
| Email tidak diverifikasi > 48 jam | Kirim reminder email. Admin tidak bisa invite vendor. |
| Tidak ada quote masuk dalam 5 hari | Notifikasi buyer + admin. RFQ tetap open. |
| Buyer ingin cancel setelah email verified | Bisa cancel jika status ≤ `quoted`. Lihat 19.6. |
| Buyer reject semua quote | POST `/reject-all-quotes`. RFQ kembali ke `in_review`. Lihat 19.7. |
| Buyer ingin ubah items setelah submit | Tidak bisa. Harus cancel dan submit RFQ baru. (P0 rule — no edit after submit) |
| Buyer akses RFQ orang lain | 403 Forbidden — ownership check wajib. |

---

## 22. Vendor Journey

### 22.1 Happy Path — Vendor Respond Quote

```
Step 1: TERIMA UNDANGAN
  ├── Admin invite vendor → WA/email dikirim ke vendor
  ├── Email berisi link: /marketplace/vendor/quote/:token
  └── mkt_vendor_quotes.status = 'invited'

Step 2: BUKA LINK
  ├── GET /marketplace/vendor/quote/:token
  ├── mkt_vendor_quotes.status → 'opened'
  ├── mkt_vendor_quotes.opened_at = now()
  └── Vendor lihat: detail RFQ, list item yang diminta, deadline

Step 3: SIAPKAN QUOTE
  ├── Per line item (mkt_rfq_lines):
  │     - Masukkan harga per unit
  │     - Qty yang bisa disupply
  │     - Lead time (hari)
  │     - Stock status (available/partial/backorder/unavailable)
  │     - Notes per item (opsional)
  ├── Upload attachment (spec sheet, foto produk) — opsional
  ├── Set delivery date yang bisa dipenuhi
  └── Review total sebelum submit

Step 4: SUBMIT QUOTE
  ├── POST /marketplace/vendor/quote/:token
  ├── mkt_vendor_quote_lines dibuat (satu per rfq_line)
  ├── mkt_vendor_quotes.status = 'submitted'
  ├── mkt_vendor_quotes.submitted_at = now()
  ├── mkt_rfqs.quote_count + 1 (update service layer)
  └── Admin & buyer (jika registered) terima notifikasi

Step 5: REVISI (jika diperlukan)
  ├── Admin/buyer minta revisi → vendor terima notifikasi
  ├── PATCH /marketplace/vendor/quote/:token
  ├── mkt_vendor_quotes.status = 'revised'
  └── Admin notified

Step 6: HASIL
  ├── Quote diterima → mkt_vendor_quotes.status = 'accepted'
  │     → Vendor terima notifikasi: "Quote Anda dipilih"
  │     → Vendor siap-siap untuk fulfillment (via purchase_documents)
  ├── Quote tidak dipilih → status = 'not_selected'
  │     → Vendor terima notifikasi: "Terima kasih atas quote Anda"
  └── Quote expired → status = 'expired' (set admin di P0)
```

### 22.2 Field yang TIDAK Terlihat Vendor

Vendor **tidak pernah** melihat:
- Commission rate, commission amount, net vendor amount
- Rank score, rank badges
- Quote dari vendor lain
- Internal admin notes

Endpoint vendor hanya return `VendorQuotePublic` schema. Lihat Section 19.5.

### 22.3 Edge Cases Vendor

| Skenario | Handling |
|---|---|
| Token expired (valid_until terlewat) | Endpoint return 403 "Token sudah expired". Vendor harus kontak admin. |
| Vendor submit quote parsial (tidak semua line) | Diperbolehkan. Lines yang tidak diisi dianggap tidak tersedia. |
| Vendor tarik quote setelah submit | POST `/withdraw`. Status → `withdrawn`. Tidak bisa un-withdraw. |
| Vendor submit revisi setelah accepted | Tidak diperbolehkan. Status `accepted` adalah final. |
| Vendor akses token milik vendor lain | Token adalah UUID — probabilitas guess sangat rendah. Tetap return 404 jika vendor_id tidak match. |

---

## 23. Admin Journey

### 23.1 Setup Sebelum Go-Live (One-Time)

```
Step 0: PREREQUISITE CHECK
  ├── Verify mkt_company_settings sudah dibuat via migration P0 (F26 resolved)
  ├── Setup COA mapping 7 keys di mkt_company_settings (Section 15)
  ├── Verify FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE = false
  └── Assign RBAC permissions ke role yang relevan (Section 20)
```

### 23.2 Operasional Harian

```
Step 1: PANTAU RFQ MASUK
  ├── Dashboard widget: "X RFQ baru" (lihat Section 27)
  ├── GET /marketplace/admin/rfqs?status=submitted
  └── BizPortal menu: Marketplace → RFQ Management

Step 2: REVIEW RFQ
  ├── GET /marketplace/admin/rfqs/:rfqNumber
  ├── Lihat: buyer info, items, target harga, delivery date
  ├── Verifikasi email_verified = true (jika false → tunggu/kirim reminder)
  └── Tentukan: vendor mana yang cocok untuk invite

Step 3: INVITE VENDOR
  ├── POST /marketplace/admin/rfqs/:rfqNumber/invite-vendor { vendor_id, commission_rate }
  ├── Sistem buat mkt_vendor_quotes (token unik, status: invited)
  ├── WA + Email dikirim ke vendor otomatis
  ├── mkt_rfqs.status → 'in_review'
  ├── Double-invite check otomatis (409 jika vendor sudah diinvite)
  └── Bisa invite lebih dari satu vendor ke RFQ yang sama

Step 4: MONITOR RESPONSE VENDOR
  ├── GET /marketplace/admin/rfqs/:rfqNumber (lihat semua vendor status)
  ├── Status: invited → opened → submitted / withdrawn / expired
  ├── Jika vendor belum respons: POST /admin/quotes/:id/send-reminder
  └── Jika deadline lewat: set manual → expired (P0)

Step 5: COMPARE QUOTES
  ├── Lihat semua quote yang masuk per line item
  ├── Lihat: harga total, lead time, stock status, rank_badges (INTERNAL)
  ├── Set commission_rate jika belum di-set saat invite
  └── commission_amount = grand_total × commission_rate dihitung otomatis

Step 6: PILIH WINNER
  ├── POST /marketplace/admin/quotes/:id/select-winner
  ├── Quote winner: status → 'accepted'
  ├── Quote lain: status → 'not_selected'
  ├── mkt_rfqs.status → 'accepted'
  └── Notifikasi ke vendor winner + vendor tidak terpilih

Step 7: KONFIRMASI PO
  ├── Review mkt_purchase_orders (status: pending)
  ├── POST /marketplace/admin/purchase-orders/:id/confirm
  ├── Sistem otomatis buat: sales_documents (SO kind=order untuk buyer)
  ├── Sistem otomatis buat: purchase_documents (PD untuk vendor, mkt_purchase_order_id terisi)
  ├── mkt_purchase_orders.status → 'confirmed'
  └── Notifikasi buyer (invoice akan dikirim) + vendor (PO confirmed, siap fulfillment)

Step 8: TRACK PEMBAYARAN BUYER
  ├── Monitor sales_documents.payment_status
  ├── Konfirmasi bukti bayar yang diupload buyer
  └── Update payment status di SO

Step 9: TRACK VENDOR FULFILLMENT
  ├── Monitor purchase_documents.receive_status
  ├── Konfirmasi receipt dari vendor
  └── mkt_purchase_orders.status: 'in_fulfillment' → 'completed'

Step 10: POST JURNAL KOMISI
  ├── Setelah PO completed, admin klik "Post Journal" di BizPortal
  ├── POST /marketplace/admin/purchase-orders/:id/post-journal
  ├── Sistem validasi: semua 7 COA mapping terisi dan aktif
  ├── Sistem buat accounting_entries (source: marketplace_commission, source_id: mkt_purchase_orders.id)
  ├── mkt_purchase_orders.journal_posted_at = now()
  └── Log ke activity_logs (action: journal_posted)

Step 11: REKONSILIASI (nightly / on-demand)
  ├── GET /marketplace/admin/reconciliation
  ├── Cek portal_product_orders tanpa pasangan mkt_*
  └── Manual fix jika gap ditemukan
```

### 23.3 Edge Cases Admin

| Skenario | Handling |
|---|---|
| Post journal sebelum PO completed | Block — return 422 "PO belum completed" |
| COA mapping tidak lengkap saat post journal | Block — return 422 dengan field yang kurang |
| Post journal sudah pernah dijalankan | Block — return 409 "Journal sudah diposting" (cek journal_posted_at IS NOT NULL) |
| Vendor tidak ada yang mau merespons | Admin bisa cancel RFQ atau cari vendor baru di luar sistem |

---

## 24. Commission Flow

### 24.1 Lifecycle Komisi

```
1. INVITE VENDOR
   Admin set commission_rate saat invite (opsional, bisa di-set nanti)
   Default: ambil dari mkt_company_settings['mkt_default_commission_rate'] jika ada [F26 resolved]

2. QUOTE DITERIMA
   Admin review commission_rate di quote winner sebelum select-winner
   Bisa override commission_rate saat POST /admin/quotes/:id/select-winner

3. SELECT WINNER
   commission_amount = sum(mkt_vendor_quote_lines.subtotal) × commission_rate
   commission_tax_amount = commission_amount × tax_rate (dari accounting_taxes[commission_tax_id].rate)
   net_vendor_amount = grand_total - commission_amount - commission_tax_amount
   Semua disimpan di mkt_vendor_quotes (INTERNAL, tidak expose ke vendor)

4. CONFIRM PO
   mkt_purchase_orders dibuat:
   total_amount = sum(quote_lines.subtotal)
   tax_amount = (pajak PPN buyer jika applicable, bukan pajak komisi)
   grand_total = total_amount + tax_amount

5. POST JOURNAL (manual, setelah PO completed)
   DEBIT:  mkt_coa_buyer_receivable   = mkt_purchase_orders.grand_total
   CREDIT: mkt_coa_vendor_payable     = net_vendor_amount
   CREDIT: mkt_coa_commission_revenue = commission_amount (ex-tax)
   CREDIT: mkt_coa_commission_tax     = commission_tax_amount

6. VENDOR PAYMENT
   Admin buat payment_requests (existing flow) dengan amount = net_vendor_amount
   payment_requests.reference_id atau notes mencantumkan mkt_purchase_orders.po_number
   Bukan otomatis — manual approval di P0
```

### 24.2 Contoh Numerik

```
Buyer order: 100 unit × Rp 50.000 = Rp 5.000.000 (grand_total)
Commission rate: 5% = Rp 250.000
Commission tax (PPN 11%): Rp 250.000 × 11% = Rp 27.500
Net vendor amount: Rp 5.000.000 - Rp 250.000 - Rp 27.500 = Rp 4.722.500

Jurnal:
  DEBIT  Receivable Buyer       5.000.000
  CREDIT Vendor Payable         4.722.500
  CREDIT Commission Revenue       250.000
  CREDIT Commission Tax Payable    27.500
```

---

## 25. OpenAPI Readiness

### 25.1 Keputusan [F21 resolved]

**Marketplace P0 TIDAK masuk `openapi.yaml` dan Orval codegen pada tahap implementasi awal.**

**Alasan:**
- Marketplace menggunakan 3-tier auth (guest / vendor token / portal bearer / admin) yang tidak fit ke pattern codegen Orval saat ini yang mengasumsikan satu auth header.
- Vendor token endpoint (no-auth pattern) memerlukan special handling di Orval yang belum dikonfigurasi.
- BizPortal (internal) menggunakan native fetch + Supabase bearer — tidak memakai Orval hooks.
- Customer portal buyer menggunakan `requirePortalAuth` — bisa masuk Orval di iterasi berikutnya.

**Roadmap OpenAPI:**
- P0: Endpoint langsung diimplementasikan di `portal.ts` (vendor+buyer) dan route baru `marketplace.ts` (admin), tanpa codegen.
- P1: Setelah P0 stable, tambahkan marketplace buyer endpoints ke `openapi.yaml` + run codegen.
- P2: Tambahkan admin endpoints ke `openapi.yaml` jika diperlukan.

### 25.2 Implikasi

- Frontend customer portal buyer **tidak** pakai generated hooks di P0 — gunakan fetch langsung dengan `requirePortalAuth` pattern yang sudah ada di `portal.ts`.
- BizPortal admin marketplace **tidak** pakai generated hooks — gunakan native fetch dengan `credentials: 'include'`.
- Type safety: definisikan TypeScript interface manual untuk marketplace types di P0, sinkronkan ke Orval di P1.

---

## 26. Event Flow

### 26.1 Event Catalog Marketplace

Semua event dicatat ke `activity_logs` dengan kolom `mkt_rfq_id`, `mkt_vendor_quote_id`, atau `mkt_purchase_order_id` sesuai konteks.

| Event (action) | Trigger | actor_type | Notifikasi |
|---|---|---|---|
| `rfq_created` | Buyer submit RFQ | `buyer` | — |
| `rfq_email_verified` | Buyer klik verifikasi email | `buyer` | Admin notif |
| `rfq_claimed` | Guest buyer klaim RFQ setelah login | `buyer` | — |
| `vendor_invited` | Admin invite vendor | `admin` | WA + Email → Vendor |
| `vendor_quote_opened` | Vendor buka token link | `vendor` | Admin notif |
| `vendor_quote_submitted` | Vendor submit quote | `vendor` | Admin notif + Buyer notif (jika registered) |
| `vendor_quote_revised` | Vendor revisi quote | `vendor` | Admin notif |
| `vendor_quote_withdrawn` | Vendor tarik quote | `vendor` | Admin notif |
| `vendor_reminder_sent` | Admin kirim reminder ke vendor | `admin` | WA/Email → Vendor |
| `quote_winner_selected` | Admin pilih winner | `admin` | WA/Email → Vendor winner + losers |
| `rfq_cancelled_by_buyer` | Buyer cancel RFQ | `buyer` | Vendor yang sudah submit → notif |
| `rfq_all_quotes_rejected` | Buyer reject all quotes | `buyer` | Admin notif |
| `po_created` | PO dibuat (auto saat winner selected) | `system` | — |
| `po_confirmed` | Admin konfirmasi PO | `admin` | Email → Buyer + Vendor |
| `po_journal_posted` | Admin post jurnal komisi | `admin` | — |
| `dual_write_failed` | Dual-write ke mkt_* gagal | `system` | Admin alert (log severity: error) |
| `guest_claim_expired` | Cleanup job expire claim | `system` | — |

### 26.2 Notification Routing

| Event | Channel | Template Key |
|---|---|---|
| `vendor_invited` | WA + Email | `mkt_vendor_invite` |
| `vendor_quote_submitted` | WA (admin) + Email (buyer) | `mkt_quote_received` |
| `vendor_reminder_sent` | WA + Email | `mkt_vendor_reminder` |
| `quote_winner_selected` (winner) | WA + Email | `mkt_quote_accepted` |
| `quote_winner_selected` (losers) | Email | `mkt_quote_not_selected` |
| `po_confirmed` | Email (buyer + vendor) | `mkt_po_confirmed` |

Semua template key ditambahkan ke `waTemplateConfigs` table (existing). Definisi konten template dibuat saat implementasi — bukan bagian dari blueprint schema.

---

## 27. Dashboard Widget Specification

### 27.1 BizPortal — Marketplace Dashboard Widgets

| Widget ID | Judul | Query Utama | Update Frequency |
|---|---|---|---|
| `mkt_w01` | RFQ Baru (Hari Ini) | `COUNT(*) FROM mkt_rfqs WHERE DATE(created_at) = CURRENT_DATE` | Realtime (polling 60s) |
| `mkt_w02` | RFQ Menunggu Vendor | `COUNT(*) FROM mkt_rfqs WHERE status = 'submitted'` | Polling 60s |
| `mkt_w03` | RFQ Aktif (In Review) | `COUNT(*) FROM mkt_rfqs WHERE status = 'in_review'` | Polling 60s |
| `mkt_w04` | PO Pending Konfirmasi | `COUNT(*) FROM mkt_purchase_orders WHERE status = 'pending'` | Polling 60s |
| `mkt_w05` | Komisi Bulan Ini | `SUM(commission_amount) FROM mkt_vendor_quotes WHERE status='accepted' AND DATE_TRUNC('month', updated_at) = DATE_TRUNC('month', now())` | Polling 300s |
| `mkt_w06` | Vendor Belum Respons | `COUNT(*) FROM mkt_vendor_quotes WHERE status IN ('invited','opened') AND valid_until < now() + interval '2 days'` | Polling 300s |
| `mkt_w07` | Reconciliation Alert | Count dari query reconciliation job | Daily |

### 27.2 Widget Layout di BizPortal

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ RFQ Baru     │ Menunggu     │ In Review    │ PO Pending   │
│ mkt_w01      │ Vendor       │ mkt_w03      │ mkt_w04      │
│              │ mkt_w02      │              │              │
└──────────────┴──────────────┴──────────────┴──────────────┘
┌──────────────────────────┬───────────────┬────────────────┐
│ Komisi Bulan Ini         │ Vendor Alert  │ Recon Alert    │
│ mkt_w05                  │ mkt_w06       │ mkt_w07        │
└──────────────────────────┴───────────────┴────────────────┘
```

### 27.3 Existing Dashboard `dashboard.ts` Integration

Tambahkan ke existing dashboard endpoint:
```typescript
// Tambah ke GET /api/dashboard/stats response:
marketplace: {
  rfq_new_today:         number,  // mkt_w01
  rfq_awaiting_vendor:   number,  // mkt_w02
  rfq_in_review:         number,  // mkt_w03
  po_pending_confirm:    number,  // mkt_w04
  commission_this_month: number,  // mkt_w05
  vendor_no_response:    number,  // mkt_w06
}
```

---

## Status Blueprint

| Item | Status |
|---|---|
| Semua 18+ keputusan ter-incorporate | ✅ |
| 24 temuan Architecture Freeze Review ter-address | ✅ (24 resolved — F26 resolved 2026-07-02) |
| Index plan lengkap | ✅ |
| API Contract lengkap | ✅ |
| RBAC permission matrix | ✅ |
| Journey maps (Buyer + Vendor + Admin) | ✅ |
| Commission flow | ✅ |
| OpenAPI readiness decision | ✅ |
| Event flow + notification routing | ✅ |
| Dashboard widget spec | ✅ |
| Tidak ada kode yang ditulis | ✅ |
| Tidak ada migration yang dibuat | ✅ |
| Tidak ada schema yang diubah | ✅ |
| `system_settings` DB verification | ✅ RESOLVED (F26, 2026-07-02) — tidak di-reuse, diganti `mkt_company_settings` |
| P0 table count | **7 tabel** (`mkt_rfqs`, `mkt_rfq_lines`, `mkt_vendor_quotes`, `mkt_vendor_quote_lines`, `mkt_purchase_orders`, `mkt_rfq_guest_claims`, `mkt_company_settings`) |
| Menunggu approval user sebelum Phase 1 | ⏳ |

---

*Enterprise Marketplace Blueprint v1.1.1 — revisi berdasarkan Architecture Freeze Review*
*Dari v1.1 + 10 section baru + resolusi 23 temuan*
