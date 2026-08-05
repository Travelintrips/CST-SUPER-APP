# Enterprise Marketplace — Architecture Freeze Review
## (Pre-Phase 1 Audit Report)

**Status:** REVIEW DOCUMENT — Tidak ada kode atau migration  
**Versi Blueprint Direview:** v1.1  
**Tanggal Review:** 2026-07-01  
**Auditor:** Architecture Review  

---

## Ringkasan Eksekutif

| Area | Temuan | Kesiapan |
|---|---|---|
| 1. Cross Module Impact | 6 modul terdampak signifikan, 3 perlu perubahan minor | ⚠️ Ready with Minor Changes |
| 2. Database Impact | Index plan tidak lengkap, 1 missing audit trail, 2 query bottleneck | ⚠️ Ready with Minor Changes |
| 3. API Contract | 7 gap konsistensi ditemukan, pagination & Zod schema belum didefinisikan | ⚠️ Ready with Minor Changes |
| 4. UI/UX Journey | Flow buyer & vendor oke, admin journey ada 2 langkah yang hilang | ⚠️ Ready with Minor Changes |

**Verdict Keseluruhan: ⚠️ READY WITH MINOR CHANGES**  
Blueprint v1.1 **belum dapat masuk Phase 1** tanpa menyelesaikan daftar perubahan di Section 5 (Recommended Changes). Semua temuan adalah perubahan minor — tidak ada yang memerlukan perombakan arsitektur.

---

## Daftar Isi

