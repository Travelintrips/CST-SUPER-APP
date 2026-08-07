# Environment Variables

> **Architecture:** All application secrets are managed by Google Cloud Secret Manager.
> See [`docs/secret-architecture.md`](secret-architecture.md) for the full diagram and specification.

---

## Replit Secrets (Bootstrap Only)

### New Mode — ONE Secret Required (Recommended)

A fresh GitHub import needs only **one** Replit Secret:

| Secret | Description |
|---|---|
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Service Account JSON with Secret Manager Secret Accessor role. Contains `project_id`, `client_email`, `private_key`. |

The loader extracts `project_id` from the JSON and derives the bundle name from `APP_ENV`.
`APP_ENV` is set automatically by `start-dev.sh` — no Replit Secret needed for it.

### Legacy Mode — Three Secrets (Deprecated)

Existing environments that still have these set will run in legacy backward-compat mode:

| Secret | Description |
|---|---|
| `GCP_PROJECT_ID` | GCP project ID (e.g. `secret-504012`) |
| `GCP_SECRET_ID` | Secret bundle name in Secret Manager (single mixed bundle) |
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Service account JSON |

> **Migrate:** Remove `GCP_PROJECT_ID` and `GCP_SECRET_ID` after creating separate GCP bundles.
> See `docs/GCP_BOOTSTRAP_SECRET_SETUP.md` for migration steps.

**Do not add any application secrets to Replit.** They are fetched automatically at startup.

---

## Application Secrets (Google Cloud Secret Manager)

These secrets live **only in GCP Secret Manager**, never in Replit.

In new-mode bundles, all secrets use canonical names (no `_DEV` suffix — each bundle is environment-specific).

### Database

| Canonical `process.env` key | In `cst-super-app-development` | In `cst-super-app-production` |
|---|---|---|
| `SUPABASE_DATABASE_URL` | dev database URL | prod database URL |
| `VITE_SUPABASE_URL` | dev Supabase project URL | prod Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | dev anon key | prod anon key |

### Auth / Session

| Canonical `process.env` key | In development bundle | In production bundle |
|---|---|---|
| `SESSION_SECRET` | dev session secret (min 32 chars) | prod session secret (min 32 chars) |

### AI / LLM

| Canonical `process.env` key | In development bundle | In production bundle |
|---|---|---|
| `OPENAI_API_KEY` | dev OpenAI key | prod OpenAI key |

### Payment Gateway

| Canonical `process.env` key | In development bundle | In production bundle |
|---|---|---|
| `PAYLABS_PRIVATE_KEY` | dev RSA private key PEM | prod RSA private key PEM |

### Messaging

| Canonical `process.env` key | In development bundle | In production bundle |
|---|---|---|
| `FONNTE_TOKEN` | dev Fonnte token | prod Fonnte token |

### Google Services

| Canonical `process.env` key | In development bundle | In production bundle |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | dev Google SA JSON | prod Google SA JSON |

### Version Control

| Canonical `process.env` key | In development bundle | In production bundle |
|---|---|---|
| `GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN` | dev PAT | prod PAT |

---

## Required vs Optional Secrets

### REQUIRED (startup fails if missing)

| Secret | Reason |
|---|---|
| `SESSION_SECRET` | Express session signing — min length 32 |
| `SUPABASE_DATABASE_URL` | Database connection — app cannot function without it |

### INTEGRATION / OPTIONAL (warn-only — features disabled if missing)

| Secret | Feature disabled if absent |
|---|---|
| `PORTAL_ADMIN_KEY` | Customer portal admin claim + internal audit endpoints (fail-closed: 401/403/503) |
| `OPENAI_API_KEY` | AI assistant / expense classifier / chatbot |
| `PAYLABS_PRIVATE_KEY` | Paylabs payment gateway |
| `FONNTE_TOKEN` | WhatsApp messaging via Fonnte |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Sheets / Drive nightly sync |

### DEAD CODE / NOT USED

| Secret | Status |
|---|---|
| `CASHIER_TOKEN_SECRET` | No active business code uses this — do not add |
| `GCP_PROJECT_ID` | Deprecated — project_id now extracted from bootstrap JSON |
| `GCP_SECRET_ID` | Deprecated — bundle name now derived from APP_ENV |

---

## Environment Selection

`APP_ENV` is the **sole source of truth** for secret bundle selection.
`NODE_ENV` is used by framework libraries only — NOT for selecting secrets or DB.

| `APP_ENV` | Bundle fetched | Injected as |
|---|---|---|
| `development` | `cst-super-app-development` | `process.env.KEY` (canonical, no `_DEV`) |
| `production` | `cst-super-app-production` | `process.env.KEY` (canonical) |
| not set | — | **STARTUP FAILS** |
| any other value | — | **STARTUP FAILS** |

---

## Startup Commands

```bash
# Development
pnpm run dev
# start-dev.sh sets APP_ENV=development → load-secrets.mjs → cst-super-app-development bundle

# Production
npm run start:secure
# APP_ENV=production → load-secrets.mjs → cst-super-app-production bundle

# Validate credentials without starting app
node artifacts/api-server/load-secrets.mjs --validate
```

---

> Values are never documented here. Only key names. See `SECRET_MANAGER_RULES.md` for security policy.
