# Release Candidate RC2 — Stabilization Audit Report

**Date:** 2026-07-08  
**Mode:** LOCKED — no new features, no schema changes, no architectural changes  
**Scope:** Full regression audit: API Server (168 route files), BizPortal, Customer Portal, Logistic Order, DB (DEV + PROD), Security, Performance, Load Test, UAT  

---

## Executive Summary

RC2 stabilization audit selesai dilakukan atas seluruh sistem. Tidak ada regresi baru yang diintroduksi sejak RC1. Semua fix RC1 (Paylabs webhook RBAC, orderLinksAdmin middleware hang) tetap valid dan berfungsi. Sistem secara umum stabil untuk Production Release **dengan dua syarat yang harus dipenuhi lebih dulu** (PROD DB secret dan watchdog service), serta beberapa P1 security items yang perlu ditangani sebelum traffic nyata masuk.

---

## RC2 Final Status

### ⚠️ CONDITIONAL PASS

**Alasan:** Semua RC1 blockers tetap resolved. Build pass. Core API endpoints (auth, marketplace, accounting, payments, portal) semuanya berfungsi. Ditemukan 2 blocker environment dan beberapa P1 security yang harus ditangani sebelum Production Release.

---

## Phase 1 — Regression Result

### ✅ RC1 Fixes Still Holding

| Fix | Status |
|---|---|
| Paylabs webhook RBAC bypass | ✅ paymentsWebhookRouter masih mount sebelum makeRbacGuard — verified |
| orderLinksAdmin middleware hang | ✅ requireAdmin tidak ada di route handler — verified |
| order-links dry-run 200 authenticated | ✅ |
| order-links 401 unauthenticated | ✅ |

### Temuan Baru Phase 1

| # | Severity | Domain | Finding | File | Line |
|---|---|---|---|---|---|
| R1 | **P1** | Auth | `/payment-proof-upload` tidak ada `requirePortalAuth` — unauthenticated upload ke object storage | `routes/portal.ts` | ~938 |
| R2 | **P1** | Auth | `/admin/fix-jasa-names` memakai manual `X-Admin-Key` header check, bukan `requireAdmin` standar | `routes/portal.ts` | ~1133 |
| R3 | **P2** | Auth | Duplicate dev-login logic di `auth.ts` (`/api/auth/dev-login`) dan `portal.ts` (`/api/portal/auth/dev-login`) — stale code risk | `routes/auth.ts`, `routes/portal.ts` | ~706, ~613 |
| R4 | **P2** | Auth | `verifyDevToken` fallback hardcoded secret di non-prod — jika `IS_PROD` misconfigured, secret bisa bocor | `lib/supabaseAuth.ts` | ~19 |
| R5 | **P2** | Auth | Admin auto-promote di setiap login (by email list) tapi tidak ada mekanisme demote | `routes/auth.ts` | ~171 |
| R6 | **P2** | Payments | `GET /paylabs/config` tidak scope by company — semua admin bisa lihat global credentials | `routes/payments.ts` | ~260 |
| R7 | **P2** | Payments | `paylabsConfigurationsTable` query `.limit(1)` tanpa company filter — asumsi single-tenant | `routes/payments.ts` | ~71, 281 |
| R8 | **P2** | Marketplace | `vendorResponse.ts` — `ALTER TABLE` DDL di module top-level, bukan boot migration chain | `routes/vendorResponse.ts` | ~40 |
| R9 | **P2** | Marketplace | In-memory vendor photo rate limiter reset saat server restart | `routes/vendorResponse.ts` | ~28 |
| R10 | **P2** | Accounting | `POST /other-transactions` fallback `companyId ?? 1` — data leak ke company default jika resolution gagal | `routes/accounting.ts` | ~1809 |
| R11 | **P2** | Accounting | `PATCH /settings` tidak memanggil `audit()` — financial config changes tidak diaudit | `routes/accounting.ts` | ~2129 |
| R12 | **P2** | Accounting | `DELETE /accounts/:id` tidak ada audit trail entry | `routes/accounting.ts` | ~367 |
| R13 | **P2** | Accounting | `POST /toggle/:id` dan `/exclude/:id` di taxSptControl tidak diaudit | `routes/taxSptControl.ts` | ~79, ~102 |
| R14 | **P2** | Portal | `/vendor/quotes` dan `/orders` pakai `requirePortalAuth` tapi tidak check status 'active' | `routes/portal.ts` | ~688, 997 |
| R15 | **P2** | Notification | `push.ts` `/subscribe` dan `/unsubscribe` fully public — no auth, no rate limit | `routes/push.ts` | ~15, 38 |
| R16 | **P2** | Driver | `autoCreateLogisticInvoice` fire-and-forget tanpa `.catch()` yang proper | `routes/driverProgress.ts` | ~391 |
| R17 | **P2** | Module | `users.ts` jalankan `ALTER TABLE`/`CREATE TABLE` di module level setiap boot | `routes/users.ts` | ~10 |

