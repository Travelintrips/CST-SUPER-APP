# GCP Bootstrap Secret Architecture — Final Report

**Date:** 2026-08-07
**Version:** 1.0
**Status:** ✅ COMPLETE

---

## Executive Summary

The GCP Secret Manager bootstrap architecture has been upgraded from a three-credential
model to a **single-credential model**. A fresh GitHub import now requires exactly
**ONE Replit Secret** (`GCP_SECRET_MANAGER_BOOTSTRAP_JSON`). All other application
secrets are fetched automatically from Google Cloud Secret Manager at startup.

---

## Existing Architecture (Before)

```
Replit Secrets (3 required):
  GCP_PROJECT_ID
  GCP_SECRET_ID
  GCP_SECRET_MANAGER_BOOTSTRAP_JSON

GCP Secret Manager:
  ONE bundle (e.g. "replit-app-secrets") with both environments mixed:
  {
    "SUPABASE_DATABASE_URL":     "postgres://prod...",
    "SUPABASE_DATABASE_URL_DEV": "postgres://dev...",
    "SESSION_SECRET":            "...",
    "SESSION_SECRET_DEV":        "...",
    ...
  }

Loader behavior:
  APP_ENV=development → inject *_DEV keys as canonical names
  APP_ENV=production  → inject non-_DEV keys only
  NODE_ENV used as fallback if APP_ENV missing (removed in new architecture)
```

**Problems identified:**
- Three Replit Secrets to enter manually on every fresh import
- No cross-verification that the correct bundle was fetched (no APP_ENV field in bundle)
- Dev and prod secrets co-located in one bundle (higher blast radius if SA compromised)
- NODE_ENV fallback for APP_ENV creates ambiguity

---

## New Architecture (After)

```
Replit Secrets (1 required):
  GCP_SECRET_MANAGER_BOOTSTRAP_JSON  (Service Account JSON)

GCP Secret Manager:
  TWO isolated bundles:

  cst-super-app-development:
  {
    "APP_ENV": "development",
    "SUPABASE_DATABASE_URL": "postgres://dev...",
    "SESSION_SECRET": "...",
    ...
  }

  cst-super-app-production:
  {
    "APP_ENV": "production",
    "SUPABASE_DATABASE_URL": "postgres://prod...",
    "SESSION_SECRET": "...",
    ...
  }

Loader behavior:
  1. Validate APP_ENV (required; "development" | "production" only)
  2. Parse bootstrap JSON → extract project_id
  3. Bundle name = "cst-super-app-{APP_ENV}"
  4. Fetch bundle from GCP
  5. Verify payload.APP_ENV === runtime APP_ENV → fail-closed on mismatch
  6. Inject all string keys (APP_ENV never overwritten)
  7. Validate required secrets
  8. Start application
```

---

## Files Changed

| File | Change |
|---|---|
| `artifacts/api-server/load-secrets.mjs` | Major update — new single-credential architecture with backward-compat legacy mode |
| `artifacts/api-server/load-secrets.test.mjs` | **NEW** — 17 unit test cases + bonus tests (30+ assertions) |
| `docs/secret-architecture.md` | Updated to v3.0 — documents both new and legacy mode |
| `docs/environment-variables.md` | Updated — new mode primary, legacy deprecated |
| `docs/GCP_BOOTSTRAP_SECRET_SETUP.md` | **NEW** — one-time GCP setup guide |
| `AI_RULES.md` | Updated — new bootstrap credential list (one secret) |
| `AI_ARCHITECTURE_GUARDRAILS.md` | Updated — Section 5 matrix reflects new architecture |
| `ARCHITECTURE_DECISIONS.md` | Added ADR-0005 — Single-Credential GCP Bootstrap |
| `GCP_BOOTSTRAP_SECRET_FINAL_REPORT.md` | **THIS FILE** |

---

## Bootstrap Contract