1. [Cross Module Impact Analysis](#1-cross-module-impact-analysis)
2. [Database Impact Analysis](#2-database-impact-analysis)
3. [API Contract Review](#3-api-contract-review)
4. [UI/UX Journey Review](#4-uiux-journey-review)
5. [Daftar Temuan & Rekomendasi](#5-daftar-temuan--rekomendasi)
6. [Phase 1 Readiness Verdict](#6-phase-1-readiness-verdict)

---

## 1. Cross Module Impact Analysis

### 1.1 Matriks Dampak per Modul

| # | Modul | Route File | Status | Risiko | Perubahan Diperlukan |
|---|---|---|---|---|---|
| 1 | **Vendor Catalog Engine** | `vendorCatalogEngine.ts` | **REUSE** | Medium | Baca-saja: `vendor_catalog_items` dijadikan source RFQ lines. Risiko: data validity dan staleness harga. |
| 2 | **Sales (Sales Documents)** | `sales.ts` | **EXTEND** | Medium | Perlu membuat SO dari `mkt_purchase_orders.sales_document_id`. Logic pembuatan SO sudah ada — tinggal trigger dari service layer marketplace, bukan dari route sales langsung. |
| 3 | **Purchase (Purchase Documents)** | `purchase.ts` | **EXTEND** | Low | Tambah nullable column `mkt_purchase_order_id` ke `purchase_documents`. Tidak merusak existing logic karena nullable. |
| 4 | **Accounting** | `accounting.ts`, `accountingHub.ts` | **EXTEND** | High | Perlu: (a) tambah source enum `marketplace_commission`, (b) tambah COA mapping, (c) extend `postXxxJournal` functions untuk marketplace source. AccountingHub dashboard perlu aggregasi source baru. |
| 5 | **Supplier / Vendor** | `vendorFulfillment.ts`, `vendorPayments.ts` | **REUSE** | Low | Vendor tetap dari `suppliers` table. Tidak ada perubahan schema vendor. Perlu pastikan `supplier.id` yang masuk `mkt_vendor_quotes.vendor_id` valid dan `is_active=true`. |
| 6 | **Portal Product Orders** | `portalProductOrders.ts` | **MIGRATION TARGET** | High | Pipeline lama yang akan dimigrasi. Dual-write wajib selama transisi. Reconciliation job harus memantau ini. Legacy tidak boleh dimodifikasi selama dual-write aktif. |
| 7 | **Logistic RFQ** | `logisticRfq.ts`, `logisticRfqV2.ts` | **TIDAK TERPENGARUH** (referensi) | Low | Bukan target Marketplace. Tapi logistic RFQ punya pola token-based vendor yang bisa dijadikan referensi implementasi. `rfqRateLimit` middleware di logisticRfq juga bisa di-reuse. |
| 8 | **Notification System** | `notifications.ts`, `whatsapp.ts` | **EXTEND** | Medium | Marketplace perlu set notifikasi baru: (a) WA/email ke vendor saat diinvite, (b) WA ke buyer saat quote masuk, (c) WA ke admin saat PO confirmed. Perlu tambah template ke `waTemplateConfigs`. |
| 9 | **Approval Workflow** | `approvalWorkflow.ts`, `approvalMatrix.ts` | **TIDAK TERPENGARUH** (P0) | Low | Approval workflow existing tidak terkoneksi ke marketplace di P0. Koneksi approval (misal PO approval threshold) masuk P1. |
| 10 | **Inventory** | `inventoryMain.ts`, `inventoryStock.ts` | **TIDAK TERPENGARUH** (P0) | Low | Marketplace P0 belum menyentuh physical stock movement. Stock-out trigger dari `mkt_purchase_orders` masuk P1. |
| 11 | **Bank Reconciliation** | `bankReconciliation.ts` | **TIDAK TERPENGARUH** (P0) | Low | Settlement bank dari marketplace masuk setelah accounting integration aktif (P1). P0 masih manual. |
| 12 | **AI Agent** | `aiAgent.ts`, `aiDecisionMemory.ts` | **TIDAK TERPENGARUH** (P0) | Low | AI order intake tidak terhubung ke marketplace P0. Koneksi masuk roadmap terpisah. |
| 13 | **Auth Middleware** | `authMiddleware.ts` | **EXTEND** | Medium | Marketplace menggunakan 3 tier auth: guest (no auth), vendor token (no session), buyer authenticated (portal bearer), admin (internal session). Pastikan `requirePortalAuth` vs `requireClerkUser` dipetakan dengan benar di masing-masing endpoint. |
| 14 | **Dashboard** | `dashboard.ts` | **EXTEND** | Low | Dashboard admin perlu widget count `mkt_rfqs` (open), `mkt_purchase_orders` (pending). Tidak breaking — tambah query baru saja. |
| 15 | **RBAC & Custom Roles** | `rbac.ts`, `customRoles.ts` | **EXTEND** | Medium | Perlu definisi permission baru: `marketplace.admin`, `marketplace.view`, `marketplace.vendor_invite`. Tanpa ini, semua marketplace admin ops hanya bisa dilakukan role `admin` global. |

### 1.2 Modul Kritis yang Memerlukan Koordinasi

#### A. Sales Documents ↔ Marketplace

**Masalah:** `sales_documents` punya unique index `sales_documents_logistic_order_id_unique_idx` pada `logistic_order_id`. Marketplace tidak memakai `logistic_order_id`, tapi perlu pastikan saat SO dibuat untuk marketplace, field ini `NULL` (aman, karena UNIQUE index di PostgreSQL tidak menganggap NULL = NULL — banyak baris dengan `NULL` diperbolehkan).

**Verifikasi diperlukan:** Pastikan fungsi pembuatan SO yang akan dipanggil marketplace tidak memaksa pengisian `logistic_order_id`.

#### B. Accounting Source Enum ↔ Existing Partial Unique Index

**Masalah kritis:** `accounting_entries` punya partial unique index:
```sql
UNIQUE (source, source_id) WHERE source <> 'manual' AND source_id IS NOT NULL
```
Artinya: setiap kombinasi `(source='marketplace_commission', source_id=X)` hanya boleh 1 baris. Ini **benar** untuk kebutuhan marketplace — tapi perlu dipastikan `source_id` yang dipakai unik (misal `mkt_purchase_orders.id`, bukan `mkt_rfqs.id` yang bisa punya banyak settlement).

**Rekomendasi:** Gunakan `mkt_purchase_orders.id` sebagai `source_id` untuk accounting entries.

#### C. Portal Product Orders ↔ Dual-Write Race

**Masalah:** `portal_product_orders.order_number` adalah TEXT UNIQUE. Format order number harus tidak tumpang tindih dengan `mkt_rfqs.rfq_number`. Jika format sama (misal sama-sama `ORD-YYYYMM-XXXX`), dual-write akan conflict.

**Rekomendasi:** Pastikan format berbeda secara eksplisit:
- Legacy: `PPO-YYYYMM-XXXX` (portal product order)
- Marketplace RFQ: `MKT-RFQ-YYYYMM-XXXX`
- Marketplace PO: `MKT-PO-YYYYMM-XXXX`

---

## 2. Database Impact Analysis

### 2.1 Analisis Tabel Baru

| Tabel | Estimasi Rows P0 | Growth Rate | Concern |
|---|---|---|---|
| `mkt_rfqs` | < 500 | Low | Tidak perlu partisi |
| `mkt_rfq_lines` | < 2.000 | Low | Tidak perlu partisi |
| `mkt_vendor_quotes` | < 1.000 | Low | Tidak perlu partisi |
| `mkt_vendor_quote_lines` | < 5.000 | Low | Tidak perlu partisi |
| `mkt_purchase_orders` | < 200 | Low | Tidak perlu partisi |
| `mkt_rfq_guest_claims` | < 500 | Low | TTL-based — lama-lama expired rows menumpuk, perlu cleanup job |

**Kesimpulan partisi:** Tidak diperlukan untuk P0. Kaji ulang jika volume melebihi 100.000 rows per tabel.

### 2.2 Index Plan yang Diperlukan

Blueprint v1.1 **belum mendefinisikan index plan**. Berikut rekomendasi lengkap:

#### `mkt_rfqs`
```sql
-- Wajib:
CREATE INDEX mkt_rfqs_status_idx       ON mkt_rfqs (status);
CREATE INDEX mkt_rfqs_buyer_email_idx  ON mkt_rfqs (buyer_email);        -- guest claim lookup
CREATE UNIQUE INDEX mkt_rfqs_guest_token_uidx ON mkt_rfqs (guest_token) WHERE guest_token IS NOT NULL;
CREATE INDEX mkt_rfqs_company_status_idx ON mkt_rfqs (company_id, status);
CREATE INDEX mkt_rfqs_catalog_vendor_idx ON mkt_rfqs (catalog_vendor_id) WHERE catalog_vendor_id IS NOT NULL;
CREATE INDEX mkt_rfqs_created_at_idx   ON mkt_rfqs (created_at DESC);    -- admin list ordering
```

#### `mkt_rfq_lines`
```sql
CREATE INDEX mkt_rfq_lines_rfq_idx          ON mkt_rfq_lines (rfq_id);
CREATE INDEX mkt_rfq_lines_catalog_item_idx ON mkt_rfq_lines (vendor_catalog_item_id)
  WHERE vendor_catalog_item_id IS NOT NULL;
```

#### `mkt_vendor_quotes`
```sql
CREATE UNIQUE INDEX mkt_vendor_quotes_token_uidx ON mkt_vendor_quotes (token);
CREATE INDEX mkt_vendor_quotes_rfq_idx    ON mkt_vendor_quotes (rfq_id);
CREATE INDEX mkt_vendor_quotes_vendor_idx ON mkt_vendor_quotes (vendor_id);
CREATE INDEX mkt_vendor_quotes_status_idx ON mkt_vendor_quotes (status);
CREATE INDEX mkt_vendor_quotes_rfq_vendor_idx ON mkt_vendor_quotes (rfq_id, vendor_id); -- check double-invite
```

#### `mkt_vendor_quote_lines`
```sql
CREATE INDEX mkt_vql_quote_idx    ON mkt_vendor_quote_lines (quote_id);
CREATE INDEX mkt_vql_rfqline_idx  ON mkt_vendor_quote_lines (rfq_line_id);
-- Composite untuk join quote + line dalam satu query:
CREATE INDEX mkt_vql_quote_rfqline_idx ON mkt_vendor_quote_lines (quote_id, rfq_line_id);
```

#### `mkt_purchase_orders`
```sql
CREATE UNIQUE INDEX mkt_po_number_uidx    ON mkt_purchase_orders (po_number);
CREATE INDEX mkt_po_rfq_idx              ON mkt_purchase_orders (rfq_id);
CREATE INDEX mkt_po_vendor_idx           ON mkt_purchase_orders (vendor_id);
CREATE INDEX mkt_po_status_idx           ON mkt_purchase_orders (status);
CREATE INDEX mkt_po_sales_doc_idx        ON mkt_purchase_orders (sales_document_id)
  WHERE sales_document_id IS NOT NULL;
```

#### `mkt_rfq_guest_claims`
```sql
CREATE INDEX mkt_guest_claims_rfq_idx    ON mkt_rfq_guest_claims (rfq_id);
CREATE INDEX mkt_guest_claims_email_idx  ON mkt_rfq_guest_claims (guest_email);
CREATE INDEX mkt_guest_claims_token_idx  ON mkt_rfq_guest_claims (guest_token);
CREATE INDEX mkt_guest_claims_expires_idx ON mkt_rfq_guest_claims (expires_at)
  WHERE claim_status = 'pending';  -- cleanup job query
```

#### `purchase_documents` (ADD COLUMN)
```sql
-- Index pada kolom baru:
CREATE INDEX purchase_docs_mkt_po_idx ON purchase_documents (mkt_purchase_order_id)
  WHERE mkt_purchase_order_id IS NOT NULL;
```

### 2.3 Query Bottleneck Analysis

#### Bottleneck 1: Admin RFQ List View (HIGH)

Query paling berat yang akan dijalankan sering adalah admin list view:
```sql
SELECT r.*, 
       COUNT(DISTINCT ql.id) as quote_count,
       COUNT(DISTINCT rl.id) as line_count,
       s.name as vendor_name
FROM mkt_rfqs r
LEFT JOIN mkt_rfq_lines rl ON rl.rfq_id = r.id
LEFT JOIN mkt_vendor_quotes vq ON vq.rfq_id = r.id
LEFT JOIN mkt_vendor_quote_lines ql ON ql.quote_id = vq.id
LEFT JOIN suppliers s ON s.id = r.catalog_vendor_id
WHERE r.status IN ('submitted', 'quoted', 'in_review')
GROUP BY r.id, s.name
ORDER BY r.created_at DESC
LIMIT 50;
```

**Risiko:** 5-way join dengan GROUP BY tanpa pagination akan lambat saat data > 1.000 RFQ.

**Rekomendasi:** Simpan counter denormalized di `mkt_rfqs`:
- `mkt_rfqs.line_count integer DEFAULT 0` — update saat insert/delete `mkt_rfq_lines`
- `mkt_rfqs.quote_count integer DEFAULT 0` — update saat insert/update `mkt_vendor_quotes`

Dengan counter ini, admin list view tidak perlu LEFT JOIN yang berat.

#### Bottleneck 2: Vendor Quote Comparison View (MEDIUM)

Saat admin membandingkan semua quote untuk satu RFQ:
```sql
SELECT vq.*, 
       json_agg(vql ORDER BY vql.rfq_line_id) as quote_lines,
       s.name as vendor_name
FROM mkt_vendor_quotes vq
JOIN mkt_vendor_quote_lines vql ON vql.quote_id = vq.id
JOIN suppliers s ON s.id = vq.vendor_id
WHERE vq.rfq_id = $1
GROUP BY vq.id, s.name;
```

**Risiko:** `json_agg` bisa berat jika satu RFQ punya banyak vendor dan banyak lines. Misal 10 vendor × 20 lines = 200 rows sebelum aggregasi.

**Rekomendasi:** Cukup aman untuk P0. Pantau di P1 jika RFQ kompleks mulai masuk.

### 2.4 Missing: Audit Trail Table

**Temuan KRITIS:** Blueprint v1.1 tidak mendefinisikan audit trail untuk marketplace events.

ERP existing punya pola audit trail yang sudah mature:
- `rfq_activity_logs` (di `rfqVendorLinks.ts`) untuk logistic RFQ
- `order_audit_logs` untuk logistic orders

Marketplace **wajib** punya audit trail serupa. Proposal tabel tambahan (belum ada di Blueprint v1.1):

```
mkt_activity_logs
├── id              serial PK
├── entity_type     text NOT NULL   -- 'rfq' | 'quote' | 'purchase_order'
├── entity_id       integer NOT NULL
├── actor_type      text NOT NULL   -- 'buyer' | 'vendor' | 'admin' | 'system'
├── actor_id        text            -- user_id atau vendor token
├── actor_name      text
├── action          text NOT NULL   -- 'rfq_submitted' | 'vendor_invited' | 'quote_received' | dll
├── description     text
├── meta            jsonb           -- data tambahan (price changes, dll)
├── created_at      timestamp NOT NULL DEFAULT now()
```

**Impact jika tidak ada:** Tidak ada trail untuk audit, dispute resolution, atau debugging produksi.

### 2.5 Expired Guest Claims Cleanup

`mkt_rfq_guest_claims` dengan `claim_status = 'pending'` dan `expires_at < now()` akan menumpuk.

**Rekomendasi:** Tambahkan ke daftar cleanup job yang sudah ada di sistem, atau jadikan bagian dari nightly reconciliation job yang sudah direncanakan di Blueprint v1.1.

---

## 3. API Contract Review

### 3.1 Konsistensi dengan Standar REST Existing

Standar yang dipakai sistem saat ini (dari review `sales.ts`, `purchase.ts`, `logisticRfq.ts`):

| Standar | Existing | Blueprint Marketplace | Gap? |
|---|---|---|---|
| Pagination envelope | `{ data: [], pagination: { page, limit, total, totalPages } }` | Tidak didefinisikan | ⚠️ GAP |
| Error envelope | `{ message: "..." }` atau `{ error: "code", message: "..." }` | Tidak didefinisikan | ⚠️ GAP |
| Date serialization | ISO string via `.toISOString()` | Tidak disebutkan | ⚠️ GAP |
| Auth pattern internal | `requireAdmin(req, res)` atau `requireClerkUser` | Disebutkan tapi peta belum lengkap | ⚠️ GAP |
| Auth pattern portal | `requirePortalAuth` | Belum dipetakan ke endpoint | ⚠️ GAP |
| Rate limiting | `rfqRateLimit` middleware (sudah ada) | Disebutkan tapi belum wire ke middleware | ⚠️ GAP |
| Multi-tenancy | `resolveCompanyId` + `assertCompanyAccess` | Tidak disebutkan untuk authenticated buyers | ⚠️ GAP |
| Request validation | Zod schema per endpoint | Tidak ada Zod schema di blueprint | ⚠️ GAP |

### 3.2 Review Endpoint per Endpoint

#### Buyer Endpoints

| Endpoint | Auth | Paginasi? | Zod? | Temuan |
|---|---|---|---|---|
| `POST /api/marketplace/rfqs` | None (guest) / Portal bearer | N/A | ❌ Belum | Perlu Zod schema: `buyer_name`, `buyer_email`, `items[]`. Email wajib valid format. |
| `GET /api/marketplace/rfqs` | Portal bearer (`requirePortalAuth`) | ❌ Belum | N/A | Perlu paginasi + filter `status`. Multi-tenancy: hanya tampilkan RFQ milik user yang login. |
| `GET /api/marketplace/rfqs/:rfqNumber` | None (guest via token) / Portal bearer | N/A | N/A | Dua flow berbeda dalam satu endpoint — perlu klarifikasi: gunakan `rfq_number` atau `id`? `rfqNumber` lebih user-friendly. |
| `POST /api/marketplace/rfqs/:rfqNumber/accept` | Portal bearer | N/A | ❌ Belum | Perlu validasi: hanya buyer yang punya RFQ tersebut yang bisa accept. Ownership check wajib. |
| `DELETE /api/marketplace/rfqs/:rfqNumber` | Portal bearer | N/A | ❌ Belum | Perlu validasi status: hanya bisa cancel jika status `draft`/`submitted`/`quoted`. Status `accepted` tidak bisa cancel. |
| `GET /api/marketplace/rfqs/guest/:token` | None | N/A | N/A | ✅ Pattern bagus — token sebagai auth. Pastikan tidak expose field internal. |
| `POST /api/marketplace/rfqs/claim` | Portal bearer (wajib login) | N/A | ❌ Belum | Perlu Zod: `{ rfq_number, guest_token }`. Validasi: email akun == `mkt_rfqs.buyer_email`. |
| `GET /api/marketplace/purchase-orders` | Portal bearer | ❌ Belum | N/A | Perlu paginasi + filter status. |
| `GET /api/marketplace/purchase-orders/:poNumber` | Portal bearer | N/A | N/A | Ownership check: PO ini milik company user yang login. |
| `GET /api/marketplace/catalog` | None (public) | ❌ Belum | N/A | ✅ Sudah ada di `marketplace.ts` existing! Endpoint ini sudah implemented. Blueprint perlu acknowledge ini. |
| `GET /api/marketplace/catalog/:id` | None (public) | N/A | N/A | ✅ Sudah ada sebagai `GET /api/marketplace/products/:id`. Naming berbeda — perlu harmonisasi. |

#### Vendor Endpoints

| Endpoint | Auth | Temuan |
|---|---|---|
| `GET /api/marketplace/vendor/quote/:token` | Token-only | ✅ Consistent dengan logistic RFQ pattern. Pastikan response memakai `VendorQuotePublic` schema (tanpa field internal). |
| `POST /api/marketplace/vendor/quote/:token` | Token-only | Perlu Zod: `{ lines: [{ rfq_line_id, offered_unit_price, offered_qty, lead_time_days, stock_status, notes }] }`. Validasi: token masih valid, status `invited`/`opened`, belum `accepted`/`expired`. |
| `PUT /api/marketplace/vendor/quote/:token` | Token-only | Perlu validasi: hanya bisa revisi jika status `submitted` (belum `accepted`/`rejected`). |
| `DELETE /api/marketplace/vendor/quote/:token` | Token-only | Nama HTTP method `DELETE` untuk "withdraw" kurang ideal — pertimbangkan `POST /api/marketplace/vendor/quote/:token/withdraw` agar lebih explicit. |

#### Admin Endpoints

| Endpoint | Auth | Temuan |
|---|---|---|
| `GET /api/marketplace/admin/rfqs` | `requireAdmin` / `requireClerkUser` | Perlu: paginasi, filter `status`, filter `vendor_id`, filter `date_range`, search `buyer_name`/`buyer_email`. |
| `GET /api/marketplace/admin/rfqs/:rfqNumber` | `requireAdmin` | ✅ Internal view — semua field termasuk `commission_rate` boleh terlihat. |
| `POST /api/marketplace/admin/rfqs/:rfqNumber/invite-vendor` | `requireAdmin` | Perlu Zod: `{ vendor_id, message? }`. Validasi: vendor aktif, belum pernah diinvite ke RFQ ini (unique vendor per RFQ check). |
| `POST /api/marketplace/admin/quotes/:id/approve` | `requireAdmin` | Nama kurang presisi — ini bukan "approve" tapi "select winner". Ganti menjadi `/select-winner`. |
| `POST /api/marketplace/admin/quotes/:id/reject` | `requireAdmin` | ✅ OK. |
| `POST /api/marketplace/admin/purchase-orders/:id/confirm` | `requireAdmin` | Perlu trigger: otomatis buat `sales_documents` (SO) saat confirm. Blueprint belum mendokumentasikan trigger ini secara eksplisit. |
| `GET /api/marketplace/admin/commission-report` | `requireAdmin` | Perlu definisi: format response, filter `date_range`, `vendor_id`, `status`. |
| `GET /api/marketplace/admin/reconciliation` | `requireAdmin` | ✅ Sudah didefinisikan di Blueprint v1.1. |

### 3.3 Temuan Khusus: Endpoint Duplikat / Konflik

**Temuan PENTING:** `marketplace.ts` yang sudah ada saat ini mempunyai:
- `GET /api/marketplace/products` — list catalog items (public)
- `GET /api/marketplace/vendors` — list vendors (public)
- `GET /api/marketplace/categories` — list categories (public)
- `GET /api/marketplace/products/:id/related` — deprecated, gunakan `/api/portal/marketplace/:id/related`

Blueprint v1.1 mendefinisikan `GET /api/marketplace/catalog` untuk endpoint yang sama dengan `GET /api/marketplace/products`. **Ada konflik naming.** Dua pilihan:
1. **Keep existing** `/api/marketplace/products` — tidak perlu endpoint baru, cukup reference existing.
2. **Add new** `/api/marketplace/catalog` sebagai alias — tidak direkomendasikan (duplikasi).

**Rekomendasi:** Blueprint perlu direvisi untuk mengakui endpoint yang sudah ada dan tidak menduplikasinya.

### 3.4 Missing: Webhook / SSE untuk Real-time Updates

ERP existing punya SSE (Server-Sent Events) via `sseManager.ts` yang dipakai di `logisticRfq.ts` untuk real-time update ke portal. Blueprint v1.1 tidak mendefinisikan apakah marketplace akan menggunakan SSE atau polling.

**Rekomendasi:** Definisikan di blueprint apakah buyer/admin mendapat real-time update via SSE saat quote baru masuk. Jika ya, perlu tambah `broadcastToPortal('mkt_quote_received', ...)` ke blueprint. Jika tidak (polling), dokumentasikan keputusan itu.

### 3.5 OpenAPI Readiness

Proyek ini sudah punya `lib/api-spec/openapi.yaml` dan Orval codegen untuk frontend. Blueprint v1.1 tidak mendefinisikan apakah marketplace endpoints akan masuk `openapi.yaml`.

**Rekomendasi:** Tentukan di blueprint apakah marketplace route akan di-codegen atau manual. Jika masuk codegen (direkomendasikan untuk konsistensi), perlu tambah OpenAPI spec untuk semua 20+ endpoint marketplace sebelum Phase 1 implementation selesai.

---

## 4. UI/UX Journey Review

### 4.1 Buyer Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                      BUYER JOURNEY (P0)                         │
└─────────────────────────────────────────────────────────────────┘

Step 1: DISCOVERY
  ├── Buyer browse katalog vendor: GET /api/marketplace/products  [✅ EXISTS]
  ├── Filter: vendor, kategori, lokasi, search
  └── Lihat detail item + harga sell

Step 2: SUBMIT RFQ
  ├── Pilih satu atau beberapa item dari katalog
  ├── Isi form: nama, email, phone, company, alamat delivery, tanggal kebutuhan
  ├── Tentukan qty & target harga per line
  ├── Submit: POST /api/marketplace/rfqs
  ├── [GUEST] Terima email verifikasi → klik link → email_verified = true
  └── [AUTH]  Langsung ke Step 3

Step 3: TRACK RFQ
  ├── [GUEST] Akses via: GET /api/marketplace/rfqs/guest/:token
  ├── [AUTH]  Akses via: GET /api/marketplace/rfqs/:rfqNumber
  └── Lihat status: draft → submitted → in_review → quoted

Step 4: TERIMA QUOTE
  ├── Notifikasi WA/email: "X vendor sudah submit quote untuk RFQ Anda"
  ├── Lihat quote comparison (harga, lead time, stok per line)
  ├── [GUEST] Link ke halaman tracking guest
  └── [AUTH]  Di dashboard buyer

Step 5: ACCEPT QUOTE
  ├── Buyer pilih quote terbaik
  ├── POST /api/marketplace/rfqs/:rfqNumber/accept { quote_id }
  ├── PO dibuat otomatis: mkt_purchase_orders.status = 'pending'
  └── Admin mendapat notifikasi untuk konfirmasi

Step 6: TERIMA KONFIRMASI PO
  ├── Admin konfirmasi PO → SO buyer dibuat (sales_documents)
  ├── Notifikasi ke buyer: "PO Anda dikonfirmasi, SO [number] diterbitkan"
  └── Buyer lihat SO + instruksi pembayaran

Step 7: PEMBAYARAN
  ├── Buyer lihat invoice (via sales_documents, kind='order')
  ├── Upload bukti bayar via sales_documents.payment_proof_token flow [✅ EXISTS]
  └── Admin konfirmasi pembayaran

Step 8: FULFILLMENT & SELESAI
  ├── Vendor proses order
  ├── Update status PO: in_fulfillment → completed
  └── Notifikasi buyer: "Order selesai"

[LANGKAH HILANG #1]: Tidak ada flow "buyer cancel RFQ setelah vendor diinvite"
                      Perlu klarifikasi: apakah buyer bisa cancel jika vendor sudah
                      diinvite? Jika ya, bagaimana notifikasi ke vendor?

[LANGKAH HILANG #2]: Tidak ada flow "buyer reject semua quote"
                      Buyer perlu opsi menolak semua quote yang masuk dan request
                      re-quote, atau langsung cancel RFQ.
```

### 4.2 Vendor Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                     VENDOR JOURNEY (P0)                         │
└─────────────────────────────────────────────────────────────────┘

Step 1: TERIMA UNDANGAN
  ├── Admin invite vendor: POST /api/marketplace/admin/rfqs/:rfqNumber/invite-vendor
  ├── Sistem kirim WA + Email ke vendor (kontak dari suppliers.contactEmail / phone)
  ├── Pesan berisi: deskripsi RFQ, item yang diminta, deadline, link token
  └── Format link: https://domain.com/marketplace/vendor/{token}

Step 2: BUKA UNDANGAN
  ├── Vendor klik link token
  ├── GET /api/marketplace/vendor/quote/:token
  ├── Sistem update: mkt_vendor_quotes.status = 'opened', opened_at = now()
  └── Vendor melihat: detail RFQ, semua line items yang diminta, deadline, buyer info

Step 3: SUBMIT QUOTE PER LINE
  ├── Vendor isi harga per line item
  ├── Isi: offered_unit_price, offered_qty, lead_time_days, stock_status
  ├── Tambah notes dan attachment (opsional)
  ├── POST /api/marketplace/vendor/quote/:token
  └── Status: mkt_vendor_quotes.status = 'submitted'

Step 4: NOTIFIKASI ADMIN
  ├── Admin mendapat WA/notifikasi: "[Vendor X] sudah submit quote untuk RFQ [number]"
  └── Admin lihat comparison di BizPortal

Step 5: REVISI (OPSIONAL)
  ├── Jika admin/buyer request revisi:
  ├── Vendor terima notifikasi
  └── PUT /api/marketplace/vendor/quote/:token → status = 'revised'

Step 6: HASIL SELEKSI
  ├── [MENANG] Vendor terima notifikasi: "Quote Anda dipilih. PO akan diterbitkan."
  │             Status: mkt_vendor_quotes.status = 'accepted'
  └── [KALAH]  Vendor terima notifikasi: "Terima kasih. Quote Anda tidak dipilih."
               Status: mkt_vendor_quotes.status = 'rejected'/'not_selected'

Step 7: VENDOR TERIMA PO
  ├── Vendor terima notifikasi: PO diterbitkan (purchase_documents)
  ├── Link vendor accept token (existing pattern dari purchase.ts)
  └── Vendor accept PO via existing: GET/POST /api/purchase/vendor-accept/:token

Step 8: FULFILLMENT
  ├── Vendor proses order
  ├── Update via existing vendor fulfillment flow
  └── Submit invoice: vendor_invoices (existing, reuse)

[LANGKAH HILANG #3]: Tidak ada flow "vendor withdraw SETELAH quote submitted"
                      Blueprint mendefinisikan DELETE /vendor/quote/:token untuk withdraw,
                      tapi tidak mendefinisikan: apakah vendor bisa withdraw setelah
                      quote dipilih admin? Perlu aturan: withdraw hanya boleh sebelum
                      status 'accepted'.

[LANGKAH HILANG #4]: Tidak ada mekanisme "vendor expired / tidak respons"
                      Siapa yang set status 'expired' pada vendor quote? Perlu:
                      (a) Admin set manual, atau
                      (b) Cron job yang set expired setelah deadline.
                      Jika cron, perlu definisi kapan dan siapa yang trigger.
```

### 4.3 Admin Marketplace Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                   ADMIN MARKETPLACE JOURNEY (P0)                │
└─────────────────────────────────────────────────────────────────┘

Step 1: PANTAU RFQ MASUK
  ├── Dashboard widget: "X RFQ baru" / "Y RFQ belum direspons vendor"
  ├── GET /api/marketplace/admin/rfqs (list dengan filter status)
  └── BizPortal: menu Marketplace → RFQ Management

Step 2: REVIEW RFQ BARU
  ├── GET /api/marketplace/admin/rfqs/:rfqNumber
  ├── Lihat: buyer info, items, target harga, delivery date
  ├── Verifikasi email buyer sudah verified (email_verified = true)
  └── Klasifikasi: apakah bisa dipenuhi? Vendor mana yang cocok?

Step 3: INVITE VENDOR
  ├── POST /api/marketplace/admin/rfqs/:rfqNumber/invite-vendor { vendor_id }
  ├── Sistem buat mkt_vendor_quotes dengan token unik
  ├── Kirim WA + Email ke vendor
  └── Status RFQ berubah: 'submitted' → 'in_review'

Step 4: MONITOR RESPONSE VENDOR
  ├── GET /api/marketplace/admin/rfqs/:rfqNumber (lihat status semua vendor yang diinvite)
  ├── Lihat: vendor mana yang sudah buka, sudah submit, belum respons
  └── Opsi: kirim reminder ke vendor yang belum respons

Step 5: COMPARE QUOTES
  ├── Lihat semua quote yang masuk per line item
  ├── Bandingkan: harga, lead time, stock status, total quote
  ├── Lihat rank_score dan rank_badges (INTERNAL — tidak terlihat vendor/buyer)
  └── Set commission_rate dan commission_amount per quote winner

Step 6: SELECT WINNER
  ├── POST /api/marketplace/admin/quotes/:id/select-winner
  ├── Status quote winner: 'accepted'
  ├── Status quote lain: 'not_selected'
  └── Status RFQ: 'quoted' → 'accepted'

Step 7: BUAT & KONFIRMASI PO
  ├── Review mkt_purchase_orders yang dibuat (status: 'pending')
  ├── POST /api/marketplace/admin/purchase-orders/:id/confirm
  ├── Sistem otomatis: buat sales_documents (SO) untuk buyer
  ├── Sistem otomatis: buat purchase_documents (PO) untuk vendor
  └── Status PO: 'pending' → 'confirmed'

Step 8: TRACK PEMBAYARAN BUYER
  ├── Monitor: sales_documents.payment_status
  ├── Konfirmasi bukti bayar yang diupload buyer
  └── Update payment status

Step 9: TRACK VENDOR FULFILLMENT
  ├── Monitor: purchase_documents.receive_status
  ├── Konfirmasi receipt dari vendor
  └── Update status PO: 'confirmed' → 'in_fulfillment' → 'completed'

Step 10: POST JURNAL KOMISI (MANUAL di P0)
  ├── Setelah PO completed, admin klik "Post Journal"
  ├── POST /api/marketplace/admin/purchase-orders/:id/post-journal  [MISSING dari Blueprint!]
  ├── Sistem buat accounting_entries (source: 'marketplace_commission')
  └── Status akuntansi ter-record

Step 11: REKONSILIASI
  ├── GET /api/marketplace/admin/reconciliation
  ├── Cek portal_product_orders tanpa pasangan mkt_*
  └── Manual fix jika ditemukan gap

[LANGKAH HILANG #5]: POST journal dari admin belum ada endpoint di Blueprint v1.1.
                      Perlu tambah: POST /api/marketplace/admin/purchase-orders/:id/post-journal

[LANGKAH HILANG #6]: Tidak ada "send reminder to vendor" endpoint.
                      Admin perlu bisa kirim ulang undangan / reminder ke vendor
                      yang belum respons. Perlu tambah:
                      POST /api/marketplace/admin/quotes/:id/send-reminder
```

### 4.4 Full End-to-End Flow Validation

```
Marketplace → RFQ → Quote → PO → Invoice → Payment → Accounting

[✅] Marketplace catalog → mkt_rfq_lines.vendor_catalog_item_id
[✅] RFQ submitted → mkt_rfqs (status: submitted)
[✅] Vendor invited → mkt_vendor_quotes (status: invited)
[✅] Vendor quote → mkt_vendor_quote_lines
[✅] Quote accepted → mkt_purchase_orders (status: pending)
[✅] PO confirmed → sales_documents (SO buyer) + purchase_documents (PO vendor)
[⚠️] Invoice buyer → sales_documents.invoice_status = 'to_invoice' → 'invoiced'
                      (Trigger dari mkt_purchase_orders confirm belum didefinisikan)
[✅] Payment buyer → sales_documents.payment_proof_token flow (existing)
[✅] Vendor payment → payment_requests / vendor_invoices (existing)
[⚠️] Accounting → accounting_entries source='marketplace_commission'
                   (Endpoint POST journal belum ada di blueprint)
[⚠️] Commission settlement → net_vendor_amount ke vendor
                              (Flow dari commission calculation ke vendor payment
                               belum didefinisikan lengkap)
```

---

## 5. Daftar Temuan & Rekomendasi

### Temuan KRITIS (Blocker untuk Phase 1)

| ID | Temuan | Area | Rekomendasi |
|---|---|---|---|
| **F01** | Index plan tidak ada di Blueprint v1.1 | Database | Tambahkan Section Index Plan ke Blueprint v1.1 (lihat Section 2.2 di atas). Tanpa index yang benar, query admin list view akan lambat sejak hari pertama. |
| **F02** | Audit trail marketplace tidak didefinisikan | Database | Tambahkan tabel `mkt_activity_logs` ke Final Table List P0 (atau minimal P0-optional). Log events kritis: vendor_invited, quote_submitted, quote_accepted, po_confirmed, journal_posted. |
| **F03** | Endpoint `POST .../post-journal` tidak ada | API | Tambahkan endpoint: `POST /api/marketplace/admin/purchase-orders/:id/post-journal` untuk trigger akuntansi manual (P0). |
| **F04** | Endpoint `GET /api/marketplace/catalog` duplikat dengan existing | API | Hapus dari blueprint, ganti dengan referensi ke endpoint yang sudah ada: `GET /api/marketplace/products` (existing di `marketplace.ts`). |
| **F05** | Zod schema tidak didefinisikan untuk 1 endpoint pun | API | Tambahkan section "Request Body Schemas" ke Blueprint v1.1 untuk minimal 5 endpoint kritis: submit RFQ, submit quote, invite vendor, accept quote, confirm PO. |

### Temuan MEDIUM (Harus Diselesaikan Sebelum Implementation)

| ID | Temuan | Area | Rekomendasi |
|---|---|---|---|
| **F06** | Pagination tidak didefinisikan untuk list endpoints | API | Semua GET list endpoints wajib paginasi `?page=1&limit=50`. Tambahkan ke blueprint. |
| **F07** | Peta auth middleware tidak lengkap | API | Buat tabel mapping: endpoint → middleware (None / requirePortalAuth / requireAdmin). |
| **F08** | Counter denormalized tidak ada di `mkt_rfqs` | Database | Tambah `line_count` dan `quote_count` ke schema `mkt_rfqs` untuk menghindari JOIN berat. |
| **F09** | Buyer cancel RFQ setelah vendor diinvite tidak terdefinisi | UX | Definisikan: apakah boleh? Apa yang terjadi ke vendor yang sudah dibuka/submit quote? |
| **F10** | Buyer reject semua quote tidak terdefinisi | UX | Definisikan endpoint dan status flow: buyer bisa reject semua quote → RFQ kembali ke `in_review` atau langsung `cancelled`. |
| **F11** | Vendor quote expiry tidak ada mekanismenya | UX | Definisikan: siapa yang set status `expired` — admin manual atau cron job. |
| **F12** | "Send reminder to vendor" endpoint tidak ada | API | Tambahkan: `POST /api/marketplace/admin/quotes/:id/send-reminder`. |
| **F13** | `DELETE /vendor/quote/:token` kurang semantik | API | Ganti dengan `POST /api/marketplace/vendor/quote/:token/withdraw` untuk clarity. |
| **F14** | Double-invite check tidak didefinisikan | API | Definisikan: sistem harus prevent admin invite vendor yang sudah diinvite ke RFQ yang sama. |
| **F15** | `select-winner` naming lebih tepat dari `approve` | API | Ganti `POST /admin/quotes/:id/approve` → `POST /admin/quotes/:id/select-winner`. |
| **F16** | RBAC permissions marketplace belum didefinisikan | Cross Module | Tambahkan ke blueprint: permission strings `marketplace.admin`, `marketplace.view`, `marketplace.vendor_invite`. |
| **F17** | SSE vs polling belum didefinisikan | API | Tentukan apakah marketplace pakai SSE (broadcastToPortal) atau polling. Dokumentasikan keputusan. |
| **F18** | Commission settlement flow ke vendor tidak lengkap | UX | Jelaskan: setelah `net_vendor_amount` dihitung, bagaimana vendor dibayar? Lewat `payment_requests` existing — kapan dibuat, oleh siapa? |

### Temuan LOW (Nice to Have Sebelum Phase 1)

| ID | Temuan | Rekomendasi |
|---|---|---|
| **F19** | Order number format tidak didefinisikan explicitly | Definisikan format string di blueprint: `MKT-RFQ-YYYYMM-XXXX`, `MKT-PO-YYYYMM-XXXX`. |
| **F20** | Guest claims expired rows cleanup tidak ada job | Tambahkan ke nightly cleanup / reconciliation job. |
| **F21** | OpenAPI spec readiness tidak didefinisikan | Tentukan apakah marketplace route masuk `openapi.yaml` dan Orval codegen. |
| **F22** | Dashboard widget belum didefinisikan | Tambahkan spec widget ke blueprint: count open RFQ, count pending PO, total commission bulan ini. |
| **F23** | accounting_entries.source_id harus `mkt_purchase_orders.id` | Dokumentasikan eksplisit di blueprint: source_id = mkt_purchase_orders.id (bukan mkt_rfqs.id). |

---

## 6. Phase 1 Readiness Verdict

### Ringkasan Temuan

| Severity | Count | Status |
|---|---|---|
| KRITIS (Blocker) | 5 (F01–F05) | ❌ Harus diselesaikan di Blueprint sebelum implementasi |
| MEDIUM | 13 (F06–F18) | ⚠️ Harus diselesaikan sebelum mulai coding |
| LOW | 5 (F19–F23) | 💡 Recommended tapi tidak blocking |
| **Total** | **23** | — |

### Verdict

> ## ⚠️ READY WITH MINOR CHANGES
>
> Blueprint Enterprise Marketplace v1.1 **belum dapat masuk Phase 1**.  
> Diperlukan **Blueprint v1.2** yang menyelesaikan 5 temuan KRITIS (F01–F05) dan 13 temuan MEDIUM (F06–F18) sebelum implementation dimulai.
>
> Tidak ada temuan yang memerlukan perombakan arsitektur. Semua perubahan adalah additive (tambahan section/field) ke blueprint yang sudah ada. Estimasi waktu revisi blueprint: **1 sesi kerja**.

### Checklist untuk Blueprint v1.2

Sebelum Blueprint v1.2 dapat di-approve untuk Phase 1 implementation:

- [ ] **F01** — Index plan lengkap ditambahkan
- [ ] **F02** — `mkt_activity_logs` ditambahkan ke tabel list P0 (atau P0-optional)
- [ ] **F03** — Endpoint `POST /admin/purchase-orders/:id/post-journal` ditambahkan
- [ ] **F04** — `GET /marketplace/catalog` dihapus, diganti referensi ke endpoint existing
- [ ] **F05** — Request body Zod schema untuk 5 endpoint kritis didefinisikan
- [ ] **F06** — Pagination spec ditambahkan ke semua list endpoints
- [ ] **F07** — Auth middleware mapping table ditambahkan
- [ ] **F08** — `line_count` dan `quote_count` counter ditambahkan ke `mkt_rfqs` schema
- [ ] **F09** — Buyer cancel setelah vendor diinvite: flow dan aturan didefinisikan
- [ ] **F10** — Buyer reject semua quote: endpoint dan status flow didefinisikan
- [ ] **F11** — Vendor quote expiry mechanism didefinisikan (manual atau cron)
- [ ] **F12** — `POST /admin/quotes/:id/send-reminder` ditambahkan
- [ ] **F13** — Withdraw endpoint diganti `POST .../withdraw`
- [ ] **F14** — Double-invite prevention rule didefinisikan
- [ ] **F15** — `approve` diganti `select-winner`
- [ ] **F16** — RBAC permission strings didefinisikan
- [ ] **F17** — SSE vs polling decision didokumentasikan
- [ ] **F18** — Commission → vendor payment flow lengkap didefinisikan

---

*Architecture Freeze Review Report — Enterprise Marketplace Pre-Phase 1*  
*Review berdasarkan Blueprint v1.1 + codebase audit ERP existing*
