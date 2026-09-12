# MASTER FIX PLAN — BizPortal / CST Super App
**Tanggal Kompilasi:** 27 Mei 2026  
**Scope:** Audit Batch 1–6 (Security, Auth, API Routes, DB Schema, Frontend, Storage/WA/AI)  
**Status:** PLAN ONLY — Belum ada implementasi

---

## A. MASTER ISSUE LIST

### CRITICAL (Harus fix sebelum production)

| # | Priority | Batch | Feature | Issue | File / API | Risk | Fix Summary |
|---|----------|-------|---------|-------|-----------|------|-------------|
| C1 | CRITICAL | B2 | Trading / Purchase | Seluruh route `trading.ts` tidak memiliki auth middleware. Siapapun bisa buat stock, hapus supplier, kelola catalog. | `routes/trading.ts` — `POST /api/trading/stocks`, `DELETE /api/trading/suppliers/:id` | Data tampering, data loss | Tambah `router.use(requireClerkUser)` dan `requireAdmin` di awal file |
| C2 | CRITICAL | B2 | Ecommerce / POS | Seluruh route `ecommerce.ts` tidak memiliki auth wall. `GET /api/ecommerce/orders` expose semua PII customer ke publik. `PUT /api/ecommerce/orders/:id` bisa ubah status ke "delivered" tanpa auth → jurnal akuntansi corrupt. | `routes/ecommerce.ts` — `GET /orders`, `PUT /orders/:id` | PII leak, accounting corruption | Pisahkan public route (storefront) vs admin route. Tambah auth pada semua write + admin read |
| C3 | CRITICAL | B2 | Ecommerce / POS | `POST /api/ecommerce/orders` tidak punya duplicate protection. Klik checkout 2x → 2 order + 2 notif WA ke admin. | `routes/ecommerce.ts:507` | Duplicate SO, double billing | Tambah idempotency key header + 60s window per sessionId/email |
| C4 | CRITICAL | B3 | Logistics Orders | `POST /api/logistic/orders` (create order) **sama sekali tidak dilindungi**. Bot bisa flood database dengan order palsu. | `routes/logisticOrders.ts:148` | DB flood, data corruption | Tambah `requireClerkUser` atau minimal rate limiting + captcha token |
| C5 | CRITICAL | B3 | Logistics Orders | `GET /api/logistic/orders/:id` memanggil `requireClerkUser` tapi **tidak validasi apakah user belongs ke company order tersebut**. User Company A bisa lihat order Company B (termasuk margin finansial, PII). | `routes/logisticOrders.ts:718` | Cross-company data leak | Tambah WHERE clause `companyId = resolvedCompanyId` setelah fetch |
| C6 | CRITICAL | B3 | Logistics RFQ | `GET /api/logistic/:id/quotes` mengembalikan semua vendor quote (harga, nama vendor) tanpa auth. | `routes/logisticRfq.ts:843` | Vendor price leak ke competitor | Tambah `requireClerkUser` |
| C7 | CRITICAL | B3 | Logistics RFQ | `POST /vendor-confirm` — update `quoteStatus` atomic (aman), tapi update `logisticOrdersTable.status` dan `finalPrice` **tidak atomic**. Race condition: 2 vendor accept bersamaan → `approvedQuoteId` mismatch dengan `finalPrice`. | `routes/logisticRfq.ts:452` | Payment/status corrupt | Wrap dalam DB transaction tunggal |
| C8 | CRITICAL | B4 | Vendor Response | `vendorPrice` (harga beli dari vendor) bocor ke customer di endpoint `/approve-form`. Customer bisa lihat margin perusahaan. | `routes/vendorResponse.ts` — approve-form response | Data leak (margin bisnis) | Strip `vendorPrice`, `costBreakdown`, field internal dari response customer |
| C9 | CRITICAL | B3 | Logistics Orders | `POST /vendors`, `PUT /vendors/:id`, `DELETE /vendors/:id` dalam `logisticOrders.ts` tidak dilindungi. Siapapun bisa tambah/ubah/hapus vendor logistik. | `routes/logisticOrders.ts:661–705` | Vendor data tampering | Tambah `requireAdmin` pada semua vendor management routes |
| C10 | CRITICAL | B1 | Auth / Portal Admin | `requirePortalAdmin` di `supabaseAuth.ts` — jika `PORTAL_ADMIN_EMAILS` env kosong, email check **di-skip**, sehingga user Supabase manapun yang punya role `portal_admin` di DB bisa jadi admin. | `lib/supabaseAuth.ts:185` | Privilege escalation | Hardcode fallback: jika env kosong, **tolak semua** bukan lolos semua |

