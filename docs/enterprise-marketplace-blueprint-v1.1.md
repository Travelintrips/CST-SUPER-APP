# Enterprise Marketplace — Revised Blueprint v1.1

**Status:** DRAFT — AWAITING USER APPROVAL BEFORE ANY IMPLEMENTATION  
**Versi:** 1.1  
**Tanggal Revisi:** 2026-07-01  
**Berdasarkan:** Design Validation Report (18 temuan kritis)  
**Aturan:** Tidak ada kode, migration, atau perubahan schema sebelum approval eksplisit dari user.

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
```

---

## 2. Final Table List P0

Hanya 6 tabel baru yang dibuat di P0. Semua invoice dan payment mereuse existing.

| # | Nama Tabel (Final) | Keterangan |
|---|---|---|
| 1 | `mkt_rfqs` | Header RFQ dari buyer (guest atau registered) |
| 2 | `mkt_rfq_lines` | Line items dalam RFQ [KEPUTUSAN #2] |
| 3 | `mkt_vendor_quotes` | Header quote dari satu vendor untuk satu RFQ |
| 4 | `mkt_vendor_quote_lines` | Quote per line item oleh vendor [KEPUTUSAN #7] |
| 5 | `mkt_purchase_orders` | Konfirmasi buyer setelah vendor quote disetujui [KEPUTUSAN #1] |
| 6 | `mkt_rfq_guest_claims` | Mekanisme claim RFQ guest setelah register [KEPUTUSAN #9] |

---

## 3. Tabel Dihapus dari P0

Berikut tabel yang **ADA** di blueprint draft lama, tapi **dihapus** dari P0:

| Tabel Lama | Alasan Dihapus | Digantikan Oleh |
|---|---|---|
| `mkt_pos` | Nama bentrok dengan POS kasir | Diganti `mkt_purchase_orders` [KEPUTUSAN #1] |
| `mkt_invoices` | Duplikasi, terlalu dini | Reuse `sales_documents` (buyer) + `vendor_invoices` (vendor) [KEPUTUSAN #5] |
| `mkt_payments` | Duplikasi, terlalu dini | Reuse `sales_documents.payment_proof_token` flow + `payment_requests` (vendor) [KEPUTUSAN #6] |

**Total penghematan:** 3 tabel dihapus dari P0 → kompleksitas berkurang signifikan.

---

## 4. Tabel Reuse Existing ERP

Tabel-tabel ini **tidak dimodifikasi schema-nya**, hanya ditambah nullable FK atau dipakai via join.

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

---

## 5. Final Naming Convention

### Prefix

| Konteks | Prefix | Contoh |
|---|---|---|
| Tabel marketplace baru | `mkt_` | `mkt_rfqs`, `mkt_rfq_lines` |
| Line items / detail tabel | `_lines` (bukan `_items`) | `mkt_rfq_lines`, `mkt_vendor_quote_lines` |
| FK ke vendor asal catalog | `catalog_vendor_id` | `mkt_rfqs.catalog_vendor_id` [KEPUTUSAN #3] |
| FK ke catalog item | `vendor_catalog_item_id` | `mkt_rfq_lines.vendor_catalog_item_id` [KEPUTUSAN #4] |

### Aturan Penamaan Field

| Pola | Benar | Salah |
|---|---|---|
| Vendor yang punya catalog item di RFQ | `catalog_vendor_id` | `vendor_id` (ambigu) |
| Vendor yang respond quote | `vendor_id` di `mkt_vendor_quotes` | - |
| FK ke mkt_purchase_orders dari purchase_documents | `mkt_purchase_order_id` (nullable) | `mkt_rfq_id` |
| Item di catalog vendor | `vendor_catalog_item_id` | `catalog_item_id` |
| Komisi platform | `commission_rate`, `commission_amount`, `net_vendor_amount` | - |
| Score ranking vendor | `rank_score`, `rank_badges` | - |

### Konvensi Status Field

Semua status field menggunakan `text` dengan enum tersendiri (lihat [Section 8](#8-final-enum-list)). Tidak ada free-text status.

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
├── created_at            timestamp NOT NULL DEFAULT now()
```

