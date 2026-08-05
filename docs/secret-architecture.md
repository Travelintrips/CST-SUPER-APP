# Secret Architecture

**Version:** 2.0  
**Status:** Mandatory  
**Applies to:** All services — API Server, BizPortal, Customer Portal, Logistic Order, Driver App

---

## Objective

Google Cloud Secret Manager is the **single source of truth** for all application secrets.  
Replit Secrets store **only the three bootstrap credentials** needed to access Secret Manager.

Developers never copy application secrets into Replit manually.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  REPLIT SECRETS  (bootstrap credentials only)                       │
│                                                                     │
│  GCP_PROJECT_ID                   ← GCP project ID                 │
│  GCP_SECRET_ID                    ← Secret name in Secret Manager  │
│  GCP_SECRET_MANAGER_BOOTSTRAP_JSON ← Service account JSON          │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GOOGLE CLOUD SECRET MANAGER                                        │
│                                                                     │
│  projects/{GCP_PROJECT_ID}/secrets/{GCP_SECRET_ID}/versions/latest │
│                                                                     │
│  Payload (JSON object):                                             │
│  {                                                                  │
│    "SUPABASE_DATABASE_URL":     "postgres://prod...",               │
│    "SUPABASE_DATABASE_URL_DEV": "postgres://dev...",                │
│    "OPENAI_API_KEY":            "sk-prod...",                       │
│    "OPENAI_API_KEY_DEV":        "sk-dev...",                        │
│    "SESSION_SECRET":            "...",                              │
│    "SESSION_SECRET_DEV":        "...",                              │
│    ...                                                              │
│  }                                                                  │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  load-secrets.mjs   (startup, runs once)                            │
│                                                                     │
│  reads: APP_ENV (or NODE_ENV)                                       │
│                                                                     │
│  if APP_ENV=development:                                            │
│    SUPABASE_DATABASE_URL_DEV → process.env.SUPABASE_DATABASE_URL   │
│    OPENAI_API_KEY_DEV        → process.env.OPENAI_API_KEY           │
│    SESSION_SECRET_DEV        → process.env.SESSION_SECRET           │
│    (production keys ignored — strict isolation)                     │
│                                                                     │
│  if APP_ENV=production:                                             │
│    SUPABASE_DATABASE_URL     → process.env.SUPABASE_DATABASE_URL   │
│    OPENAI_API_KEY            → process.env.OPENAI_API_KEY           │
│    SESSION_SECRET            → process.env.SESSION_SECRET           │
│    (_DEV keys ignored — strict isolation)                           │
│                                                                     │
│  APP_ENV / NODE_ENV not set → startup FAILS (no fallback)          │
│  Bootstrap credentials missing → startup FAILS (no fallback)       │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ process.env (canonical names, no _DEV suffix)
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  APPLICATION                                                        │
│                                                                     │
│  API Server     → reads process.env.SUPABASE_DATABASE_URL           │
│  BizPortal      → reads process.env.VITE_SUPABASE_URL               │
│  Customer Portal → reads process.env.VITE_SUPABASE_URL              │
│                                                                     │
│  Application code NEVER reads *_DEV variants.                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Bootstrap Credentials (Replit Secrets)

| Secret | Description | Who uses it |
|---|---|---|
| `GCP_PROJECT_ID` | GCP project ID (e.g. `secret-504012`) | `load-secrets.mjs` |
| `GCP_SECRET_ID` | Secret name in Secret Manager (e.g. `replit-app-secrets`) | `load-secrets.mjs` |
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Service account JSON with `roles/secretmanager.secretAccessor` | `load-secrets.mjs` |

**No other secrets belong in Replit.**

## Git Pull / Push Safety

`.replit` is a Replit-managed local configuration file and is intentionally
not tracked by Git. This prevents a later `git pull` from replacing the
current Repl's workflows or local environment configuration.

The Git repository stores only:

- configuration names and documentation;
- `.env.example` with empty values;
- `config/environment-contract.json` with names only.

Secret values are never backed up to Git. They remain in Replit Secrets or
Google Cloud Secret Manager. After the change that untracks `.replit` has been
pushed, future pulls and pushes will not overwrite that local file.

After a pull, `scripts/verify-environment-config.mjs` reports missing
configuration names without printing values. It does not fabricate fallback
values.

---

## Application Secrets (Google Cloud Secret Manager)

All of the following live **only** in GCP Secret Manager, never in Replit.