---

### HIGH (Fix dalam sprint pertama setelah Critical)

| # | Priority | Batch | Feature | Issue | File / API | Risk | Fix Summary |
|---|----------|-------|---------|-------|-----------|------|-------------|
| H1 | HIGH | B3 | Logistics RFQ | `GET /api/logistic/logistic-vendors` lists semua vendor aktif (nama, telp, email) tanpa auth. | `routes/logisticRfq.ts:1054` | PII vendor leak | Tambah `requireClerkUser` |
| H2 | HIGH | B3 | Logistics Orders | `GET /trucking-rates`, `GET /vendors`, `GET /:id/locations` tidak dilindungi. | `routes/logisticOrders.ts:483–489, 1283` | Data leak internal pricing | Tambah `requireClerkUser` |
| H3 | HIGH | B5 | Webhooks / WA | `processWaMediaForAiIntake(mediaUrl)` menerima URL langsung dari payload Fonnte tanpa validasi host. Attacker bisa inject URL internal (SSRF). | `routes/webhooks.ts:345` | SSRF → akses metadata/internal services | Whitelist domain (hanya `*.fonnte.com`, `*.whatsapp.net`), reject private IP ranges |
| H4 | HIGH | B5 | WA Templates | WA notification message di `webhooks.ts` hardcoded (bukan dari DB template engine). Perubahan teks butuh redeploy. | `routes/webhooks.ts:243–257, 357–368` | Operational rigidity, inconsistency | Pindahkan ke `waTemplates` table dengan fallback ke konstanta |
| H5 | HIGH | B6 | DB Schema | `ordersTable` tidak punya **satu pun index**. Full table scan tiap query order by email/status. | `lib/db/src/schema/orders.ts` | Performance degradation at scale | Tambah index pada `customerEmail`, `status`, `companyId`, `createdAt` |
| H6 | HIGH | B6 | DB Schema | `salesDocumentsTable` tidak ada unique constraint pada `logisticOrderId`. Bisa ada >1 SO dari 1 Logistic Order. | `lib/db/src/schema/salesDocuments.ts` | Duplicate SO, accounting confusion | Tambah `uniqueIndex` pada `logisticOrderId` (nullable-safe) |
| H7 | HIGH | B4 | Vendor Response | TOCTOU window pada 5-menit guard di `POST /vendor-response/:orderNumber`. Concurrent request bisa bypass guard. | `routes/vendorResponse.ts:268` | Duplicate vendor submission | Pindahkan guard ke DB-level (`onConflict` + transaction) |
| H8 | HIGH | B5 | AI Agent | `POST /api/ai-agent/upload` public tanpa auth, rate limit hanya in-memory (reset saat restart). Attacker bisa drain OpenAI quota. | `routes/aiAgent.ts` | OpenAI quota exhaustion, biaya tak terkontrol | Tambah persistent rate limit (Redis atau DB counter), atau wajibkan session token yang valid |
| H9 | HIGH | B6 | DB Schema | `freightAttachmentsTable.invoiceId` dan `salesDocumentsTable.taxRateId/warehouseId` tidak punya FK constraint. Data orphan tidak terdeteksi. | `lib/db/src/schema/` | Data integrity violation | Tambah `.references()` pada field terkait |
| H10 | HIGH | B6 | DB Schema | `salesDocumentsTable` tidak ada index pada `customerId`, `logisticOrderId`, `companyId`, `status`. | `lib/db/src/schema/salesDocuments.ts` | Full table scan pada halaman paling sering dibuka | Tambah composite index |
| H11 | HIGH | B3 | Logistics Orders | 60s duplicate check di `POST /logistic/orders` berbasis email — bypass dengan email berbeda atau tanpa email. | `routes/logisticOrders.ts:155` | Duplicate order dari customer yang sama | Ganti ke idempotency key (UUID client-generated) + DB unique constraint |