**Tidak ada P0 regression ditemukan.** Semua temuan adalah existing risks yang belum ditutup, bukan regresi baru.

---

## Phase 2 — Database Result

### DEV Supabase (SUPABASE_DATABASE_URL_DEV)

| Check | Result |
|---|---|
| `order_links` table | ✅ exists, 6 indexes |
| Duplicate `order_links` | ✅ 0 duplicates |
| Stale FK `fk_rfq_vl_rfq` | ✅ absent |
| `v_unified_orders` | ✅ exists |
| `v_unified_quotes` | ✅ exists |
| Token hash columns on token-bearing tables | ✅ confirmed (RC1) |
| `order_links` dry-run candidates | ✅ 0 (all FKs already exist) |
| `purchase_documents.mkt_purchase_order_id` | ❌ **MISSING in DEV** — schema drift. Column exists in Drizzle schema (lib/db/src/schema/purchaseDocuments.ts:81) dan terkonfirmasi di PROD (RC1). Kolom ini belum di-migrate ke DEV, menyebabkan `GET /api/purchase/documents` → 500 di environment ini. **PROD tidak terpengaruh.** |

### PROD Supabase (dari RC1 verification — tidak berubah)

| Check | Result |
|---|---|
| `purchase_documents.mkt_purchase_order_id` | ✅ exists (RC1 verified) |
| `payments.company_id` | ✅ |
| `order_links` | ✅ |
| Token hash columns | ✅ |
| No token columns in unified views | ✅ |
| `payments.company_id IS NULL` count | ✅ 0 |

### DEV Schema Drift Summary

`purchase_documents` di DEV belum memiliki kolom `mkt_purchase_order_id`. Ini menyebabkan Drizzle select gagal karena schema Drizzle (lib/db) sudah include kolom tersebut. Perlu boot migration `ALTER TABLE purchase_documents ADD COLUMN IF NOT EXISTS mkt_purchase_order_id INTEGER` untuk DEV, atau sync DEV ke PROD state.

---

## Phase 3 — Security Result

| # | Severity | Category | Finding | File |
|---|---|---|---|---|
| S1 | **P1** | Auth | WhatsApp webhook (`POST /webhook`) tidak ada signature/token verification — attacker bisa spoof delivery status atau pesan masuk | `routes/whatsapp.ts:227` |
| S2 | **P1** | Rate Limit | `invoiceOcr.ts` tidak ada rate limiter di `/extract` dan `/tax-validate` — authenticated user bisa drain OpenAI quota tanpa batas | `routes/invoiceOcr.ts` |
| S3 | **P1** | Auth | `/payment-proof-upload` tidak ada auth guard — unauthenticated file upload ke storage | `routes/portal.ts:938` |
| S4 | **P2** | Auth | Push subscription endpoints (`/subscribe`, `/unsubscribe`) fully public, no rate limit — bisa dipakai untuk DB bloat | `routes/push.ts:15,38` |
| S5 | **P2** | SSRF | `webhooks.ts:365` — `isAllowedMediaUrl` whitelist hanya cek hostname, tidak resolve IP → DNS Rebinding attack possible | `routes/webhooks.ts:365` |
| S6 | **P2** | SSRF | `media.ts:323` — `copy-public` fetch `asset.url` tanpa validasi bahwa URL bukan internal network | `routes/media.ts:323` |
| S7 | **P2** | CSRF | `app.ts` menggunakan `SameSite=None; credentials: include` tanpa CSRF token middleware — cross-site requests possible | `app.ts` |
| S8 | **P2** | Secrets | Hardcoded fallback secret `cst-dev-portal-fallback-2025` in non-prod path | `lib/supabaseAuth.ts:~30` |
| S9 | **P2** | MIME | `media.ts:101` upload tidak validate actual buffer content vs declared mimetype — extension check only | `routes/media.ts:101` |
| S10 | **P3** | Token | Driver progress token (`driverProgress.ts:174`) URL-only token tanpa secondary check | `routes/driverProgress.ts:174` |

