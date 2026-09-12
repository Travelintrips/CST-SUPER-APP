# FINAL STARTUP SECRET AUDIT
## PORTAL_ADMIN_KEY & CASHIER_TOKEN_SECRET — Fail-Closed Analysis

**Tanggal Audit:** 2026-08-03  
**Environment:** Development  
**Auditor:** Replit Agent (autonomous security audit)  
**Basis:** Master Prompt Final Production Hardening — 18 Phases

---

## 1. Secret Usage

### PORTAL_ADMIN_KEY

| File | Function / Endpoint | Dipakai untuk |
|------|---------------------|---------------|
| `src/lib/startupValidator.ts` | `INTEGRATION_SECRETS` | Startup warning jika tidak ada |
| `src/lib/appSecrets.ts:78` | `getSetting("portal_admin_key", ...)` | Runtime config lookup (fallback ke env) |
| `src/lib/appSecrets.ts:258` | `getAppConfig("PORTAL_ADMIN_KEY")` | Ambil nilai dari DB atau env |
| `src/lib/vendorResponseToken.ts:4` | `getSecret()` | HMAC secret untuk vendor response token (fallback ke SESSION_SECRET) |
| `src/routes/portal.ts:968-970` | `POST /api/portal/admin/claim` | Validasi kunci untuk klaim role admin portal customer |
| `src/routes/portal.ts:1371-1372` | Internal admin key check | Validasi kunci admin di route internal |
| `src/routes/translations.ts:34` | `PATCH /api/translations/:app/:locale` | Guard update terjemahan (header x-admin-key) |
| `src/routes/translations.ts:79` | `PUT /api/translations/:app/:locale/:key` | Guard update terjemahan single key |
| `src/modules/sport-center/routes.ts:4699` | `POST /api/sport-center/sync/accounting` | Bypass session auth (isKeyAuth = false jika env kosong → fall back ke requireAdmin) |
| `src/modules/sport-center/routes.ts:4728` | `POST /api/sport-center/accounting/deduplicate` | Bypass session auth (sama) |
| `src/modules/sport-center/routes.ts:4920-4922` | `POST /api/sport-center/sync/full-audit` | Guard internal audit endpoint |
| `src/modules/sport-center/routes.ts:5169` | `GET /api/sport-center/sync/accounting-debug` | Guard debug endpoint |
| `src/modules/sport-center/routes.ts:5397,5553` | Sync routes lain | Bypass session auth (sama) |

### CASHIER_TOKEN_SECRET

| File | Function | Dipakai untuk |
|------|----------|---------------|
| `src/lib/startupValidator.ts:138` | `REQUIRED_SECRETS` *(sebelum fix)* | Startup check — **hanya validasi keberadaan, tidak pernah digunakan** |
| `scripts/dump-env-to-dotenv.mjs:39` | Daftar env var | Dokumentasi / dump ke .env |
| `scripts/preflight-deployment.mjs:147` | Pre-flight check | Deployment pre-flight check |
| `scripts/validate-secret-rotation.mjs:153` | Secret rotation check | Rotasi secret audit |

**Kesimpulan:** `CASHIER_TOKEN_SECRET` **tidak pernah digunakan** di kode bisnis, auth, middleware, maupun route manapun. Ini adalah dead code di startup validator.

---

## 2. Dependency Graph

### PORTAL_ADMIN_KEY

```
PORTAL_ADMIN_KEY
├── vendorResponseToken.ts
│   └── signVendorResponseToken() / verifyVendorResponseToken()
│       └── Vendor response link di logistic order
│       [FALLBACK: SESSION_SECRET jika PORTAL_ADMIN_KEY kosong → tetap aman]
│
├── portal.ts — POST /api/portal/admin/claim
│   └── Customer portal admin role claim
│   [FAIL-CLOSED: 503 jika key kosong atau < 16 char]
│
├── portal.ts — internal admin key check
│   └── Route admin portal internal
│   [FAIL-CLOSED: 401 jika key kosong]
│
├── translations.ts — PATCH & PUT /api/translations/*
│   └── CMS translation bulk upsert / single update
│   [FAIL-CLOSED: 403 jika key kosong]
│
└── sport-center/routes.ts — sync/accounting, deduplicate, full-audit, accounting-debug
    ├── isKeyAuth bypass: false jika env kosong → fallback ke requireAdmin (session auth)
    ├── full-audit: 401 jika envKey kosong
    └── accounting-debug: 401 jika env kosong
    [ALL FAIL-CLOSED]
```

### CASHIER_TOKEN_SECRET

