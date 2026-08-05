---
name: Allowed-companies access control for admin users
description: Architecture and pitfalls of the user_allowed_companies table + resolveCompany enforcement
---

## The rule
Admin users can be restricted to a subset of companies via `user_allowed_companies` (user_id, company_id).
Empty allowlist = unrestricted (all companies). Non-empty = only those companies.

## DB table
Boot migration in `artifacts/api-server/src/routes/users.ts` — `CREATE TABLE IF NOT EXISTS user_allowed_companies (id SERIAL PK, user_id TEXT FK users, company_id INT FK companies, UNIQUE(user_id,company_id))`.
Also exported from `lib/db/src/schema/users.ts` as `userAllowedCompaniesTable`.

## Auth middleware
`_loadUserCtx` in `authMiddleware.ts` loads `allowedCompanyIds: number[]` from `user_allowed_companies` via raw SQL (non-fatal try/catch — table may not exist during boot).
Added to `_userCtxCache` and propagated to `req.user.allowedCompanyIds`.
`AuthUser` interface in `auth.ts` has `allowedCompanyIds?: number[]`.

## Enforcement in resolveCompany
`resolveCompanyId()` — silently clamps: if allowedIds non-empty and resolved not in list, returns user's own company or allowedIds[0].
`resolveCompanyScope()` — CRITICAL: when user has non-empty allowedIds, `?companyId=all` must NOT return "all" (would bypass all company filters downstream). Returns primary/first allowed company instead.

**Why:** Several routes do `if (scope === "all") { /* skip company filter */ }`. A restricted admin sending `?companyId=all` would get cross-company data if we returned "all".

## API endpoints
- `GET /api/users/:id/allowed-companies` — returns rows with company_id, company_name, company_code
- `PUT /api/users/:id/allowed-companies` — body `{ companyIds: number[] }`. Uses `db.transaction()` to atomically DELETE+INSERT (prevents empty-window bypass where unrestricted access is briefly granted).
- On save: calls `invalidateUserCtxCache(id)` so the 5-min cache doesn't serve stale allowlist.

## Frontend (BizPortal users.tsx)
- `editAllowedCompanies: number[]` state; synced via `useEffect` keyed on `[editing?.id, currentAllowedCompanies]`.
- Do NOT sync in render body — causes render-loop and Strict Mode warnings.
- Checkbox list shown only when `editRole === "admin"`.
- On save: calls PUT allowed-companies for both admin (with list) and non-admin (with [] to clear any stale rows).

## Other isolation fixes in same session
- `dashboard.ts`: 3x `logistic_order_rfqs` COUNT queries now include `${companyFilter}` / `${cf}`.
- `accounting.ts`: 7x `resolveCompanyId(req) ?? 1` → `resolveCompanyId(req)` (the ?? 1 was redundant, resolveCompanyId already defaults to 1).
- `expenses.ts postQuickExpenseJournal`: journal lookup now searches company-scoped first, then falls back to global.
- `tenant/units.tsx`, `tenant/rekap.tsx`: hardcoded COMPANY_LABELS/COMPANY_OPTIONS/LOKASI removed; companies loaded from `/api/companies`.
- `tenant/perbandingan-lokasi.tsx`: `locs.find(l => l.company_id === 1/4)` → `locs[0]`/`locs[1]`.
