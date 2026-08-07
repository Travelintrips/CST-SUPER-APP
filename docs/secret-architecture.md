# Secret Architecture

**Version:** 3.0
**Status:** Mandatory
**Updated:** 2026-08-07
**Applies to:** All services — API Server, BizPortal, Customer Portal, Logistic Order, Driver App

---

## Objective

Google Cloud Secret Manager is the **single source of truth** for all application secrets.

A **fresh GitHub import requires exactly ONE Replit Secret** to bootstrap:

```
GCP_SECRET_MANAGER_BOOTSTRAP_JSON
```

The loader reads the GCP project ID from inside the bootstrap JSON, derives the bundle
name from `APP_ENV`, fetches the full secret payload, and injects it into `process.env`
before the application starts. Developers never copy application secrets into Replit manually.

---

## Architecture Diagram — New Mode (Single Credential)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  REPLIT SECRETS  (ONE bootstrap credential)                               │
│                                                                           │
│  GCP_SECRET_MANAGER_BOOTSTRAP_JSON   ← Service Account JSON              │
│    contains: project_id, client_email, private_key                        │
└──────────────────────────┬────────────────────────────────────────────────┘
                           │ project_id extracted from JSON
                           │ bundle name = "cst-super-app-{APP_ENV}"
                           ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  GOOGLE CLOUD SECRET MANAGER — SEPARATE BUNDLES PER ENVIRONMENT           │
│                                                                           │
│  cst-super-app-development/versions/latest                                │
│  {                                                                        │
│    "APP_ENV":               "development",                                │
│    "SUPABASE_DATABASE_URL": "postgres://dev...",                          │
│    "SESSION_SECRET":        "...",                                        │
│    "OPENAI_API_KEY":        "sk-dev...",                                  │
│    ...                                                                    │
│  }                                                                        │
│                                                                           │
│  cst-super-app-production/versions/latest                                 │
│  {                                                                        │
│    "APP_ENV":               "production",                                 │
│    "SUPABASE_DATABASE_URL": "postgres://prod...",                         │
│    "SESSION_SECRET":        "...",                                        │
│    "OPENAI_API_KEY":        "sk-prod...",                                 │
│    ...                                                                    │
│  }                                                                        │
└──────────────────────────┬────────────────────────────────────────────────┘
                           │ APP_ENV cross-verified: payload.APP_ENV must match runtime
                           ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  load-secrets.mjs   (startup, runs once)                                  │
│                                                                           │
│  1. Validate APP_ENV (required; "development" | "production" only)        │
│  2. Parse bootstrap JSON → extract project_id                             │
│  3. Derive bundle name: "cst-super-app-{APP_ENV}"                         │
│  4. Fetch bundle from GCP Secret Manager                                  │
│  5. Verify payload.APP_ENV === runtime APP_ENV → fail-closed if mismatch  │
│  6. Inject all string keys into process.env (APP_ENV never overwritten)   │
│  7. Validate required secrets (SESSION_SECRET, SUPABASE_DATABASE_URL)     │
│  8. Start application                                                     │
│                                                                           │
│  Missing APP_ENV / invalid APP_ENV  → process.exit(1)                    │
│  Missing / invalid bootstrap JSON   → process.exit(1)                    │
│  GCP fetch failure                  → process.exit(1)                    │
│  Bundle APP_ENV mismatch            → process.exit(1)                    │
│  Required secret missing            → process.exit(1)                    │
└──────────────────────────┬────────────────────────────────────────────────┘
                           │ process.env (canonical names, no _DEV suffix)
                           ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  APPLICATION                                                              │
│                                                                           │
│  API Server      → reads process.env.SUPABASE_DATABASE_URL               │
│  BizPortal       → reads process.env.VITE_SUPABASE_URL                   │
│  Customer Portal → reads process.env.VITE_SUPABASE_URL                   │
│                                                                           │
│  Application code NEVER reads *_DEV variants.                            │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture Diagram — Legacy Mode (Three Credentials, Backward Compat)

The legacy mode is supported for existing running environments that still have
`GCP_PROJECT_ID` and `GCP_SECRET_ID` as Replit Secrets. It uses a single GCP bundle
with mixed `_DEV` / prod keys and does client-side key selection.

```
┌───────────────────────────────────────────────────────────────────────────┐
│  REPLIT SECRETS  (legacy, three credentials)                              │
│                                                                           │
│  GCP_PROJECT_ID                    ← GCP project ID                      │
│  GCP_SECRET_ID                     ← Secret bundle name (single mixed)   │
│  GCP_SECRET_MANAGER_BOOTSTRAP_JSON ← Service account JSON                │
└──────────────────────────┬────────────────────────────────────────────────┘
                           │
                           ▼
│  GCP bundle (single, contains both environments):                         │
│  {                                                                        │
│    "SUPABASE_DATABASE_URL":     "postgres://prod...",                     │
│    "SUPABASE_DATABASE_URL_DEV": "postgres://dev...",                      │
│    "SESSION_SECRET":            "...",                                    │
│    "SESSION_SECRET_DEV":        "...",                                    │
│    ...                                                                    │
│  }                                                                        │
│                                                                           │
│  load-secrets.mjs selects keys based on APP_ENV:                         │
│    development → inject *_DEV keys as canonical names                     │
│    production  → inject production keys only                              │
│                                                                           │
│  ⚠ DEPRECATED — migrate to separate bundles + single credential         │
│  See docs/GCP_BOOTSTRAP_SECRET_SETUP.md for migration steps.             │
```

---

## Bootstrap Credential (Replit Secret)

### New Mode (Recommended)

| Secret | Description | Who uses it |
|---|---|---|
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Service Account JSON with `roles/secretmanager.secretAccessor` | `load-secrets.mjs` |