```
CASHIER_TOKEN_SECRET
└── startupValidator.ts (REQUIRED_SECRETS) — DEAD CODE
    └── Tidak terhubung ke modul, route, middleware, atau fitur apapun
```

---

## 3. Runtime Behavior

### Sebelum Fix

| Kondisi | Behavior |
|---------|----------|
| PORTAL_ADMIN_KEY kosong | `runStartupValidation()` throws → ditangkap oleh `.catch()` → log warn non-fatal → server tetap start |
| CASHIER_TOKEN_SECRET kosong | Sama seperti di atas — throw ditangkap, server tetap start |
| Startup log | `"SECRET WAJIB TIDAK DIKONFIGURASI"` (misleading — bukan benar-benar fatal) |

### Setelah Fix

| Kondisi | Behavior |
|---------|----------|
| PORTAL_ADMIN_KEY kosong | Log WARN: `"Integration secrets belum dikonfigurasi — fitur terkait tidak aktif"` |
| CASHIER_TOKEN_SECRET | Tidak dicek (removed — dead code) |
| Startup log | Akurat: warns tentang feature secrets, tidak ada error palsu "WAJIB" |

---

## 4. Fail-Open Audit

Setiap endpoint yang menggunakan `PORTAL_ADMIN_KEY` diperiksa apakah bisa diakses tanpa key:

| Endpoint | Behavior tanpa key | Fail-Open? |
|----------|--------------------|------------|
| `POST /api/portal/admin/claim` | `503 Service Unavailable` | ✅ NO (fail-closed) |
| Internal admin key check | `401 Unauthorized` | ✅ NO (fail-closed) |
| `PATCH /api/translations/:app/:locale` | `403 Forbidden` | ✅ NO (fail-closed) |
| `PUT /api/translations/:app/:locale/:key` | `403 Forbidden` | ✅ NO (fail-closed) |
| `POST /api/sport-center/sync/accounting` | isKeyAuth = false → requireAdmin (session required) | ✅ NO (fail-closed) |
| `POST /api/sport-center/accounting/deduplicate` | isKeyAuth = false → requireAdmin (session required) | ✅ NO (fail-closed) |
| `POST /api/sport-center/sync/full-audit` | `401 Unauthorized` | ✅ NO (fail-closed) |
| `GET /api/sport-center/sync/accounting-debug` | `401 Unauthorized` | ✅ NO (fail-closed) |
| Vendor response token (sign/verify) | Fallback ke SESSION_SECRET → tetap berfungsi | ✅ NO (graceful fallback) |

**Tidak ada endpoint yang fail-open.**

---

## 5. Fail-Closed Audit

Mekanisme fail-closed per endpoint:

| Endpoint / Module | Mekanisme | Status |
|-------------------|-----------|--------|
| `portal.ts:969-970` | `if (!PORTAL_ADMIN_KEY \|\| length < MIN_ADMIN_KEY_LEN) → 503` | ✅ FAIL-CLOSED |
| `portal.ts:1372` | `if (!adminKey \|\| key !== adminKey) → 401` | ✅ FAIL-CLOSED |
| `translations.ts:34` | `if (!adminKey \|\| adminKey !== process.env["PORTAL_ADMIN_KEY"]) → 403` | ✅ FAIL-CLOSED |
| `sport-center:4699,4728,5397,5553` | `isKeyAuth = adminKeyBypass && process.env.PORTAL_ADMIN_KEY && ...` — false jika env kosong → requireAdmin | ✅ FAIL-CLOSED |
| `sport-center:4920-4922` | `if (!envKey \|\| key !== envKey) → 401` | ✅ FAIL-CLOSED |
| `sport-center:5169` | `if (!key \|\| key !== process.env.PORTAL_ADMIN_KEY) → 401` | ✅ FAIL-CLOSED |
| `vendorResponseToken:4` | `process.env.PORTAL_ADMIN_KEY ?? process.env.SESSION_SECRET ?? ""` | ✅ GRACEFUL FALLBACK |

---

## 6. Startup Warnings

### Sebelum Fix
```
[startupValidator] SECRET WAJIB TIDAK DIKONFIGURASI — set di Replit Secrets
    missingSecrets: ["PORTAL_ADMIN_KEY", "CASHIER_TOKEN_SECRET"]
```
**Masalah:** Pesan menyebut "WAJIB" padahal error ditangkap non-fatal. Misleading bagi operator.

### Setelah Fix
```
[startupValidator] Integration secrets belum dikonfigurasi — fitur terkait tidak aktif
    missingIntegrationSecrets: ["PORTAL_ADMIN_KEY"]
```
**Akurat:** PORTAL_ADMIN_KEY adalah integration secret yang opsional. Log benar-benar merepresentasikan situasi.