---

### MEDIUM (Fix dalam sprint 2–3)

| # | Priority | Batch | Feature | Issue | File / API | Risk | Fix Summary |
|---|----------|-------|---------|-------|-----------|------|-------------|
| M1 | MEDIUM | B1 | Frontend Cache | `logistics-portal-order-detail.tsx` memanggil `refetch()` langsung setelah mutasi, bukan `invalidateQueries`. Dashboard order list bisa stale. | `bizportal/src/pages/logistics-portal-order-detail.tsx:260` | Data stale di komponen lain | Ganti `refetchOpStatus()` → `queryClient.invalidateQueries(['logistic-orders'])` |
| M2 | MEDIUM | B1 | Frontend Cache | Mutasi di `purchase/vendors.tsx` hanya invalidate list, bukan detail. Vendor detail page bisa stale setelah edit. | `bizportal/src/pages/purchase/vendors.tsx:232–239` | Stale vendor detail | Tambah invalidasi untuk `['vendor', id]` key |
| M3 | MEDIUM | B1 | Frontend Cache | Query key di `qc-editor.tsx` hardcoded sebagai string path, bukan konstanta. Rentan typo dan sulit di-trace. | `bizportal/src/pages/purchase/qc-editor.tsx:31,37,76,82` | Query key mismatch, cache tidak hit | Buat konstanta `QUERY_KEYS` terpusat |
| M4 | MEDIUM | B1 | Frontend Error | Silent `catch {}` di `logistics-portal-order-detail.tsx` menelan error fetch tanpa feedback ke user. | `bizportal/src/pages/logistics-portal-order-detail.tsx:199` | User tidak tahu fetch gagal | Tambah toast error atau fallback state |
| M5 | MEDIUM | B1 | Frontend UX | `customer-quote.tsx` tidak disable semua trigger saat `submitting = true`, memungkinkan double submission. | `customer-portal/src/pages/customer-quote.tsx:84` | Duplicate quote submission | Disable semua button/input saat submitting |
| M6 | MEDIUM | B5 | Rate Limiting | Semua rate limiter (storage, whatsapp, aiAgent) pakai in-memory `Map`. Reset saat server restart — tidak efektif di lingkungan containerized. | `routes/storage.ts`, `whatsapp.ts`, `aiAgent.ts` | Rate limit bypass via restart | Migrasi ke DB-backed counter atau Redis |
| M7 | MEDIUM | B1 | Auth Cache | `_userCtxCache` di `authMiddleware.ts` lokal per instance. Di multi-instance deployment, invalidasi cache tidak propagate. | `middlewares/authMiddleware.ts` | Stale role/permission setelah update | Tambah cache-busting via shared DB flag atau short TTL (60s) |
| M8 | MEDIUM | B6 | DB Schema | `ordersTable` tidak ada index pada `customerEmail`, `status`. | `lib/db/src/schema/orders.ts` | Slow query on order lookup | Tambah index |
| M9 | MEDIUM | B6 | DB Schema | `productsTable.defaultSalesTaxId` dan `defaultPurchaseTaxId` tidak punya FK ke `accountingTaxesTable`. | `lib/db/src/schema/products.ts` | Orphan tax reference | Tambah `.references()` |
| M10 | MEDIUM | B3 | Logistics Tracking | `GET /track/:orderNumber` mengembalikan full `driverJob` (lokasi, vehicle, timing) ke publik. Order number pola-nya guessable. | `routes/logisticOrders.ts:394` | Operational intel leak | Strip internal driver fields dari `toPublicOrder()`, kembalikan hanya status + ETA |
| M11 | MEDIUM | B4 | Vendor Mini Form | VMF audit trail tidak mencatat semua action (hanya create, tidak update/delete). Timeline tidak lengkap. | `routes/vendorMiniForm.ts`, `lib/auditLog.ts` | Incomplete audit trail | Tambah log entry pada setiap update dan delete VMF |
| M12 | MEDIUM | B5 | WA Notifications | Notifikasi WA bisa duplikat jika webhook Fonnte retry (tidak ada idempotency check pada incoming webhook). | `routes/webhooks.ts` | Duplicate admin notifications | Tambah `messageId` dedup check di DB sebelum proses |