| Requirement | Implementation |
|---|---|
| Minimum Replit Secrets | **1** (`GCP_SECRET_MANAGER_BOOTSTRAP_JSON`) |
| project_id source | Extracted from bootstrap SA JSON (`credentials.project_id`) |
| Bootstrap JSON validation | `project_id`, `client_email`, `private_key` all required |
| Bundle name derivation | `cst-super-app-{APP_ENV}` (configurable via `GCP_SECRET_BUNDLE_PREFIX`) |
| APP_ENV validation | Required; must be exactly `development` or `production` |
| APP_ENV cross-verification | `payload.APP_ENV` must match runtime `APP_ENV` |
| APP_ENV overwrite protection | `APP_ENV` key in bundle payload is NEVER injected into process.env |
| NODE_ENV as fallback | ❌ Removed — `APP_ENV` is sole source of truth |

---

## DEV Flow (New Mode)

```
1. Developer imports repo from GitHub
2. Adds ONE Replit Secret: GCP_SECRET_MANAGER_BOOTSTRAP_JSON = <SA JSON>
3. Runs: pnpm run dev
4. start-dev.sh sets APP_ENV=development unconditionally
5. load-secrets.mjs:
   a. Validates APP_ENV=development
   b. Parses bootstrap JSON → project_id
   c. Fetches cst-super-app-development/versions/latest
   d. Verifies payload.APP_ENV === "development" ✓
   e. Injects SESSION_SECRET, SUPABASE_DATABASE_URL (dev), etc.
   f. Validates required secrets ✓
   g. Spawns API server
6. envGuard in src/index.ts verifies DB is dev-only
7. Application starts successfully
```

---

## PROD Flow (New Mode)

```
1. Deployment sets APP_ENV=production
2. npm run start:secure runs load-secrets.mjs
3. load-secrets.mjs:
   a. Validates APP_ENV=production
   b. Parses bootstrap JSON → project_id
   c. Fetches cst-super-app-production/versions/latest
   d. Verifies payload.APP_ENV === "production" ✓
   e. Injects SESSION_SECRET, SUPABASE_DATABASE_URL (prod), etc.
   f. Validates required secrets ✓
   g. Spawns API server
4. Application starts with production credentials
```

---

## Fail-Closed Behavior

| Scenario | Behavior |
|---|---|
| APP_ENV missing | `process.exit(1)` — "APP_ENV is not set" |
| APP_ENV = "staging" (invalid) | `process.exit(1)` — "APP_ENV is not valid" |
| Bootstrap JSON missing | `process.exit(1)` — "GCP_SECRET_MANAGER_BOOTSTRAP_JSON is not set" |
| Bootstrap JSON invalid JSON | `process.exit(1)` — "not valid JSON" |
| Bootstrap JSON missing project_id | `process.exit(1)` — "missing required fields: project_id" |
| GCP access denied | `process.exit(1)` — "Failed to fetch ... PERMISSION_DENIED" |
| Bundle not found | `process.exit(1)` — "Failed to fetch ... NOT_FOUND" |
| Bundle payload.APP_ENV mismatch | `process.exit(1)` — "Bundle environment mismatch" |
| SESSION_SECRET missing | `process.exit(1)` — "Required secrets missing after loading" |
| SUPABASE_DATABASE_URL missing | `process.exit(1)` — "Required secrets missing after loading" |
| DEV requesting PROD bundle | Blocked by separate bundle design (fetch would fail or APP_ENV mismatch) |
| PROD requesting DEV bundle | Blocked by separate bundle design (fetch would fail or APP_ENV mismatch) |

---

## GCP IAM

| Component | Role |
|---|---|
| Bootstrap Service Account | `roles/secretmanager.secretAccessor` ONLY |
| No other roles | Owner/Editor roles are FORBIDDEN for this SA |
| Bundle access | Granted per-secret to the bootstrap SA |

---

## Required Secrets (Startup Fails if Missing)

| Secret | Min Length | Feature |
|---|---|---|
| `SESSION_SECRET` | 32 chars | Express session signing |
| `SUPABASE_DATABASE_URL` | 10 chars | Database connection |