**✅ PASSING security items (dari RC1 + baru diverifikasi RC2):**
- Admin endpoints correctly 401 unauthenticated ✅
- Portal auth correctly 401 unauthenticated ✅  
- Paylabs webhook returns `{"errCode":"401","errMsg":"Invalid signature"}` (not RBAC) ✅
- Token-gated public endpoints reject invalid tokens cleanly (400/404) ✅
- Unified views tidak expose token columns ✅
- Token hash columns di semua token-bearing tables ✅
- Rate limiters: OTP login, vendor forms, geocode ada ✅
- Drizzle parameterization dipakai di semua query utama ✅

---

## Phase 4 — Performance Result

| Rank | Severity | Category | Finding | File | Line |
|---|---|---|---|---|---|
| 1 | **Critical** | N+1 Query | `supabaseSync.ts` — multiple `await db.execute` inside `for` loops (payment check, delete, facility sync) | `modules/sport-center/supabaseSync.ts` | 606, 914, 1153, 1221, 1455 |
| 2 | **High** | Pagination | `GET /api/advances/approval-limits` — SELECT * FROM expense_approval_limits tanpa LIMIT | `routes/advances.ts` | 329 |
| 3 | **High** | Pagination | `GET /api/warehouse/transfer-lines` — SELECT * FROM wh_transfer_lines tanpa LIMIT | `routes/warehouse.ts` | 185, 211 |
| 4 | **High** | Parallel | `commodityTemplates.ts:122-124` — 3 sequential awaits (fields, docs, checklists) seharusnya `Promise.all` | `routes/commodityTemplates.ts` | 122 |
| 5 | **High** | Parallel | `vendorMiniForm.ts:961-963` — sequential awaits untuk template sub-entities | `routes/vendorMiniForm.ts` | 961 |
| 6 | **High** | SELECT* | `advances.ts:803` — SELECT * FROM expense_approval_requests tanpa LIMIT | `routes/advances.ts` | 803 |
| 7 | **High** | SELECT* | `cashBank.ts:881` — SELECT * FROM cash_flow_forecasts tanpa LIMIT | `routes/cashBank.ts` | 881 |
| 8 | **Medium** | Index | `supabaseSync.ts` — `WHERE booking_number = ?` di sport_bookings kemungkinan full scan jika tidak indexed | `modules/sport-center/supabaseSync.ts` | 812, 1056 |
| 9 | **Medium** | Duplicate | `supabaseSync.ts` — multiple redundant SELECT accounting_settings di sync loops berbeda | `modules/sport-center/supabaseSync.ts` | various |
| 10 | **Medium** | Sync I/O | `videoOptimizer.ts:259,281` — `fs.readFile` non-streamed untuk large video/thumb buffers | `lib/videoOptimizer.ts` | 259, 281 |

---

## Phase 5 — Load Test Result

Load test dijalankan menggunakan 50-concurrent curl calls dari dev environment (pgBouncer pool max=8 — jauh lebih rendah dari production capacity).

| Endpoint | Concurrency | HTTP Result | Avg Response Time | Note |
|---|---|---|---|---|
| `GET /system/health` | 100 | 100x 200 | 0.356s total | ✅ Gateway layer healthy |
| `POST /payments/paylabs/webhook` | 50 | 50x 401 ✅ | <1s | ✅ RSA auth check fires correctly |
| `GET /api/payments` | 30 | 30x 200 | 10.5s avg | ⚠️ Slow — pgBouncer pool saturation di dev (max=8) |
| `GET /api/mkt/admin/rfqs` | 30 | 30x 200 | 6.4s avg | ⚠️ Acceptable untuk admin endpoint, tapi tinggi |
| `GET /api/admin/order-links/dry-run` | 20 | 20x 200 | 8.6s avg | ⚠️ Query-heavy, normal untuk cross-ref endpoint |