---

### LOW (Nice-to-have, bisa dijadwalkan kapan saja)

| # | Priority | Batch | Feature | Issue | File / API | Risk | Fix Summary |
|---|----------|-------|---------|-------|-----------|------|-------------|
| L1 | LOW | B1 | Frontend | Unit/kategori list hardcoded di `items.tsx` dan `vendors.tsx`. Tidak sinkron dengan backend. | `sales/items.tsx:35–40`, `purchase/vendors.tsx:51–60` | Inconsistency jika backend tambah tipe baru | Fetch dari API atau pindah ke shared constants |
| L2 | LOW | B1 | Auth | `authMiddleware.ts` log 8 karakter pertama session ID saat auth failure. | `middlewares/authMiddleware.ts:92` | Partial session ID exposure di logs | Hapus atau replace dengan opaque hash |
| L3 | LOW | B1 | Frontend Code | Upload logic duplikat di `vendors.tsx` dan `items.tsx`. | Multiple pages | Code smell, maintenance burden | Ekstrak ke custom hook `useImageUpload()` |
| L4 | LOW | B1 | Frontend UX | Error message di form selalu generic (`t.common.error`) tanpa detail dari API. | `purchase/vendors.tsx:205, 245` | UX kurang informatif | Parse dan tampilkan `error.response.data.message` |
| L5 | LOW | B4 | Frontend UX | `vendor-quote-form.tsx` tidak validasi `estimatedDays` sebelum submit. | `customer-portal/src/pages/vendor-quote-form.tsx:53` | Invalid data masuk DB | Tambah Zod validation di frontend |
| L6 | LOW | B6 | DB Schema | `mediaAssetsTable` tidak ada index pada `folder` dan `uploadedBy`. | `lib/db/src/schema/mediaAssets.ts` | Slow query saat browse media | Tambah index |
| L7 | LOW | B5 | WA | `DEFAULT_SYSTEM_PROMPT` di `aiAgent.ts` sangat panjang dan hardcoded. | `routes/aiAgent.ts:38` | Sulit di-maintain | Pindah ke file `.txt` atau DB (sudah ada fallback mechanism) |
| L8 | LOW | B1 | Frontend Code | Naming inconsistency: beberapa file campur `kebab-case` dan `camelCase` untuk page routes. | `artifacts/bizportal/src/pages/` | Developer confusion | Standardize ke `kebab-case` untuk file names |

---

## B. DEPENDENCY MAP