---

## Optional/Integration Secrets (Warn-Only if Missing)

| Secret | Feature if missing |
|---|---|
| `PORTAL_ADMIN_KEY` | Admin endpoints fail-closed (401/403/503) |
| `OPENAI_API_KEY` | AI features disabled |
| `PAYLABS_PRIVATE_KEY` | Paylabs payment gateway disabled |
| `FONNTE_TOKEN` | WhatsApp messaging disabled |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Sheets sync disabled |

---

## Dead Code / Not Used

| Secret | Status |
|---|---|
| `CASHIER_TOKEN_SECRET` | No active business code — do not add to bundles |
| `GCP_PROJECT_ID` | Deprecated — extracted from bootstrap JSON |
| `GCP_SECRET_ID` | Deprecated — derived from APP_ENV |

---

## Backward Compatibility — Legacy Mode

The loader automatically detects which mode to use:

| Condition | Mode | Behavior |
|---|---|---|
| `GCP_PROJECT_ID` + `GCP_SECRET_ID` both set | **LEGACY** | Single bundle, `_DEV` key selection, deprecation warning logged |
| Only `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` set | **NEW** | Separate bundles, APP_ENV cross-verification |

**The existing running system continues to work unchanged** during migration.

Migration path:
1. Create new GCP bundles (`cst-super-app-development`, `cst-super-app-production`)
2. Run `node load-secrets.mjs --validate` to verify new bundles accessible
3. Remove `GCP_PROJECT_ID` and `GCP_SECRET_ID` from Replit Secrets
4. Loader automatically switches to new mode

---

## DB Safety Guard

The existing `envGuard` in `src/index.ts` remains unchanged and enforced:

| Scenario | Guard behavior |
|---|---|
| `APP_ENV=development` + production DB detected | `process.exit(1)` — "FATAL: NODE_ENV=development but PRODUCTION DB detected" |
| `APP_ENV=production` + dev DB detected | `process.exit(1)` |

The loader does not bypass, wrap, or remove this guard.

---

## Fresh Replit Setup (New Mode)

Steps for a new developer importing from GitHub:

```
1. Import repo: https://github.com/Travelintrips/CST-SUPER-APP
2. Open Replit → Secrets
3. Add: GCP_SECRET_MANAGER_BOOTSTRAP_JSON = <SA JSON from GCP Console>
4. Run: pnpm run dev

Total manual steps: 1 secret.
All other secrets loaded automatically.
```

---

## Validate Mode

```bash
node artifacts/api-server/load-secrets.mjs --validate
```

This mode:
- ✅ Authenticates to GCP
- ✅ Verifies bundle exists and is accessible
- ✅ Verifies required secret names (SESSION_SECRET, SUPABASE_DATABASE_URL)
- ✅ Verifies APP_ENV cross-match
- ❌ Does NOT print secret values
- ❌ Does NOT start the API server
- ❌ Does NOT write to any database

---

## Tests

Test file: `artifacts/api-server/load-secrets.test.mjs`

