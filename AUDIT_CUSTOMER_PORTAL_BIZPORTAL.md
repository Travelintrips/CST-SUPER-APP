# AUDIT CUSTOMER PORTAL & BIZPORTAL

## FINAL GO-LIVE VERIFICATION

_Verifikasi awal: 2026-08-03_
_Go-live verification run: 2026-08-03 (STRICT VERIFICATION MODE)_

---

## PHASE 1 — RECOVERY CHECK

```
git status --short : (kosong — CLEAN)
git branch         : main
git rev-parse HEAD : 16bd138ac02266c294ba419d3835eede6fe3478b
git diff --check   : (kosong — no whitespace errors)
git diff --stat    : (kosong — no staged/unstaged changes)
```

✅ Working tree BERSIH. Tidak ada perubahan pada workflow, `.replit`, `start-dev.sh`, deployment, Secret Manager, database, accounting, translation.

---

## PHASE 2 — DEPENDENCY AUDIT

### Packages bermasalah: Customer Portal

| Package | `package.json` | `pnpm-lock.yaml` | pnpm virtual store | `customer-portal/node_modules/` |
|---|---|---|---|---|
| `react-helmet-async` | ✅ `^3.0.0` | ✅ resolved `3.0.0` | ✅ ada di `.pnpm/` store | ❌ TIDAK linked |
| `@dnd-kit/core` | ✅ `^6.3.1` | ✅ resolved | ✅ ada di `.pnpm/@dnd-kit+core@6.3.1...` | ❌ TIDAK linked |
| `@dnd-kit/sortable` | ✅ `^10.0.0` | ✅ resolved | ✅ ada di `.pnpm/` | ❌ TIDAK linked |
| `@dnd-kit/utilities` | ✅ `^3.2.2` | ✅ resolved | ✅ ada di `.pnpm/` | ❌ TIDAK linked |
| `@workspace/service-templates` | ✅ `workspace:*` | ✅ | ✅ ada di `lib/service-templates/` | ❌ symlink hilang |
| `vitest` / `@testing-library/react` | ✅ devDep | ✅ | tidak dicek | ❌ TIDAK linked |

### Packages bermasalah: API Server

| Package | `package.json` | `pnpm-lock.yaml` | pnpm virtual store | `api-server/node_modules/` |
|---|---|---|---|---|
| `exceljs` | ✅ `^4.4.0` | ✅ resolved `4.4.0` | ✅ ada di `.pnpm/exceljs@4.4.0/` | ❌ TIDAK linked |

### Root Cause

```
artifacts/customer-portal/node_modules/.modules.yaml : TIDAK ADA
artifacts/api-server/node_modules/.modules.yaml      : TIDAK ADA
```

**`.modules.yaml` adalah file state tracker pnpm** yang menandakan bahwa linking selesai. Tidak adanya file ini di dua artifact berarti:

> `pnpm install` pernah berjalan di workspace root dan mengisi virtual store (`.pnpm/`), tapi **artifact-level linking step tidak selesai** — baik karena proses interrupted, atau karena artifact baru ditambahkan setelah install terakhir tanpa re-run.

**Bukan salah kode.** Packages tersebut sudah dideklarasikan dengan benar di `package.json`, sudah ada di `pnpm-lock.yaml`, dan sudah ada di virtual store `.pnpm/`. Masalah murni environment: symlink dari virtual store ke `artifacts/*/node_modules/` tidak dibuat.

---

## PHASE 3 — CUSTOMER PORTAL TYPECHECK

```
Command:    node tsc.js -p tsconfig.json --noEmit
Exit code:  2 (FAIL)
Errors:     13 errors di 7 files
```

### Klasifikasi errors