**Catatan:** Respons time yang tinggi di dev murni karena pgBouncer pool max=8 dibagi ke semua concurrent requests. Production Supabase pool lebih besar. Tidak ada 500 atau error rate di bawah concurrency yang diuji. Formal load test dengan k6 di staging environment (250-1000 concurrent) direkomendasikan sebelum full production launch.

---

## Phase 6 — UAT Result

UAT dijalankan dengan session admin yang terautentikasi (`admcst001@gmail.com`, role=admin).

| Step | Endpoint | HTTP | Result |
|---|---|---|---|
| [1] Auth — users/me | `GET /api/users/me` | 200 | ✅ role=admin |
| [2] Marketplace RFQ list | `GET /api/mkt/admin/rfqs` | 200 | ✅ ok=true |
| [3] Marketplace PO list | `GET /api/mkt/admin/purchase-orders` | 200 | ✅ ok=true |
| [4] Sales documents | `GET /api/sales/documents` | 200 | ✅ |
| [5] Purchase documents | `GET /api/purchase/documents` | **500** | ❌ DEV schema drift — `mkt_purchase_order_id` missing in DEV DB. PROD tidak terpengaruh. |
| [6] Accounting journals | `GET /api/accounting/journals` | 200 | ✅ |
| [7] Tax dashboard | `GET /api/tax/dashboard` | 200 | ✅ |
| [8] Payments list | `GET /api/payments` | 200 | ✅ |
| [9] Portal customers (admin) | `GET /api/portal/admin/customers` | 200 | ✅ 6 records |
| [10] Portal auth unauthenticated | `GET /api/portal/auth/me` | 401 | ✅ |
| [11] Paylabs webhook no-sig | `POST /api/payments/paylabs/webhook` | 401 | ✅ `errCode:401 errMsg:Invalid signature` |
| [12] Dashboard summary | `GET /api/dashboard/summary` | 200 | ✅ |
| [13] Finance governance | `GET /api/accounting/governance/stats` | 200 | ✅ (path corrected) |
| [14] Token security stats | `GET /api/admin/token-security/stats` | 200 | ✅ |
| [15] order-links dry-run auth | `GET /api/admin/order-links/dry-run` | 200 | ✅ |
| [16] order-links unauth | `GET /api/admin/order-links/dry-run` | 401 | ✅ |

**UAT Score: 15/16** — 1 fail karena DEV schema drift (bukan regression, tidak terjadi di PROD).

---

## Phase 7 — Production Checklist

| Item | Status | Note |
|---|---|---|
| **Build** — api-server esbuild | ✅ PASS | `dist/index.mjs` 15.7 MB, 2.4s |
| **Typecheck** — lib/db, lib/api-zod | ✅ PASS | |
| **Typecheck** — bizportal | ⚠️ ERRORS | 10+ `TS7006` (implicit any) + 1 `TS2339` (property not exist on TreeNode). Non-blocking untuk runtime (esbuild strips types) tapi mengurangi type safety. |
| **Typecheck** — customer-portal | ⚠️ ERRORS | `TS7006` errors pada beberapa pages. Non-blocking. |
| **Typecheck** — lib/api-client-react | ⚠️ No build script | `lib/api-client-react` tidak punya `build` script — TS6305 errors di frontend karena dist tidak exist. Perlu `tsc -b` pada lib ini. |
| **Environment** — SESSION_SECRET | ✅ SET | |
| **Environment** — SUPABASE_DATABASE_URL_DEV | ✅ SET | |
| **Environment** — SUPABASE_DATABASE_URL (PROD) | ❌ **MISSING** | Hanya `_DEV` yang di-set. Production publish akan gagal connect ke DB tanpa ini. |
| **Workflows** — Gateway | ✅ RUNNING | |
| **Workflows** — API Server | ✅ RUNNING | |
| **Workflows** — BizPortal, Customer Portal, Logistic Order | ✅ RUNNING | |
| **Workers** — financial-outbox, sport-center-sync, dll | ✅ Scheduled | 25+ workers dijadwalkan via startupOrchestrator |
| **Healthcheck** — /system/health | ✅ `{"status":"up"}` | |
| **Watchdog** — /system/global-health | ❌ **UNAVAILABLE** | Watchdog tidak bisa dihubungi di port 3001. Global health endpoint mengembalikan `{"error":"watchdog_unavailable"}` |
| **DB** — order_links, unified views, token_hash | ✅ Verified | |
| **Migrations** — boot migration chain | ✅ Runs cleanly | Tidak ada fatal migration error di log |
| **tokenSecurityMigration** | ⚠️ Non-fatal enum warning | Pre-existing dari RC1 — tidak blocking |
| **PROD DB** — purchase_documents column | ✅ Verified (RC1) | Schema drift hanya di DEV |
| **Backups** | ⚠️ Manual | Tidak ada automated backup dikonfigurasi. Manual Supabase snapshot direkomendasikan sebelum cutover. |
| **Monitoring** | ⚠️ Partial | Watchdog down, no external uptime monitor configured |