### Phase 11 — Log Disclosure Check
Startup log hanya mencatat **nama** secret yang tidak ada, bukan **nilainya**. ✅ Aman.

---

## 7. Risk Assessment

| Secret | Klasifikasi | Risiko jika tidak ada | Dampak Core System |
|--------|-------------|----------------------|-------------------|
| SESSION_SECRET | REQUIRED | Server tidak start | Fatal — semua session auth gagal |
| PORTAL_ADMIN_KEY | OPTIONAL (integration) | Admin portal tidak bisa claim role; internal audit endpoints 401; translations write 403 | **Nol** — accounting, AI, bank recon tidak terpengaruh |
| CASHIER_TOKEN_SECRET | DEAD CODE | Tidak ada dampak | **Nol** — tidak digunakan di manapun |

**Fail-open risk: NONE.**  
**Core system risk: NONE.**

---

## 8. Production Recommendation

### Tindakan yang Diambil (Fix)

**File:** `artifacts/api-server/src/lib/startupValidator.ts`

1. **Dihapus dari `REQUIRED_SECRETS`:**
   - `CASHIER_TOKEN_SECRET` (dead code — tidak pernah digunakan di kode bisnis)
   - `PORTAL_ADMIN_KEY` (semua endpoint fail-closed, bukan wajib untuk core system)

2. **Ditambahkan ke `INTEGRATION_SECRETS`:**
   - `PORTAL_ADMIN_KEY` dengan deskripsi: `"Customer portal admin claim + internal audit endpoints (sport-center, translations)"`

3. **Header file diperbarui** untuk mendokumentasikan alasan perubahan.

### Sebelum Production Go-Live

Meskipun tidak fatal, disarankan untuk mengonfigurasi:
- **`PORTAL_ADMIN_KEY`** — agar fitur portal admin claim dan internal audit endpoints berfungsi
- **`CASHIER_TOKEN_SECRET`** — pertahankan di scripts preflight sebagai placeholder untuk fitur masa depan; hapus dari GCP Secret Manager jika tidak dipakai

### Yang Tetap Wajib
- **`SESSION_SECRET`** — sudah dikonfigurasi ✅
- **`GCP_PROJECT_ID`, `GCP_SECRET_ID`, `GCP_SECRET_MANAGER_BOOTSTRAP_JSON`** — untuk load-secrets.mjs ✅
- **`SUPABASE_DATABASE_URL_DEV`** — untuk dev database ✅

---

## Phase 13 — Regression

```
Test Files  75 passed (75)
     Tests  2736 passed (2736)
  Start at  [timestamp]
```

**2736 / 2736 PASS — tidak ada regresi.**

---

## Phase 14 — TypeScript

```
0 error(s)
```

**TypeScript: 0 error.**

---

## Phase 15 — Build

Build clean — `lib/db` OK, server startup normal.

---

## Phase 16 — Perubahan File

| File | Perubahan |
|------|-----------|
| `artifacts/api-server/src/lib/startupValidator.ts` | Hapus `PORTAL_ADMIN_KEY` dan `CASHIER_TOKEN_SECRET` dari `REQUIRED_SECRETS`; tambah `PORTAL_ADMIN_KEY` ke `INTEGRATION_SECRETS`; update header komentar |
| `FINAL_STARTUP_SECRET_AUDIT.md` | File baru — laporan audit ini |

---

## Phase 17 — Final Verdict

```
🟢 PRODUCTION READY
```

**Alasan:**

✅ `PORTAL_ADMIN_KEY` — **optional**. Semua endpoint fail-closed (401/403/503) tanpa key. vendorResponseToken fallback ke SESSION_SECRET. Core accounting, AI, bank reconciliation **tidak terpengaruh**.

✅ `CASHIER_TOKEN_SECRET` — **dead code** di validator. Tidak digunakan di manapun dalam kode bisnis. Dihapus dari REQUIRED_SECRETS.

✅ Tidak ada endpoint fail-open.

✅ Tidak ada secret yang tampil di log.

✅ Tidak ada default/placeholder value.

✅ Authentication dan authorization tetap aman.

✅ 2736 / 2736 test PASS.

✅ TypeScript 0 error.

✅ Build clean.

---

## Phase 18 — Git

**Commit SHA:** `6bc9980`  
**PUSH:** TIDAK dilakukan.  
**DEPLOY:** TIDAK dilakukan.

*Report generated: 2026-08-03*