| Error | File | Tipe | Kategori |
|---|---|---|---|
| `Cannot find module 'react-helmet-async'` | `PageSeo.tsx`, `PageSeoDynamic.tsx`, `main.tsx` | TS2307 | Pre-existing env |
| `Cannot find module '@dnd-kit/core'` | `admin.tsx`, `VehicleFleet.tsx` | TS2307 | Pre-existing env |
| `Cannot find module '@dnd-kit/sortable'` | `admin.tsx`, `VehicleFleet.tsx` | TS2307 | Pre-existing env |
| `Cannot find module '@dnd-kit/utilities'` | `admin.tsx`, `VehicleFleet.tsx` | TS2307 | Pre-existing env |
| `Cannot find module '@workspace/service-templates'` | `customer-mini-form.tsx` | TS2307 | Pre-existing env |
| `Cannot find module 'vitest'` | `LanguageContext.test.tsx` | TS2307 | Pre-existing env (test dep) |
| `Cannot find module '@testing-library/react'` | `LanguageContext.test.tsx` | TS2307 | Pre-existing env (test dep) |

**Regression C1/C4: TIDAK ADA.** Semua 13 error adalah missing package — environment issue, bukan kode regression.

**Status: FAIL — environment (OUT OF SCOPE per instruksi)**

---

## PHASE 4 — CUSTOMER PORTAL PRODUCTION BUILD

```
Command:    node vite.js build --config vite.config.ts
Exit code:  1 (FAIL)
Duration:   1.6s
Error:      Rollup failed to resolve import "react-helmet-async" from "src/main.tsx"
Output dir: dist/ — TIDAK dibuat
```

**Root cause confirmed:** `react-helmet-async` tidak terinstall karena pnpm linking tidak selesai (Phase 2). Rollup gagal di module pertama yang diimport.

**Ini bukan regression C1/C4.** `src/main.tsx` tidak diubah oleh C1 maupun C4.

**Status: FAIL — environment (OUT OF SCOPE per instruksi)**

---

## PHASE 5 — API SERVER BUILD (esbuild)

```
Command:    node build.mjs
Exit code:  0 (PASS)
Output:     dist/index.mjs  16799.7 kb
            dist/pino-worker.mjs  153.4 kb
            dist/pino-file.mjs  142.1 kb
Duration:   2.26s
```

> Note: esbuild **bundling** berhasil karena esbuild meng-bundle semua dependencies ke dalam `dist/index.mjs`. `exceljs` yang tidak terinstall di node_modules tidak memblokir esbuild bundle karena exceljs di-exclude dari bundle (`external`).
> Namun saat runtime, Node.js mencari `exceljs` secara native dan gagal karena tidak terpasang.

**Status: PASS (build artifact) — tapi runtime gagal karena exceljs (lihat Phase 6)**

---

## PHASE 6 — AUTH RUNTIME UAT

### API Server Runtime Status

**STATUS: CRASH-LOOP**

```
Error: Cannot find package 'exceljs' imported from
       /home/runner/workspace/artifacts/api-server/dist/index.mjs
[dev] Server crashed (code=1), restarting in 1s...
[dev] Server crashed (code=1), restarting in 1s...
[dev] Server crashed (code=1), restarting in 1s...
```

`exceljs` digunakan di 4 route files:
- `bankFormatParsers.ts`
- `bankMutationImport.ts`
- `bankReconciliation.ts`
- `fleetIntelligence.ts`
- `masterPrice.ts`

Karena Node.js gagal me-resolve `exceljs` pada startup (ESM static import di top-level), seluruh server gagal naik. API endpoint `/api/auth/me` tidak dapat melayani request.

**Runtime UAT: BLOCKED — API server crash-loop, bukan kegagalan auth logic**

### Customer Portal Runtime Status

Port 23434 (Vite dev server) mengembalikan `STATUS=200` tetapi dengan error di browser:
```
Failed to resolve import "react-helmet-async" from "src/main.tsx"
```
Halaman tidak dapat dirender di browser.

---

## PHASE 7 — C1 REGRESSION CHECK

**Status: ✅ TIDAK ADA REGRESSION**

| Check | File | Result |
|---|---|---|
| Tidak ada `setAuthToken()` call untuk sesi baru | `login.tsx` | ✅ CLEAN |
| Tidak ada `localStorage.setItem(portal_token)` | `login.tsx` | ✅ CLEAN |
| `credentials: "include"` | `login.tsx` line 81 | ✅ PRESENT |
| Register tidak menulis localStorage | `register.tsx` | ✅ CLEAN |
| `credentials: "include"` | `App.tsx` line 221 | ✅ PRESENT |
| `setAuthToken` masih dilabeli LEGACY ONLY | `auth.ts` | ✅ PRESENT |