```
C10 (Portal Admin bypass)
  └── harus fix sebelum → C2 (Ecommerce auth), H2 (logistic endpoints)

C1 (trading.ts no auth)
  └── harus fix sebelum → H5, H6 (DB constraints) ← constraints tidak ada artinya jika auth tidak ada

C4 (POST /logistic/orders unprotected)
  └── harus fix sebelum → H11 (duplicate order check) ← idempotency tidak efektif tanpa auth anchor

C7 (vendor-confirm non-atomic)
  └── harus fix sebelum → H7 (TOCTOU vendor response) ← keduanya di flow vendor confirm

C8 (vendorPrice leak)
  └── independen, fix segera

C5 (cross-company order leak)
  └── harus fix sebelum → M10 (tracking endpoint) ← tracking endpoint juga butuh ownership check

H6 (salesDocuments unique on logisticOrderId)
  └── harus fix sebelum → H9 (FK constraints) ← FK tidak bisa ditambah sebelum data konsisten

H5, H8, H10 (DB indexes)
  └── independen dari security fixes, bisa paralel

M1, M2, M3 (frontend cache)
  └── independen, bisa dikerjakan paralel dengan backend fixes

M6 (rate limiter persistent)
  └── harus fix setelah → H8 (AI agent auth) ← prioritaskan auth dulu, rate limit sebagai defense-in-depth

C3, H11 (duplicate order)
  └── C3 fix ecommerce, H11 fix logistic — independen satu sama lain
```

**Dependency Chain Kritis:**
```
C10 → C1, C2, C4, C9
         ↓
      H1, H2, H3
         ↓
      C7 → H7
         ↓
      H6 → H9
         ↓
      H5, H10 (DB indexes)
         ↓
      M1–M12 (frontend + medium fixes)
         ↓
      L1–L8 (low priority)
```

---

## C. SAFE IMPLEMENTATION ORDER

### Phase 1 — Database Migration & Constraint (tidak breaking, bisa deploy kapan saja)
```
1. H6  → Tambah uniqueIndex salesDocuments.logisticOrderId
2. H9  → Tambah FK freightAttachments.invoiceId, salesDocuments.taxRateId/warehouseId
3. M9  → Tambah FK products.defaultSalesTaxId/defaultPurchaseTaxId
4. H5  → Tambah index ordersTable (customerEmail, status, companyId, createdAt)
5. H10 → Tambah index salesDocumentsTable (customerId, logisticOrderId, companyId, status)
6. M8  → Tambah index ordersTable.customerEmail, status
7. L6  → Tambah index mediaAssetsTable.folder, uploadedBy
```

### Phase 2 — Security & Auth (backend, high priority)
```
8.  C10 → Fix requirePortalAdmin: jika env kosong, tolak semua
9.  C1  → Tambah requireClerkUser + requireAdmin di trading.ts
10. C2  → Pisah public vs admin route di ecommerce.ts, tambah auth
11. C4  → Tambah requireClerkUser di POST /logistic/orders
12. C9  → Tambah requireAdmin di POST/PUT/DELETE /vendors (logisticOrders)
13. H1  → Tambah requireClerkUser di GET /logistic-vendors
14. H2  → Tambah requireClerkUser di GET /trucking-rates, /vendors, /:id/locations
```

### Phase 3 — Backend API (logic fixes)
```
15. C5  → Tambah ownership validation di GET /logistic/orders/:id
16. C6  → Tambah requireClerkUser di GET /logistic/:id/quotes
17. C7  → Wrap vendor-confirm dalam DB transaction tunggal
18. C8  → Strip vendorPrice dari response approve-form customer
19. H3  → Whitelist/validasi domain mediaUrl di webhooks.ts
20. H7  → Pindahkan 5-menit guard ke DB transaction level
21. H11 → Ganti email-based duplicate check dengan idempotency key
22. C3  → Tambah idempotency di POST /ecommerce/orders
23. M10 → Strip driver detail dari toPublicOrder()
24. M12 → Tambah messageId dedup di webhook Fonnte
```

### Phase 4 — Frontend Cache & Refetch
```
25. M1  → Ganti refetch() → invalidateQueries di logistics-portal-order-detail
26. M2  → Tambah invalidasi vendor detail key di purchase/vendors.tsx
27. M3  → Buat QUERY_KEYS konstanta terpusat, replace hardcoded strings
28. M4  → Replace silent catch dengan error toast
29. M5  → Disable all UI triggers saat submitting di customer-quote.tsx
```