---

## 7. Final FK Matrix

Tabel di bawah ini adalah **semua foreign key** yang ada di P0, termasuk ke tabel existing.

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
| **`purchase_documents`** | **`mkt_purchase_order_id`** (ADD COLUMN) | **`mkt_purchase_orders`** | **`id`** | **SET NULL** |

### Catatan Penting FK

- `purchase_documents.mkt_purchase_order_id` adalah **nullable** — PD yang tidak berasal dari marketplace tetap NULL. [KEPUTUSAN #8]
- Tidak ada `mkt_rfq_id` di `purchase_documents` — hanya FK ke `mkt_purchase_orders`. [KEPUTUSAN #8]
- `vendor_invoices` dan `payment_requests` dipakai tanpa modifikasi schema — hanya join via `mkt_purchase_orders.id`.

---

## 8. Final Enum List

Semua status menggunakan enum PostgreSQL. **Tidak ada free-text status.** [KEPUTUSAN #17]

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
rejected        → Admin/buyer reject quote vendor ini
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

> ⚠️ **MIGRATION WARNING — WAJIB DIBACA SEBELUM ALTER TYPE**
>
> `ALTER TYPE <enum_name> ADD VALUE` di PostgreSQL **harus dijalankan di luar transaction block**.
> Jika dijalankan dalam transaction (misal dengan Drizzle migration runner default), akan error:
> `ERROR: cannot add enum label "xxx" to an uncommitted enum type`
>
> **Solusi:** Semua `CREATE TYPE` untuk enum marketplace baru harus:
> 1. Dijalankan sebagai DDL standalone (`db.execute(sql\`...\`)`) dengan koneksi session pooler port 5432 (bukan 6543).
> 2. Atau gunakan `ALTER TYPE ... ADD VALUE IF NOT EXISTS` di luar transaction.
> 3. Setiap enum di-CREATE sebelum CREATE TABLE yang menggunakannya, satu statement per db.execute().

---

## 9. Final API Naming

### Base Path
```
/api/marketplace/
```

### Buyer-Facing Endpoints

| Method | Path | Deskripsi |
|---|---|---|
| `POST` | `/api/marketplace/rfqs` | Submit RFQ baru (guest atau authenticated) |
| `GET` | `/api/marketplace/rfqs` | List RFQ milik buyer (auth required) |
| `GET` | `/api/marketplace/rfqs/:rfqNumber` | Detail RFQ + quotes |
| `POST` | `/api/marketplace/rfqs/:rfqNumber/accept` | Accept quote vendor |
| `DELETE` | `/api/marketplace/rfqs/:rfqNumber` | Cancel RFQ |
| `GET` | `/api/marketplace/rfqs/guest/:token` | Tracking RFQ sebagai guest |
| `POST` | `/api/marketplace/rfqs/claim` | Claim guest RFQ setelah register [KEPUTUSAN #9] |
| `GET` | `/api/marketplace/purchase-orders` | List PO buyer |
| `GET` | `/api/marketplace/purchase-orders/:poNumber` | Detail PO |
| `GET` | `/api/marketplace/catalog` | Browse vendor catalog items |
| `GET` | `/api/marketplace/catalog/:id` | Detail catalog item |

### Vendor-Facing Endpoints (token-based, no login required)

| Method | Path | Deskripsi |
|---|---|---|
| `GET` | `/api/marketplace/vendor/quote/:token` | Buka RFQ invitation + lihat lines |
| `POST` | `/api/marketplace/vendor/quote/:token` | Submit quote + quote lines |
| `PUT` | `/api/marketplace/vendor/quote/:token` | Revisi quote |
| `DELETE` | `/api/marketplace/vendor/quote/:token` | Withdraw quote |

> **PENTING:** Response dari vendor endpoints **WAJIB mengecualikan** field-field berikut: `commission_rate`, `commission_amount`, `net_vendor_amount`, `rank_score`, `rank_badges`. [KEPUTUSAN #10]

### Admin/Internal Endpoints (staff session required)

| Method | Path | Deskripsi |
|---|---|---|
| `GET` | `/api/marketplace/admin/rfqs` | List semua RFQ + filter |
| `GET` | `/api/marketplace/admin/rfqs/:rfqNumber` | Detail RFQ lengkap (termasuk field internal) |
| `POST` | `/api/marketplace/admin/rfqs/:rfqNumber/invite-vendor` | Undang vendor respond RFQ |
| `POST` | `/api/marketplace/admin/quotes/:id/approve` | Approve quote vendor |
| `POST` | `/api/marketplace/admin/quotes/:id/reject` | Reject quote vendor |
| `GET` | `/api/marketplace/admin/purchase-orders` | List semua PO |
| `POST` | `/api/marketplace/admin/purchase-orders/:id/confirm` | Konfirmasi PO → buat SO |
| `GET` | `/api/marketplace/admin/commission-report` | Laporan komisi |
| `GET` | `/api/marketplace/admin/reconciliation` | Reconciliation dual-write report [KEPUTUSAN #16] |

---

## 10. Final Security Rules

### 10.1 Field Visibility [KEPUTUSAN #10]

Field berikut diklasifikasikan **INTERNAL ONLY** dan **WAJIB** tidak terekspos ke API vendor maupun buyer:

| Field | Tabel | Alasan |
|---|---|---|
| `commission_rate` | `mkt_vendor_quotes` | Vendor tidak boleh tahu margin platform |
| `commission_amount` | `mkt_vendor_quotes` | Sama |
| `net_vendor_amount` | `mkt_vendor_quotes` | Sama |
| `rank_score` | `mkt_vendor_quotes` | Bocornya memungkinkan vendor gaming |
| `rank_badges` | `mkt_vendor_quotes` | Sama |

**Implementasi:** Buat Zod schema terpisah untuk `VendorQuotePublic` (tanpa field internal) dan `VendorQuoteInternal` (lengkap). Route vendor selalu serialize dengan `VendorQuotePublic`.

### 10.2 Rate Limiting Guest RFQ [KEPUTUSAN #11]

| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/marketplace/rfqs` (guest) | 3 RFQ | per email per jam |
| `POST /api/marketplace/rfqs` (guest) | 10 RFQ | per IP per hari |
| `POST /api/marketplace/rfqs/claim` | 5 percobaan | per email per hari |

### 10.3 Email Verification Guest [KEPUTUSAN #11]

- Setiap RFQ guest wajib memverifikasi email sebelum vendor bisa diinvite.
- Flow: `POST /rfqs` → kirim email OTP/magic link → `GET /rfqs/verify-email/:token` → set `email_verified = true`.
- RFQ dengan `email_verified = false` tidak bisa diproses ke tahap vendor invitation.

### 10.4 Guest Token Security

- `guest_token` di `mkt_rfqs` adalah UUID v4 random — tidak boleh sequential.
- Token hanya dipakai untuk tracking guest — tidak punya privilege lebih dari guest.
- Claim token di `mkt_rfq_guest_claims` expired dalam 7 hari.

### 10.5 Vendor Token Security

- `mkt_vendor_quotes.token` adalah UUID v4 random.
- Token tidak menggunakan `vendor_id` sebagai bagian dari token (no enumeration).
- Token expose hanya info yang relevan untuk satu RFQ spesifik — tidak bisa dipakai untuk lihat RFQ lain vendor yang sama.

### 10.6 Buyer → Vendor Data Isolation

- Buyer **tidak boleh melihat** quote vendor lain pada RFQ yang sama (sebelum admin approve winner).
- Admin bisa melihat semua quotes untuk satu RFQ.
- Setelah winner dipilih, buyer hanya melihat quote yang menang.

---

## 11. Final Accounting Rules

### 11.1 Tidak Ada Hardcode Rate [KEPUTUSAN #12]

Semua pajak komisi mengacu ke `accounting_taxes`:
- `commission_tax_id` di `mkt_vendor_quotes` FK ke `accounting_taxes.id`.
- Admin memilih tax yang berlaku (PPN 11%, withholding, dll.) dari tabel `accounting_taxes`.
- Tidak boleh ada `0.11` atau `"PPN"` hardcoded di business logic.

### 11.2 COA Mapping Marketplace [KEPUTUSAN #13]

Sebelum accounting integration diaktifkan, admin **wajib** setup COA mapping berikut di BizPortal:

| Akun | Tipe COA | Subtype | Keterangan |
|---|---|---|---|
| `Marketplace Commission Revenue` | `revenue` | - | Kredit komisi platform |
| `Marketplace Commission Tax Payable` | `liability` | `tax_asset` | PPN/withholding komisi |
| `Marketplace Vendor Payable` | `liability` | - | Hutang ke vendor setelah PO confirmed |
| `Marketplace Buyer Receivable` | `asset` | `receivable` | Piutang dari buyer |
| `Marketplace Clearing` | `asset` | `cash_bank` | Akun perantara settlement |

**Aturan:** Jika COA mapping belum dikonfigurasi, sistem **menolak** posting jurnal — bukan silent skip. Error wajib muncul di BizPortal.

### 11.3 Jurnal Komisi — Posting Rules

Jurnal komisi di-post **hanya setelah** `mkt_purchase_orders.status = 'completed'` (bukan saat PO confirm).

```
DEBIT  : Marketplace Buyer Receivable    → grand_total buyer
CREDIT : Marketplace Vendor Payable      → net_vendor_amount
CREDIT : Marketplace Commission Revenue  → commission_amount (net of tax)
CREDIT : Commission Tax Payable          → tax_amount (dari accounting_taxes)
```

**Source enum baru** yang harus ditambahkan ke `accountingEntrySourceEnum`:
```
'marketplace_commission'
```
> ⚠️ Penambahan enum ini tunduk pada MIGRATION WARNING di Section 8.

### 11.4 Tidak Ada Otomatis Posting di P0

Di P0, posting jurnal dilakukan **manual oleh admin** via tombol di BizPortal. Otomasi posting (trigger on status change) masuk P1.

---

## 12. Final Migration Rules

### 12.1 Migration Warning — ALTER TYPE [KEPUTUSAN #14]

> **WAJIB DIIKUTI TANPA PENGECUALIAN**
>
> `ALTER TYPE <pgEnum> ADD VALUE` di PostgreSQL tidak bisa dalam transaction.
> Seluruh migration yang menambahkan nilai enum baru (termasuk `marketplace_commission` ke `accountingEntrySourceEnum`) **harus**:
>
> 1. Dijalankan via `db.execute(sql\`ALTER TYPE ...\`)` langsung, bukan lewat `drizzle-kit push` / migration runner default.
> 2. Menggunakan koneksi **session pooler port 5432** (bukan pgBouncer 6543).
> 3. Verifikasi: `SELECT enum_range(NULL::<type_name>)` sebelum lanjut.
> 4. Wajib ada `.catch(() => {})` untuk idempotency jika value sudah ada.

### 12.2 Urutan DDL yang Benar

```
Step 1: CREATE TYPE mkt_rfq_status AS ENUM (...)     -- luar transaction
Step 2: CREATE TYPE mkt_rfq_priority AS ENUM (...)   -- luar transaction
Step 3: CREATE TYPE mkt_quote_status AS ENUM (...)   -- luar transaction
Step 4: CREATE TYPE mkt_po_status AS ENUM (...)      -- luar transaction
Step 5: CREATE TYPE mkt_stock_status AS ENUM (...)   -- luar transaction
Step 6: CREATE TYPE mkt_claim_status AS ENUM (...)   -- luar transaction
Step 7: CREATE TABLE mkt_rfqs (...)
Step 8: CREATE TABLE mkt_rfq_lines (...)
Step 9: CREATE TABLE mkt_vendor_quotes (...)
Step 10: CREATE TABLE mkt_vendor_quote_lines (...)
Step 11: CREATE TABLE mkt_purchase_orders (...)
Step 12: CREATE TABLE mkt_rfq_guest_claims (...)
Step 13: ALTER TABLE purchase_documents ADD COLUMN IF NOT EXISTS mkt_purchase_order_id integer REFERENCES mkt_purchase_orders(id) ON DELETE SET NULL
Step 14: ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'marketplace_commission'  -- luar transaction, port 5432
```

### 12.3 Aturan Idempotency

- Semua `CREATE TABLE` wajib `IF NOT EXISTS`.
- Semua `ALTER TABLE ADD COLUMN` wajib `IF NOT EXISTS`.
- Semua `CREATE TYPE` cek dulu via `SELECT EXISTS (SELECT FROM pg_type WHERE typname = '...')`.

### 12.4 Rollback Plan

Jika migration gagal di step >= 7:
1. DROP TABLE yang sudah dibuat (cascade aman karena FK ke tabel existing adalah SET NULL).
2. Enum types yang sudah CREATE tidak bisa di-DROP jika ada tabel yang pakai — pastikan tabel belum ada.
3. `purchase_documents.mkt_purchase_order_id` bisa DROP COLUMN kapan saja (nullable, belum ada data).

---

## 13. Feature Flag & Dual-Write

### 13.1 Kill Switch [KEPUTUSAN #15]

```
FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE = true | false
```

- Jika `false`: semua traffic marketplace diarahkan ke `portal_product_orders` (legacy path).
- Jika `true`: traffic diarahkan ke pipeline baru (`mkt_rfqs` → `mkt_purchase_orders`).
- Default: `false` — aman saat deploy pertama.

**Lokasi config:** Environment variable di `.replit` `[userenv.shared]`. Tidak hardcode di kode.

### 13.2 Dual-Write Strategy

Selama flag masih `false` (atau masa transisi), setiap order baru yang masuk via marketplace **ditulis ke dua tempat**:
1. `portal_product_orders` (legacy)
2. `mkt_rfqs` + `mkt_purchase_orders` (baru)

Dual-write dilakukan di layer service (bukan DB trigger) dengan:
- Jika write legacy gagal → rollback write baru → return error.
- Jika write baru gagal → log ke error table → TIDAK rollback legacy (legacy tetap master selama flag false).

### 13.3 Reconciliation Job [KEPUTUSAN #16]

Job reconciliation berjalan setiap malam (cron) dan melaporkan:

**Query yang dicek:**
```sql
SELECT ppo.order_number, ppo.created_at, ppo.status
FROM portal_product_orders ppo
LEFT JOIN mkt_purchase_orders mpo ON mpo.rfq_id IN (
  SELECT id FROM mkt_rfqs WHERE guest_token = ppo.order_number
)
WHERE mpo.id IS NULL
  AND ppo.created_at > <feature_flag_activation_date>
ORDER BY ppo.created_at DESC;
```

**Output:** Report di BizPortal menu `/admin/marketplace/reconciliation` yang menampilkan:
- Count `portal_product_orders` tanpa pasangan `mkt_*`
- Count `mkt_purchase_orders` tanpa pasangan `portal_product_orders`
- Link ke masing-masing record untuk manual fix

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
| Guest submit RFQ duplikat (email + item sama dalam 1 jam) | Rate limit block [KEPUTUSAN #11] |

---

## 15. COA Mapping Marketplace

### 15.1 Setup Admin Sebelum Go-Live [KEPUTUSAN #13]

Admin **wajib** menyelesaikan mapping berikut di BizPortal sebelum `FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE = true`:

| Setting Key | Nilai yang Dipilih | Tipe |
|---|---|---|
| `mkt_coa_commission_revenue` | COA dari `chart_of_accounts` (revenue) | FK → COA |
| `mkt_coa_commission_tax` | COA dari `chart_of_accounts` (liability) | FK → COA |
| `mkt_coa_vendor_payable` | COA dari `chart_of_accounts` (liability) | FK → COA |
| `mkt_coa_buyer_receivable` | COA dari `chart_of_accounts` (asset) | FK → COA |
| `mkt_coa_clearing` | COA dari `chart_of_accounts` (asset:cash_bank) | FK → COA |
| `mkt_journal_id` | Journal dari `accounting_journals` (type: general) | FK → Journal |
| `mkt_default_commission_tax_id` | Tax dari `accounting_taxes` | FK → Tax |

**Storage:** Disimpan di tabel `system_settings` (existing) dengan prefix key `marketplace.`.

### 15.2 Validasi Pre-Go-Live

Sebelum flag diaktifkan, sistem melakukan health check:
- Semua 7 COA mapping di atas terisi.
- COA yang dipilih masih `is_active = true`.
- Journal yang dipilih masih `is_active = true`.
- Tax yang dipilih masih `is_active = true`.

Jika gagal → tampilkan error di BizPortal dengan field yang belum terkonfigurasi.

---

## 16. Final Risk Register

| ID | Risiko | Likelihood | Impact | Mitigasi |
|---|---|---|---|---|
| R01 | Vendor bisa lihat field komisi | High | High | Zod schema terpisah `VendorQuotePublic` [KEPUTUSAN #10] |
| R02 | Guest RFQ spam melalui email palsu | High | Medium | Rate limit + email verification [KEPUTUSAN #11] |
| R03 | Nama tabel `mkt_pos` bentrok dengan POS kasir | Confirmed | High | Sudah difix → `mkt_purchase_orders` [KEPUTUSAN #1] |
| R04 | `ALTER TYPE ADD VALUE` dalam transaction fail | Confirmed | High | Migration warning + session pooler [KEPUTUSAN #14] |
| R05 | Legacy `portal_product_orders` tanpa pasangan mkt | Medium | Medium | Reconciliation job nightly [KEPUTUSAN #16] |
| R06 | Hardcode PPN 11% di komisi | Medium | Medium | Reuse `accounting_taxes` [KEPUTUSAN #12] |
| R07 | COA tidak dikonfigurasi → jurnal gagal silent | High | High | Validasi wajib + block go-live [KEPUTUSAN #13] |
| R08 | PD existing rusak karena tambah FK ke mkt | Medium | High | FK nullable + `IF NOT EXISTS` [KEPUTUSAN #8] |
| R09 | Guest claim RFQ orang lain | Low | High | Token UUID + validasi email exact match [KEPUTUSAN #9] |
| R10 | Dual-write race condition | Medium | High | Feature flag kill switch + mandatory dual-write test [KEPUTUSAN #15] |
| R11 | Enum free-text status inkonsisten | Confirmed | Medium | Canonical enum list enforced [KEPUTUSAN #17] |
| R12 | Vendor gaming rank_score via probe endpoint | Low | Medium | rank_score tidak pernah expose ke vendor [KEPUTUSAN #10] |

---

## 17. Phase 1 Readiness Checklist

Blueprint ini dinyatakan **SIAP masuk Phase 1** jika semua item di bawah ter-checklist.

### A. Schema & Naming [KEPUTUSAN #1–4, #7, #8]

- [ ] `mkt_pos` sudah di-rename menjadi `mkt_purchase_orders` di seluruh dokumen
- [ ] `mkt_rfq_items` sudah di-rename menjadi `mkt_rfq_lines` di seluruh dokumen
- [ ] `mkt_rfqs.vendor_id` sudah di-rename menjadi `catalog_vendor_id`
- [ ] Semua reference ke `catalog_item_id` sudah diganti `vendor_catalog_item_id`
- [ ] Tabel `mkt_vendor_quote_lines` ada di schema dan FK matrix
- [ ] `purchase_documents.mkt_purchase_order_id` nullable FK sudah terdokumentasi
- [ ] Tidak ada `mkt_rfq_id` di `purchase_documents`

### B. Tabel Dihapus dari P0 [KEPUTUSAN #5, #6]

- [ ] `mkt_invoices` TIDAK ada di daftar tabel P0
- [ ] `mkt_payments` TIDAK ada di daftar tabel P0
- [ ] Dokumen mengkonfirmasi reuse `sales_documents` untuk buyer invoice
- [ ] Dokumen mengkonfirmasi reuse `vendor_invoices`/`payment_requests` untuk vendor

### C. Security [KEPUTUSAN #10, #11]

- [ ] Field internal (`commission_rate`, `commission_amount`, `net_vendor_amount`, `rank_score`, `rank_badges`) terdokumentasi sebagai INTERNAL ONLY
- [ ] API spec vendor endpoints menggunakan `VendorQuotePublic` schema (tanpa field internal)
- [ ] Rate limit guest RFQ terdokumentasi (3/email/jam, 10/IP/hari)
- [ ] Email verification flow terdokumentasi

### D. Guest RFQ [KEPUTUSAN #9]

- [ ] Tabel `mkt_rfq_guest_claims` ada di final table list
- [ ] Flow claim (9 langkah) sudah terdokumentasi
- [ ] Edge cases (email beda, expired, duplicate) sudah terdokumentasi

### E. Accounting [KEPUTUSAN #12, #13]

- [ ] `commission_tax_id` FK ke `accounting_taxes` (bukan hardcode rate)
- [ ] COA mapping 7 keys terdokumentasi
- [ ] Validasi pre-go-live COA terdokumentasi
- [ ] Jurnal entry format terdokumentasi
- [ ] Source enum `marketplace_commission` terdokumentasi (dengan migration warning)

### F. Migration Safety [KEPUTUSAN #14]

- [ ] Migration warning ALTER TYPE terdokumentasi dengan jelas
- [ ] Urutan DDL 14 steps terdokumentasi
- [ ] Idempotency rule terdokumentasi (`IF NOT EXISTS`)
- [ ] Rollback plan terdokumentasi

### G. Feature Flag & Dual-Write [KEPUTUSAN #15, #16]

- [ ] `FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE` terdokumentasi
- [ ] Dual-write strategy terdokumentasi
- [ ] Reconciliation job query terdokumentasi
- [ ] BizPortal reconciliation page terdokumentasi

### H. Enum Canonical [KEPUTUSAN #17]

- [ ] Semua enum list final terdokumentasi (6 enum baru)
- [ ] Tidak ada status field yang pakai free-text tanpa enum

### I. Risk Register

- [ ] Semua 12 risiko terdokumentasi dengan mitigasi
- [ ] Semua mitigasi sudah align dengan keputusan #1–18

---

## Status Blueprint

| Item | Status |
|---|---|
| Semua 18 keputusan user ter-incorporate | ✅ |
| Tidak ada kode yang ditulis | ✅ |
| Tidak ada migration yang dibuat | ✅ |
| Tidak ada schema yang diubah | ✅ |
| Menunggu approval user sebelum Phase 1 | ⏳ |

**BLUEPRINT INI BELUM SIAP MASUK PHASE 1** sampai user memberikan approval eksplisit.  
Setelah approval diberikan, langkah pertama adalah validasi dan implementasi migration schema dalam urutan DDL yang terdokumentasi di Section 12.

---

*Revised Blueprint Enterprise Marketplace v1.1 — disusun berdasarkan 18 temuan Design Validation Report*