| # | Test Scenario | Coverage |
|---|---|---|
| 1 | APP_ENV missing → fail | `resolveEnvironment()` |
| 2 | APP_ENV invalid → fail | `resolveEnvironment()` |
| 3 | Bootstrap missing → fail | `validateBootstrapJson()` |
| 4 | Bootstrap malformed → fail | `validateBootstrapJson()` |
| 5 | DEV selects DEV bundle | `resolveBundleName()` |
| 6 | PROD selects PROD bundle | `resolveBundleName()` |
| 7 | DEV never falls back to PROD | `injectSecrets()` — mismatch rejection |
| 8 | PROD never falls back to DEV | `injectSecrets()` — mismatch rejection |
| 9 | Bundle environment mismatch → fail | `injectSecrets()` |
| 10 | Required secret missing → fail | `validateRequiredSecrets()` |
| 11 | Optional secret missing → continues | `validateRequiredSecrets()` |
| 12 | Secret value never logged | `injectSecrets()` return shape |
| 13 | APP_ENV not overwritten | `injectSecrets()` — APP_ENV skip |
| 14 | Development + PROD DB blocked | `injectSecrets()` — correct DB selection |
| 15 | Production + DEV DB blocked | `injectSecrets()` — correct DB selection |
| 16 | Valid DEV startup → success | Full flow |
| 17 | Valid PROD validation → success | Full flow |
| B1 | Legacy mode backward compat | `resolveBundleName()` — legacy detection |
| B2 | Legacy _DEV key selection | `injectSecrets()` — legacy mode |
| B3 | Legacy prod key selection | `injectSecrets()` — legacy mode |
| B4 | Legacy: no _DEV keys in prod result | `injectSecrets()` — isolation |
| B5 | project_id from bootstrap JSON | `resolveBundleName()` |
| B6 | GCP_PROJECT_ID overrides in legacy | `resolveBundleName()` |

---

## TypeScript / Build

- No TypeScript code changed — `load-secrets.mjs` is plain ES module JavaScript
- `startupValidator.ts` unchanged — classification of PORTAL_ADMIN_KEY (optional) and
  CASHIER_TOKEN_SECRET (dead code / not added) remains correct
- BizPortal and Customer Portal frontend not changed
- `start-dev.sh` unchanged — `APP_ENV=development` already set unconditionally ✓
- `dev.mjs` unchanged — routes through `load-secrets.mjs` already ✓
- `src/index.ts` `envGuard` unchanged — DB safety guard still enforced ✓

---

## Security Review

| Check | Status |
|---|---|
| Service Account has minimum role (Secret Accessor only) | ✅ Documented in setup guide |
| No Owner/Editor role | ✅ Documented in setup guide |
| Bootstrap JSON not committed | ✅ `.gitignore` covers `.env`, local credentials |
| Logs safe (no values, key names only) | ✅ `injectSecrets()` returns key names only; loader logs only key names |
| Error responses safe (no values in error messages) | ✅ Error messages reference key names, not values |
| No frontend exposure | ✅ `load-secrets.mjs` runs server-side only |
| No browser bundle contains credentials | ✅ Secrets injected into `process.env` only; not included in any Vite build |
| APP_ENV never overwritten by bundle | ✅ Explicitly excluded in `injectSecrets()` |
| No cross-environment fallback | ✅ APP_ENV mismatch → fail-closed |

---

## Remaining Limitations

1. **GCP bundle creation is a one-time manual step** — developers must create
   `cst-super-app-development` and `cst-super-app-production` bundles in GCP Console
   before the new mode works (documented in `docs/GCP_BOOTSTRAP_SECRET_SETUP.md`)

2. **Legacy migration is not automated** — existing Replit environments must manually
   remove `GCP_PROJECT_ID` and `GCP_SECRET_ID` after verifying new bundles work

3. **`--validate` mode does not test DB connectivity** — it verifies secret names are
   present but does not make an actual DB connection

4. **Bundle APP_ENV cross-verification warns (not fails) if `APP_ENV` field absent from bundle** —
   to support bundles created before this requirement; new bundles must include it

---

## Final Verdict

```
✅ GCP BOOTSTRAP SECRET ARCHITECTURE COMPLETE

✓ Fresh Replit import requires only ONE bootstrap credential
✓ DEV uses DEV bundle (cst-super-app-development)
✓ PROD uses PROD bundle (cst-super-app-production)
✓ No cross-environment fallback (fail-closed on mismatch)
✓ DB safety guard (envGuard) still enforced
✓ No secret written to disk
✓ No secret logged (key names only)
✓ Tests written (17 required scenarios + 6 bonus)
✓ TypeScript unchanged (no TS code modified)
✓ Build not broken (no build artifacts changed)
✓ Backward compat maintained (legacy mode for existing environments)
```