### Phase 5 — UI/UX
```
30. H4  → Pindahkan hardcoded WA template di webhooks.ts ke DB
31. L4  → Parse API error message di form error handlers
32. L5  → Tambah validasi estimatedDays di vendor-quote-form
33. L1  → Fetch unit/kategori dari API atau shared constants
```

### Phase 6 — Tests
```
34. Test seluruh Phase 1–3 dengan skenario di Section E
```

### Phase 7 — Documentation
```
35. L2  → Hapus session ID partial logging
36. L3  → Ekstrak upload hook
37. L7  → Pindahkan system prompt ke file/DB
38. L8  → Standardize file naming
```

---

## D. DO NOT BREAK LIST

Berikut fitur yang sudah **PASS** dalam audit dan **tidak boleh diubah** tanpa testing ulang penuh:

| # | Fitur | Mengapa Dilindungi | File Kunci |
|---|-------|--------------------|-----------|
| DNB1 | **Price Sync BizPortal → Customer Portal** | Sudah berjalan dengan `POST /api/ecommerce/sync-prices`. Jangan ubah struktur response atau field naming ecommerce products. | `routes/ecommerce.ts` — `sync-prices`, `bizportal/src/pages/ecommerce/` |
| DNB2 | **Mini Form Links (VMF)** | Short link `/q/:code` → vendor mini form sudah berjalan dan digunakan oleh operasional. Jangan ubah token format atau route prefix. | `routes/index.ts` — `/q/:code`, `routes/vendorMiniForm.ts` |
| DNB3 | **Existing Order Data** | Semua data order existing di DB harus tetap queryable. Migration schema tidak boleh DROP atau ALTER kolom existing secara destructive. | `lib/db/src/schema/logisticOrders.ts`, `orders.ts`, `salesDocuments.ts` |
| DNB4 | **Customer Portal Display** | Homepage, mega menu, kalkulator freight, i18n (EN/ID) sudah live. Jangan ubah public API shape di `/api/ecommerce/products` dan portal content endpoints. | `artifacts/customer-portal/src/`, `routes/ecommerce.ts` |
| DNB5 | **WA Template Settings (DB-stored)** | Template WA yang sudah tersimpan di DB (`waTemplates` table) tidak boleh di-overwrite oleh hardcoded fallback tanpa explicit opt-in. | `routes/whatsapp.ts` — `getWaTemplateConfig()` |
| DNB6 | **Double-Entry Accounting Auto-Journal** | Setiap konfirmasi transaksi auto-generate accounting entries. Jangan ubah trigger logic di `postStockReceived`, `postOrderConfirmed`, atau voucher creation. | `lib/accounting.ts`, `routes/trading.ts`, `routes/ecommerce.ts` |
| DNB7 | **Vendor Confirm Token (HMAC)** | Token HMAC untuk vendor response sudah digunakan di WA link yang sudah terkirim. Jangan ubah algoritma atau secret tanpa invalidate semua link lama dulu. | `lib/vendorToken.ts`, `routes/vendorResponse.ts` |
| DNB8 | **Google OAuth / OIDC Login Flow** | Login BizPortal internal via Google OIDC sudah berjalan. Jangan ubah callback URL, session cookie name, atau session structure. | `routes/auth.ts`, `middlewares/authMiddleware.ts` |
| DNB9 | **RLS Deny Policies (57 tables)** | `rlsMigration.ts` sudah apply deny policy ke 57 tabel. Jangan remove atau relax policy ini. Hanya boleh tambah whitelist rule baru. | `lib/rlsMigration.ts` |
| DNB10 | **POS Kasir Flow** | Login kasir, session POS, dan flow transaksi kasir sudah digunakan operasional. Jangan ubah `/api/ecommerce/pos/*` atau `kasir` auth tanpa testing di POS device. | `routes/ecommerce.ts` — POS routes, `artifacts/bizportal/src/pages/pos/` |

---

## E. TEST PLAN AFTER FIX

