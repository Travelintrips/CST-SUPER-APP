# Environment Variables

> **Architecture:** All application secrets are managed by Google Cloud Secret Manager.  
> See [`docs/secret-architecture.md`](secret-architecture.md) for the full diagram and specification.

---

## Replit Secrets (Bootstrap Only)

Only these three secrets belong in Replit. Everything else is loaded automatically.

| Secret | Description |
|---|---|
| `GCP_PROJECT_ID` | GCP project ID (e.g. `secret-504012`) |
| `GCP_SECRET_ID` | Secret name in Secret Manager (e.g. `replit-app-secrets`) |
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Service account JSON with Secret Manager read access |

**Do not add any application secrets to Replit.** They are fetched automatically at startup.

---

## Application Secrets (Google Cloud Secret Manager)

These secrets live **only in GCP Secret Manager**, never in Replit.  
Application code reads the canonical name (no `_DEV` suffix).

### Database

| Canonical `process.env` key | Production key (GCP) | Development key (GCP) |
|---|---|---|
| `SUPABASE_DATABASE_URL` | `SUPABASE_DATABASE_URL` | `SUPABASE_DATABASE_URL_DEV` |
| `VITE_SUPABASE_URL` | `VITE_SUPABASE_URL` | `VITE_SUPABASE_URL_DEV` |
| `VITE_SUPABASE_ANON_KEY` | `VITE_SUPABASE_ANON_KEY` | `VITE_SUPABASE_ANON_KEY_DEV` |

### Auth / Session

| Canonical `process.env` key | Production key (GCP) | Development key (GCP) |
|---|---|---|
| `SESSION_SECRET` | `SESSION_SECRET` | `SESSION_SECRET_DEV` |

### AI / LLM

| Canonical `process.env` key | Production key (GCP) | Development key (GCP) |
|---|---|---|
| `OPENAI_API_KEY` | `OPENAI_API_KEY` | `OPENAI_API_KEY_DEV` |

### Payment Gateway

| Canonical `process.env` key | Production key (GCP) | Development key (GCP) |
|---|---|---|
| `PAYLABS_PRIVATE_KEY` | `PAYLABS_PRIVATE_KEY` | `PAYLABS_PRIVATE_KEY_DEV` |

### Messaging

| Canonical `process.env` key | Production key (GCP) | Development key (GCP) |
|---|---|---|
| `FONNTE_TOKEN` | `FONNTE_TOKEN` | `FONNTE_TOKEN_DEV` |

### Google Services

| Canonical `process.env` key | Production key (GCP) | Development key (GCP) |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `GOOGLE_SERVICE_ACCOUNT_JSON` | `GOOGLE_SERVICE_ACCOUNT_JSON_DEV` |

### Version Control

| Canonical `process.env` key | Production key (GCP) | Development key (GCP) |
|---|---|---|
| `GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN` | `GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN` | `GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN_DEV` |

---

## Environment Selection

The loader reads `APP_ENV` (priority) or `NODE_ENV` (fallback) to decide which keys to inject:

| `APP_ENV` | Keys selected from GCP payload | Injected as |
|---|---|---|
| `production` | `SUPABASE_DATABASE_URL` | `process.env.SUPABASE_DATABASE_URL` |
| `development` | `SUPABASE_DATABASE_URL_DEV` | `process.env.SUPABASE_DATABASE_URL` |

If neither `APP_ENV` nor `NODE_ENV` is set → **startup fails** (no fallback).

---

## Startup Commands

```bash
# Development
pnpm run dev
# load-secrets.mjs runs automatically, selects *_DEV keys from GCP

# Production
npm run start:secure
# load-secrets.mjs runs automatically, selects production keys from GCP
```

---

> Values are never documented here. Only key names. See SECRET_MANAGER_RULES.md for security policy.