| Canonical Name (read by app) | Production key in GCP | Development key in GCP |
|---|---|---|
| `SUPABASE_DATABASE_URL` | `SUPABASE_DATABASE_URL` | `SUPABASE_DATABASE_URL_DEV` |
| `VITE_SUPABASE_URL` | `VITE_SUPABASE_URL` | `VITE_SUPABASE_URL_DEV` |
| `VITE_SUPABASE_ANON_KEY` | `VITE_SUPABASE_ANON_KEY` | `VITE_SUPABASE_ANON_KEY_DEV` |
| `SESSION_SECRET` | `SESSION_SECRET` | `SESSION_SECRET_DEV` |
| `OPENAI_API_KEY` | `OPENAI_API_KEY` | `OPENAI_API_KEY_DEV` |
| `PAYLABS_PRIVATE_KEY` | `PAYLABS_PRIVATE_KEY` | `PAYLABS_PRIVATE_KEY_DEV` |
| `FONNTE_TOKEN` | `FONNTE_TOKEN` | `FONNTE_TOKEN_DEV` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `GOOGLE_SERVICE_ACCOUNT_JSON` | `GOOGLE_SERVICE_ACCOUNT_JSON_DEV` |
| `GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN` | `GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN` | `GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN_DEV` |

> **Note:** Values are never shown here. Only key names are documented.

---

## Startup Flow

### Production

```bash
npm run start:secure
# → node load-secrets.mjs node --enable-source-maps ./dist/index.mjs
```

1. `load-secrets.mjs` reads `GCP_PROJECT_ID`, `GCP_SECRET_ID`, `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` from Replit
2. Authenticates with GCP using the bootstrap service account
3. Fetches the secret payload (`versions/latest`)
4. Selects production keys (no `_DEV` suffix) and injects into `process.env`
5. Spawns `node ./dist/index.mjs` with the populated env

### Development

```bash
pnpm run dev
# → bash ./start-dev.sh → node dev.mjs (esbuild watch + auto-restart)
```

Same flow with `APP_ENV=development` — loader selects `*_DEV` keys and injects them under canonical names.

---

## Secret Naming Convention

| Environment | Payload key | Injected as |
|---|---|---|
| Production | `SUPABASE_DATABASE_URL` | `process.env.SUPABASE_DATABASE_URL` |
| Development | `SUPABASE_DATABASE_URL_DEV` | `process.env.SUPABASE_DATABASE_URL` |

**Application code always reads the canonical name** (`SUPABASE_DATABASE_URL`).  
The `_DEV` suffix is a GCP-side convention only — invisible to the application.

---

## Failure Rules

Per `SECRET_MANAGER_RULES.md`:

| Condition | Behaviour |
|---|---|
| Bootstrap credential missing | `process.exit(1)` — startup fails |
| `APP_ENV` / `NODE_ENV` not set | `process.exit(1)` — startup fails |
| GCP fetch error | `process.exit(1)` — startup fails |
| Payload empty or invalid JSON | `process.exit(1)` — startup fails |
| Key already in `process.env` | Skip (existing value wins, no overwrite) |

**No fallbacks. No dummy values. No silent continues.**

---

## Security Rules

- ❌ Do not hardcode any secret in source code
- ❌ Do not commit secrets to git
- ❌ Do not log secret values (key names only are permitted)
- ❌ Do not duplicate secrets between environments
- ❌ Do not store application secrets in Replit Secrets
- ❌ Do not print, return, or expose secret values in API responses
- ✅ Only bootstrap credentials (`GCP_*`) belong in Replit
- ✅ Rotate secrets via GCP Console — no code changes required
- ✅ Use `versions/latest` — never hardcode a version number

---

## Adding a New Secret

1. Add the value to GCP Secret Manager payload (both `KEY` and `KEY_DEV` variants if environments differ)
2. Update this document's table above with the canonical name
3. Use `process.env.KEY` in application code — no other changes required
4. Do **not** add it to Replit Secrets

---

## Onboarding a New Developer

1. Request access to the GCP project (`GCP_PROJECT_ID`)
2. Add these three values to Replit Secrets:
   - `GCP_PROJECT_ID`
   - `GCP_SECRET_ID`
   - `GCP_SECRET_MANAGER_BOOTSTRAP_JSON`
3. Run `pnpm run dev`
4. Done — all secrets are fetched automatically

No manual secret copying. No `.env` files to share.