### Untuk setiap Critical Fix:

**C1 — trading.ts auth:**
- [ ] Unauthenticated `POST /api/trading/stocks` harus return 401
- [ ] Authenticated non-admin `DELETE /api/trading/suppliers/:id` harus return 403
- [ ] Authenticated admin berhasil lakukan CRUD

**C2 — ecommerce.ts auth:**
- [ ] `GET /api/ecommerce/orders` tanpa token harus return 401
- [ ] Customer portal user tidak bisa akses admin order list
- [ ] POS kasir flow masih berjalan normal (DNB10)

**C3 — Ecommerce duplicate order:**
- [ ] POST checkout 2x dalam 5 detik dengan idempotency key sama → hanya 1 order terbuat
- [ ] POST checkout dengan key berbeda → 2 order terbuat (expected)
- [ ] WhatsApp notif hanya terkirim 1x per order

**C4 — POST /logistic/orders unprotected:**
- [ ] Request tanpa auth header → 401
- [ ] Authenticated user berhasil create order
- [ ] Bot flood test: 10 request/detik dari IP sama → rate limited

**C5 — Cross-company order leak:**
- [ ] User Company A request `GET /logistic/orders/{id_order_Company_B}` → 403 atau 404
- [ ] User Company A request ordernya sendiri → 200

**C6 — GET /logistic/:id/quotes:**
- [ ] Tanpa auth → 401
- [ ] Dengan auth staff → 200 dengan data quotes

**C7 — vendor-confirm atomic:**
- [ ] Simulate 2 concurrent vendor confirm request untuk order sama → hanya 1 berhasil, `approvedQuoteId` match `finalPrice`
- [ ] DB dalam state konsisten setelah concurrent test

**C8 — vendorPrice leak:**
- [ ] Response `/approve-form` tidak mengandung field `vendorPrice`, `costBreakdown`, atau margin fields
- [ ] Internal BizPortal view masih bisa lihat vendor price

**C9 — vendor management unprotected:**
- [ ] Unauthenticated `POST /api/logistic/vendors` → 401
- [ ] Admin authenticated → berhasil CRUD vendor

**C10 — requirePortalAdmin bypass:**
- [ ] Set `PORTAL_ADMIN_EMAILS=""` → semua request ke portal admin endpoint → 403
- [ ] Set `PORTAL_ADMIN_EMAILS="admin@cst.com"` → hanya email itu yang lolos

### Untuk setiap High Fix:

**H3 — SSRF webhook:**
- [ ] Payload dengan `mediaUrl: "http://169.254.169.254/latest/meta-data/"` → request ditolak
- [ ] Payload dengan `mediaUrl: "https://api.fonnte.com/media/..."` → diproses normal

**H6 — uniqueIndex salesDocuments.logisticOrderId:**
- [ ] Insert 2 salesDocument dengan `logisticOrderId` sama → DB error (unique violation)
- [ ] Existing data tidak ada konflik (check sebelum apply migration)

**H7 — TOCTOU vendor response:**
- [ ] 2 concurrent `POST /vendor-response/:orderNumber` dalam 1 detik → hanya 1 tersimpan

**H8 — AI agent upload:**
- [ ] Upload tanpa session token → 401
- [ ] Upload dengan valid session → 200

### Untuk setiap Medium Fix:

**M1 — Cache invalidation:**
- [ ] Update status order → order list di dashboard refresh otomatis tanpa hard reload

**M5 — Double submission:**
- [ ] Click submit 2x cepat di customer-quote → hanya 1 request terkirim

**M12 — WA webhook dedup:**
- [ ] Fonnte retry dengan `messageId` sama → hanya 1 notif diproses