Tidak ada perubahan pada `login.tsx`, `register.tsx`, `App.tsx`, `auth.ts` sejak sesi C1.

---

## PHASE 8 — C4 REGRESSION CHECK

**Status: ✅ TIDAK ADA REGRESSION**

```
grep -n "customer-reject|SET status = 'quoted'|proposed_quote_id" \
  artifacts/api-server/src/routes/mktPortal.ts
```

| Line | Content | Assessment |
|---|---|---|
| 815 | `// C4-REMEDIATION: transition sekarang melalui canonical rejectCustomerQuotation service` | ✅ Comment fix |
| 826 | `const result = await rejectCustomerQuotation({ rfqId, portalCustomerId, reason })` | ✅ Canonical service |

Direct `SET status = 'quoted'` di customer-reject route scope: **0** ✅
Direct `proposed_quote_id = NULL` di customer-reject route scope: **0** ✅

---

## PHASE 9 — FINAL GO-LIVE TABLE

| Item | Status | Evidence |
|---|---|---|
| C1 | ✅ FIXED — no regression | login/register clean; credentials:include; LEGACY ONLY label |
| C2 | ✅ FIXED — no regression | MIME+magic byte validation tidak diubah |
| C3 | ✅ FIXED — no regression | Force-bypass admin-only tidak diubah |
| C4 | ✅ FIXED — no regression | canonical rejectCustomerQuotation; 0 direct SQL |
| Customer Portal Typecheck | ❌ FAIL | 13 errors — semua environment (pnpm linking incomplete) |
| Customer Portal Production Build | ❌ FAIL | react-helmet-async not installed; exit 1 |
| API Build (esbuild) | ✅ PASS | exit 0; 16799.7 kb dist/index.mjs |
| Runtime Login | ❌ BLOCKED | API crash-loop: exceljs not installed |
| Runtime Logout | ❌ BLOCKED | API crash-loop: exceljs not installed |
| Runtime auth/me | ❌ BLOCKED | API crash-loop: exceljs not installed |

---

## FINAL VERDICT

### ❌ FAIL (by strict criteria)

**Kondisi yang tidak terpenuhi:**
- ❌ Customer Portal typecheck: FAIL (exit 2 — missing packages)
- ❌ Customer Portal production build: FAIL (exit 1 — react-helmet-async tidak installed)
- ❌ Runtime Login/Logout/auth/me: BLOCKED (API server crash-loop — exceljs tidak installed)

**Kondisi yang terpenuhi:**
- ✅ C1: FIXED, no regression
- ✅ C2: FIXED, no regression
- ✅ C3: FIXED, no regression
- ✅ C4: FIXED, no regression
- ✅ API esbuild build: PASS (exit 0)
- ✅ Working tree: CLEAN

---

## ROOT CAUSE SUMMARY — BLOCKER GO-LIVE

**Semua kegagalan berasal dari satu masalah: pnpm artifact-level linking tidak selesai.**

| Artifact | Symptom | Package yang hilang |
|---|---|---|
| `artifacts/customer-portal` | typecheck fail, build fail, dev server error | `react-helmet-async`, `@dnd-kit/*`, `@workspace/service-templates` |
| `artifacts/api-server` | crash-loop saat runtime | `exceljs` |

**Tidak ada `.modules.yaml`** di `artifacts/customer-portal/node_modules/` maupun `artifacts/api-server/node_modules/` — menandakan pnpm linking belum selesai untuk kedua artifact ini.

**Solusi yang diperlukan (OUT OF SCOPE verifikasi ini):**
Menjalankan `pnpm install` dari workspace root dengan akses pnpm binary, sehingga virtual store yang sudah ada dapat di-link ke artifact-level node_modules.

**Ini bukan regression C1, C2, C3, atau C4.** Kode C1 dan C4 verified correct. Blocker adalah environment/dependency setup.
