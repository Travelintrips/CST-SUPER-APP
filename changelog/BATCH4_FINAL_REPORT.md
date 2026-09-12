# BATCH4 FINAL REPORT — Treasury Security & Company Isolation

**Commit:** `d03b13bb9dfd202c9b383d47849aee8a48e0f472`  
**Date:** 2026-07-29  
**Branch:** `main`  
**Remote status:** `origin/main: ahead 1` — not pushed (awaiting explicit approval)

---

## 1. Commit Integrity

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `d03b13bb9dfd202c9b383d47849aee8a48e0f472` |
| Working tree | ✅ CLEAN |
| Files changed | `treasury-security.test.ts`, `resolveCompanyStrict.ts`, `treasury.ts` — only Treasury security files |
| Whitespace errors (`--check`) | ✅ None |
| Remote | `origin` = `https://github.com/Travelintrips/CST-SUPER-APP` |
| Push status | `ahead 1` — **not pushed**, waiting approval |

---

## 2. Remote Status

```
* main d03b13b [origin/main: ahead 1] Add strict Treasury authentication and company isolation
```

Commit exists locally on `main`. Not yet on `origin/main`.

---

## 3. TypeScript Baseline Proof

**Total errors:** 13 — all pre-existing, **zero** from commit `d03b13b`.

| File | Error | Pre-existing? |
|---|---|---|
| `src/lib/reconciliation/confidenceCalibrationService.ts:27` | TS1340 `@workspace/db` type import | ✅ NOT touched by d03b13b |
| `src/lib/reconciliation/expectedCashFlowService.ts:21` | TS1340 | ✅ NOT touched |
| `src/lib/reconciliation/partialPaymentEngine.ts:24` | TS1340 | ✅ NOT touched |
| `src/lib/reconciliation/paymentAllocationEngine.ts:33` | TS1340 | ✅ NOT touched |
| `src/lib/reconciliation/paymentRelationshipGraph.ts:27` | TS1340 | ✅ NOT touched |
| `src/lib/reconciliation/reconDecisionStack.ts:35` | TS1340 | ✅ NOT touched |
| `src/lib/reconciliation/reconMetricsService.ts:26` | TS1340 | ✅ NOT touched |
| `src/lib/reconciliation/splitPaymentEngine.ts:29,202` | TS1340, TS7006 | ✅ NOT touched |
| `src/routes/auth.ts:11` | TS6305 api-zod dist not built | ✅ NOT touched |
| `src/routes/devTestRoutes.ts:25` | TS2440 SmokeResult conflict | ✅ NOT touched |
| `src/routes/logisticOrders.ts:92` | TS6305 | ✅ NOT touched |
| `src/routes/storage.ts:7` | TS6305 | ✅ NOT touched |

**Targeted check — 3 new Treasury files:**

```
git diff HEAD^..HEAD -- src/lib/treasury/resolveCompanyStrict.ts  → new file (no prior errors)
git diff HEAD^..HEAD -- src/routes/treasury.ts                    → modified (no TS errors)
git diff HEAD^..HEAD -- src/__tests__/treasury-security.test.ts   → new file (no prior errors)

tsc filtered for "treasury|resolveCompanyStrict" → 0 errors
```

---

## 4. Build Result

| Item | Result |
|---|---|
| Command | `pnpm --filter @workspace/api-server run build` |
| Exit code | **0** ✅ |
| Duration | 9.062s real |
| Bundler | esbuild |
| Output | `dist/index.mjs` — 16,316.7 kb |
| Errors | None |
| Warnings | None |

Build uses esbuild (not tsc) — pre-existing TS type errors do not block compilation.

---

## 5. Authenticated Actor A UAT — company 1 (`e2e-admin@test.internal`, role: ecommerce)

| Endpoint | HTTP | companyId |
|---|---|---|
| `GET /api/treasury/dashboard` | **200** ✅ | 1 |
| `GET /api/treasury/cash-position` | **200** ✅ | 1 |
| `GET /api/treasury/forecast` | **200** ✅ | 1 |
| `GET /api/treasury/variance` | **200** ✅ | 1 |
| `GET /api/treasury/liquidity` | **200** ✅ | 1 |
| `GET /api/treasury/risk` | **200** ✅ | 1 |
| `GET /api/treasury/metrics` | **200** ✅ | (cache/perf — no companyId in response) |

No raw errors, no NaN/Infinity observed. Data sourced from PT Cahaya Sejati Teknologi (company 1).

---

## 6. Authenticated Actor B UAT — company 2 (`stricttest@internal.dev`, role: ecommerce)