**No other secrets belong in Replit in new mode.**

### Legacy Mode (Deprecated)

| Secret | Description |
|---|---|
| `GCP_PROJECT_ID` | GCP project ID |
| `GCP_SECRET_ID` | Single bundle name in Secret Manager |
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Service Account JSON |

---

## GCP Bundle Structure

### New Mode Bundles

Each environment has its own GCP secret, named `cst-super-app-{APP_ENV}`:

| GCP Secret Name | Environment |
|---|---|
| `cst-super-app-development` | `APP_ENV=development` |
| `cst-super-app-production` | `APP_ENV=production` |

Each bundle is a flat JSON object with:
- `APP_ENV` field (used for cross-verification — must match runtime)
- All application secrets for that environment (canonical names, no `_DEV` suffix)

### Application Secrets (inside GCP bundles)

| Canonical Name (read by app) | In development bundle | In production bundle |
|---|---|---|
| `SUPABASE_DATABASE_URL` | dev database URL | prod database URL |
| `VITE_SUPABASE_URL` | dev Supabase URL | prod Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | dev anon key | prod anon key |
| `SESSION_SECRET` | dev session secret | prod session secret |
| `OPENAI_API_KEY` | dev OpenAI key | prod OpenAI key |
| `PAYLABS_PRIVATE_KEY` | dev Paylabs key | prod Paylabs key |
| `FONNTE_TOKEN` | dev Fonnte token | prod Fonnte token |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | dev SA JSON | prod SA JSON |
| `GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN` | dev PAT | prod PAT |

> **Note:** Values are never documented here. Only key names. See `SECRET_MANAGER_RULES.md`.

---

## Startup Flow

### Development

```bash
pnpm run dev
# → bash ./start-dev.sh → node dev.mjs (esbuild watch + auto-restart)
# → dev.mjs → node load-secrets.mjs node ./dist/index.mjs
```

1. `start-dev.sh` sets `APP_ENV=development` unconditionally
2. `load-secrets.mjs` validates `APP_ENV`, parses bootstrap JSON, extracts `project_id`
3. Fetches `cst-super-app-development` bundle from GCP Secret Manager
4. Verifies `payload.APP_ENV === "development"`
5. Injects all keys into `process.env`
6. Validates `SESSION_SECRET` and `SUPABASE_DATABASE_URL` are present
7. Spawns API server

### Production

```bash
npm run start:secure
# → node load-secrets.mjs node --enable-source-maps ./dist/index.mjs
```

Same flow with `APP_ENV=production` → fetches `cst-super-app-production` bundle.

### Validate Only (no app start)

```bash
node load-secrets.mjs --validate
```

Authenticates to GCP, verifies bundle exists, verifies required secrets, prints summary.
Does **not** start the application or write to any database.

---

## Failure Rules

| Condition | Behaviour |
|---|---|
| `APP_ENV` missing | `process.exit(1)` — startup fails |
| `APP_ENV` invalid (not development / production) | `process.exit(1)` — startup fails |
| `NODE_ENV` set but `APP_ENV` missing | `process.exit(1)` — NODE_ENV not a substitute |
| Bootstrap JSON missing | `process.exit(1)` — startup fails |
| Bootstrap JSON invalid / missing fields | `process.exit(1)` — startup fails |
| GCP fetch error | `process.exit(1)` — startup fails |
| Payload empty or invalid JSON | `process.exit(1)` — startup fails |
| Bundle APP_ENV mismatch (new mode) | `process.exit(1)` — cross-environment contamination blocked |
| Required secret missing after load | `process.exit(1)` — startup fails |
| Development requesting production bundle | Blocked by separate bundle design |
| Production requesting development bundle | Blocked by separate bundle design |

**No fallbacks. No dummy values. No silent continues.**

---

## Security Rules

- ❌ Do not hardcode any secret in source code
- ❌ Do not commit secrets to git
- ❌ Do not log secret values (key names only are permitted)
- ❌ Do not duplicate secrets between environments
- ❌ Do not store application secrets in Replit Secrets
- ❌ Do not print, return, or expose secret values in API responses
- ❌ Do not use NODE_ENV as fallback for APP_ENV in secret selection
- ✅ Only bootstrap credential (`GCP_SECRET_MANAGER_BOOTSTRAP_JSON`) belongs in Replit
- ✅ Rotate secrets via GCP Console — no code changes required
- ✅ Use `versions/latest` — never hardcode a version number
- ✅ Each environment has its own isolated GCP bundle

---

## Onboarding a Fresh Replit Import

1. Import repository from GitHub
2. Open **Replit Secrets**
3. Add **ONE secret**:
   ```
   GCP_SECRET_MANAGER_BOOTSTRAP_JSON = <service account JSON>
   ```
4. `APP_ENV=development` is set automatically by `start-dev.sh` (no Replit Secret needed)
5. Run `pnpm run dev`
6. Loader fetches `cst-super-app-development` bundle automatically
7. DB safety guard verifies development database
8. Application starts — all secrets loaded

**Total manual step: 1 secret.**

---

## Adding a New Secret

1. Add the value to GCP `cst-super-app-development` bundle (development value)
2. Add the value to GCP `cst-super-app-production` bundle (production value)
3. Document the canonical name in `docs/environment-variables.md`
4. Use `process.env.KEY` in application code — no other changes required
5. Do **not** add it to Replit Secrets

---

## Git Pull / Push Safety

`.replit` is intentionally not tracked by Git.
Secret values are never in Git — they remain in GCP Secret Manager.
`docs/GCP_BOOTSTRAP_SECRET_SETUP.md` documents setup steps (no values).