### Regresi Wajib (DNB Validation):
- [ ] **DNB1**: Sync prices dari BizPortal → Customer Portal masih berjalan
- [ ] **DNB2**: Short link `/q/:code` masih redirect ke VMF yang benar  
- [ ] **DNB4**: Customer portal homepage, kalkulator, mega menu tampil normal
- [ ] **DNB6**: Konfirmasi order masih auto-generate journal akuntansi
- [ ] **DNB7**: Vendor HMAC token link dari WA lama masih bisa diakses
- [ ] **DNB8**: Login Google di BizPortal masih berjalan
- [ ] **DNB10**: POS kasir login dan transaksi masih normal

---

## F. FINAL RECOMMENDATION

### Fix Sekarang (Before Any Go-Live / Production)

Ini adalah **showstopper**. Jika sistem sudah production, bisa dieksploitasi hari ini:

| Issue | Alasan Urgent |
|-------|---------------|
| **C1** — trading.ts no auth | Siapapun bisa hapus supplier atau manipulasi stok |
| **C2** — ecommerce.ts no auth | PII semua customer ter-expose ke publik |
| **C3** — ecommerce duplicate order | Double billing customer, double notif admin |
| **C4** — POST /logistic/orders unprotected | Database bisa di-flood dengan order palsu |
| **C5** — Cross-company order leak | Pelanggaran data antar tenant |
| **C7** — vendor-confirm non-atomic | Invoice amount bisa salah setelah race condition |
| **C8** — vendorPrice leak | Margin bisnis ter-expose ke customer |
| **C9** — vendor management unprotected | Vendor bisa dihapus tanpa auth |
| **C10** — requirePortalAdmin bypass | Admin portal bisa di-claim oleh user manapun |

**Estimasi effort:** 2–3 hari developer (kebanyakan tambah middleware + 1 DB transaction fix)

---

### Fix Nanti (Sprint 1–2, dalam 2 minggu)

Penting untuk stability dan keamanan lanjutan, tapi tidak immediately exploitable oleh attacker external:

| Issue | Alasan Bisa Nanti |
|-------|-------------------|
| **H1, H2** — endpoint unprotected | Memerlukan internal access, bukan data sensitif level C |
| **H3** — SSRF webhook | Hanya trigger via Fonnte payload yang harus punya valid token dulu |
| **H4** — WA template hardcoded | Operational issue, bukan security risk langsung |
| **H5–H10** — DB indexes + FK | Performance & integrity, tidak breaking saat ini |
| **H11** — duplicate order logistic | Sudah ada 60s guard, belum ada laporan duplicate |
| **M1–M12** — frontend cache & medium | UX issues, tidak data-breaking |

---

### Cukup Dokumentasi (Low Priority, tidak perlu sprint khusus)

Boleh dikerjakan secara incremental saat ada waktu luang:

| Issue | Alasan Cukup Dokumentasi |
|-------|--------------------------|
| **L1** — hardcoded unit list | Tidak menyebabkan error, hanya inkonsistensi |
| **L2** — session ID partial log | Sangat low risk (hanya 8 char), sudah truncated |
| **L3** — duplikasi upload logic | Technical debt, tidak menyebabkan bug |
| **L7** — system prompt hardcoded | DB override sudah ada, fallback berfungsi |
| **L8** — naming inconsistency | Refactor cosmetic, risiko regresi lebih besar dari manfaat |

---

## Ringkasan Eksekutif

```
Total Issue      : 35
├── Critical     : 10  → Fix SEKARANG
├── High         : 11  → Fix Sprint 1 (2 minggu)
├── Medium       : 12  → Fix Sprint 2-3
└── Low          : 8   → Incremental / Dokumentasi

Paling Berbahaya : C1, C2, C4 (No auth di trading + ecommerce + logistic create)
Paling Kompleks  : C7 (DB transaction refactor vendor-confirm)
Paling Cepat     : C8 (strip 1 field dari response), C10 (1 baris kondisi)
Tidak Boleh Diubah: 10 fitur (DNB1–DNB10)
```

---

*Dokumen ini adalah planning only. Tidak ada implementasi yang boleh dilakukan tanpa konfirmasi eksplisit dari owner.*