| Endpoint | HTTP | companyId |
|---|---|---|
| `GET /api/treasury/dashboard` | **200** ✅ | 2 |
| `GET /api/treasury/cash-position` | **200** ✅ | 2 |
| `GET /api/treasury/forecast` | **200** ✅ | 2 |
| `GET /api/treasury/variance` | **200** ✅ | 2 |
| `GET /api/treasury/liquidity` | **200** ✅ | 2 |
| `GET /api/treasury/risk` | **200** ✅ | 2 |
| `GET /api/treasury/metrics` | **200** ✅ | (cache/perf — no companyId in response) |

Data sourced from PT Wangsamas (company 2) — different nominal from Actor A. ✅

---

## 7. Cross-Company Isolation Matrix

| Scenario | HTTP | companyId returned | Expected |
|---|---|---|---|
| Actor A `?companyId=2` (non-admin param ignored) | 200 | **1** | 1 ✅ |
| Actor A + `x-company-id: 2` header | 200 | **1** | 1 ✅ |
| Actor B `?companyId=1` (non-admin param ignored) | 200 | **2** | 2 ✅ |
| No cookie + `x-company-id: 1` | **401** | — | 401 ✅ |
| Actor C (no company assigned) | **403** `COMPANY_CONTEXT_REQUIRED` | — | 403 ✅ |
| No auth → all 7 endpoints | **401** | — | 401 ✅ |
| Fallback to company 1 | **Never** | — | Never ✅ |

---

## 8. Permission Test

| Actor | Condition | Result |
|---|---|---|
| Actor C (`admin-uat@dev.local`) | Authenticated, `companyId=null` | **403** `COMPANY_CONTEXT_REQUIRED` |
| No cookie | Unauthenticated | **401** `AUTHENTICATION_REQUIRED` |

Admin users with `allowedCompanyIds` allowlist enforced via `COMPANY_ACCESS_DENIED` (validated in unit tests TS-X01).

---

## 9. Cookie / Session Security

| Check | Result |
|---|---|
| Fake/expired `sid` cookie → | **401** `AUTHENTICATION_REQUIRED` ✅ |
| `x-company-id` header alone (no session) → | **401** ✅ |
| `x-forwarded-company` header alone → | **401** ✅ |
| Stack trace in error response | **False** ✅ |
| SQL in error response | **False** ✅ |
| Class name (`TreasuryAuthError`) in response | **False** ✅ |
| Error body format | `{"ok":false,"error":"<CODE>"}` — safe ✅ |

Session cookie cannot be replaced by any header. Credentials not written to logs or report.

---

## 10. Regression

| Suite | Tests | Result | Duration |
|---|---|---|---|
| `treasury-security.test.ts` | 24 | ✅ 24 pass | 1.75s |
| `treasury-batch4.test.ts` | 88 | ✅ 88 pass | 0.35s |
| **Total** | **112** | **✅ 112 pass, 0 fail** | 1.94s |

Exit code: 0.

---

## 11. Remaining Blockers / Risks

| # | Item | Severity | Scope |
|---|---|---|---|
| 1 | 13 pre-existing TS errors (`reconciliation`, `api-zod dist`) | Medium | Pre-existing, not Treasury; build succeeds via esbuild |
| 2 | `resolveCompanyId` (lenient) still used in non-Treasury routes (`advances`, etc.) | Medium | Out of scope; Treasury-specific hardening complete |
| 3 | Commit `d03b13b` not pushed to `origin/main` | Pending | Awaiting explicit push approval |
| 4 | Admin `COMPANY_ACCESS_DENIED` tested only at unit level | Low | Live test requires user with populated `allowedCompanyIds` in DB |

---

## Verdict

| Category | Status |
|---|---|
| **Authentication (no-auth → 401)** | ✅ PASS |
| **Positive Auth Runtime (same-company → 200)** | ✅ PASS |
| **Authorization (no-company → 403)** | ✅ PASS |
| **Company Isolation (cross-company blocked)** | ✅ PASS |
| **Permission Enforcement (allowlist)** | ✅ PASS (unit-tested) |
| **TypeScript (Treasury files)** | ✅ 0 errors |
| **TypeScript (full project)** | ⚠️ 13 pre-existing errors (not from this commit) |
| **Build** | ✅ exit 0, 9s, 16 MB bundle |
| **Regression** | ✅ 112/112 pass |
| **Production Readiness** | ✅ **GO** for Treasury Security layer |

### Production GO criteria met:
- [x] build exit 0
- [x] authenticated same-company → 200
- [x] cross-company blocked (non-admin locked, no fallback)
- [x] no-auth → 401
- [x] no-company → 403
- [x] no fallback to company 1
- [x] no regression
- [x] commit `d03b13b` on revision to be deployed
- [ ] push to `origin/main` — **pending explicit approval**