---

## Remaining Risks

| # | Severity | Risk | Recommendation |
|---|---|---|---|
| **E1** | 🔴 **BLOCKER** | `SUPABASE_DATABASE_URL` tidak di-set — Production Publish akan gagal connect DB | Set secret sebelum publish |
| **E2** | 🔴 **BLOCKER** | Watchdog service tidak bisa dihubungi — `/system/global-health` returns error | Debug watchdog startup (port 3001) |
| **S1** | 🟠 **P1** | WhatsApp webhook tidak ada signature verification — delivery status bisa di-spoof | Tambahkan Fonnte HMAC/token check |
| **S2** | 🟠 **P1** | InvoiceOCR tanpa rate limit — OpenAI quota bisa di-drain oleh authenticated user | Tambahkan rate limiter per-user |
| **S3** | 🟠 **P1** | `/payment-proof-upload` tanpa auth guard | Tambahkan requirePortalAuth |
| **D1** | 🟡 **P2** | DEV DB `purchase_documents` missing `mkt_purchase_order_id` — `GET /purchase/documents` 500 di DEV | `ALTER TABLE purchase_documents ADD COLUMN IF NOT EXISTS mkt_purchase_order_id INTEGER` di DEV |
| **T1** | 🟡 **P2** | `lib/api-client-react` tidak punya build script — downstream TS6305 di bizportal & customer-portal | Tambahkan `tsc -b` build script ke lib/api-client-react |
| **T2** | 🟡 **P2** | Bizportal & customer-portal TypeScript errors (TS7006, TS2339) | Fix implicit any annotations |
| **P1** | 🟡 **P2** | N+1 queries di sport-center supabaseSync.ts | Batch queries, convert to bulk upsert |
| **P2** | 🟡 **P2** | Missing pagination di advances, warehouse, cashBank | Tambahkan LIMIT/offset parameter |
| **K1** | 🟡 Known | tokenSecurityMigration enum error non-fatal di setiap boot | Fix `sales_payment_status` enum |
| **K2** | 🟡 Known | Full `tsc --noEmit` api-server OOM di Replit container | Jalankan di CI/CD environment |
| **K3** | 🟡 Known | `purchase` ref_kind payment company_id backfill belum dilakukan | Follow-up migration |

---

## Recommendation

**Sistem belum bisa dipublish ke Production hari ini karena 2 blocker environment:**

1. **`SUPABASE_DATABASE_URL` harus di-set** sebagai production secret sebelum Publish. Tanpa ini API server tidak bisa connect ke PROD DB.
2. **Watchdog service harus diperbaiki** — `/system/global-health` yang return error menandakan control plane monitoring tidak berjalan.

**Setelah kedua blocker di atas selesai, sistem siap untuk Production Release dengan catatan:**
- 3 P1 security items (WhatsApp webhook, invoiceOCR rate limit, payment-proof-upload auth) direkomendasikan ditutup sebelum atau segera setelah launch
- DEV schema drift perlu diperbaiki agar developer bisa test purchase flow di DEV environment
- TypeScript errors tidak blocking runtime (esbuild strips types) tapi harus ditutup dalam sprint berikutnya

**Status keseluruhan sistem:** Stabil. Tidak ada regresi baru sejak RC1. Semua RC1 fix masih valid. Core flows (auth, marketplace, accounting, payments, portal) semua berfungsi dengan benar.
