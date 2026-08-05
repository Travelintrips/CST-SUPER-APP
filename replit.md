# CST Super App

B2B Marketplace and Logistics platform — pnpm monorepo with 5 services.

## Stack

- **Backend:** Node.js 20, Express, Drizzle ORM, PostgreSQL (Supabase)
- **Frontend:** React 19, Vite 7, Tailwind CSS 4, Radix UI, TanStack Query
- **Monorepo:** pnpm workspaces, TypeScript

## Services

| Service | Dev Port | Description |
|---|---|---|
| Gateway | 5000 | Reverse proxy routing all services (main entry point) |
| API Server | 18444 | Express REST API (`/api/*`) |
| BizPortal | 6800 | Business admin frontend (`/bizportal/*`) |
| Customer Portal | 23434 | Public-facing B2B marketplace frontend (`/`) |
| Logistic Order | 19368 | Logistics management frontend (`/logistic-order/*`) |

## Running in Development

All services have Replit workflows configured. Start them from the Workflows panel (or run the "Project" workflow to start all in parallel). Install dependencies first if needed:

```bash
pnpm install
```

**Workflows:**
- **Start application** — `node gateway.mjs` — main entry point (port 5000)
- **artifacts/api-server: API Server** — `pnpm --filter @workspace/api-server run dev`
- **artifacts/bizportal: web** — `pnpm --filter @workspace/bizportal run dev`
- **artifacts/customer-portal: web** — `bash start-dev.sh`
- **artifacts/logistic-order: web** — `bash start-dev.sh`

## Required Replit Secrets

| Secret | Purpose |
|---|---|
| `GCP_PROJECT_ID` | GCP project that owns Secret Manager |
| `GCP_SECRET_ID` | Secret name in Secret Manager (e.g. `replit-app-secrets`) |
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Service account JSON with `roles/secretmanager.secretAccessor` |
| `SUPABASE_DATABASE_URL_DEV` | Dev Supabase connection string — keeps dev code off the production DB |

All other app secrets (OpenAI, Paylabs, SMTP, Supabase prod URL, etc.) are loaded automatically from GCP Secret Manager at startup via `artifacts/api-server/load-secrets.mjs`.

## Secret Architecture

```
Replit Secrets (bootstrap only)
  GCP_PROJECT_ID + GCP_SECRET_ID + GCP_SECRET_MANAGER_BOOTSTRAP_JSON
  SUPABASE_DATABASE_URL_DEV  (dev DB isolation — not in GCP)
          ↓
Google Cloud Secret Manager
  APP_ENV=development → injects *_DEV keys as canonical names
  APP_ENV=production  → injects production keys only
          ↓
process.env (full application secrets)
```

## Production Deployment

**Deployment target:** `vm` (background workers must run continuously)

**Build:** `pnpm install && APP_ENV=production node artifacts/api-server/load-secrets.mjs pnpm run build`
- Loads production GCP secrets so VITE_ env vars are baked with production Supabase URL

**Run:** `bash start-prod.sh`
- Starts API Server, BizPortal, Customer Portal, Logistic Order, then Gateway (port 5000)

The `[deployment]` section in `.replit` is already configured — click **Publish** to deploy.

### Dev DB Guard

The API server blocks startup if it detects the production Supabase URL in development mode (to prevent accidental data mutations). Fix with either:
- **Option A (recommended):** `SUPABASE_DATABASE_URL_DEV` Replit Secret pointing to a dev Supabase project
- **Option B:** `ALLOW_PRODUCTION_DB_IN_DEVELOPMENT=true` env var (explicitly allows prod DB in dev)

## Architecture Rules

Before making changes, read:
- `AI_ARCHITECTURE_GUARDRAILS.md` — environment isolation, secret management, accounting rules
- `ARCHITECTURE_DECISIONS.md` — formal ADRs that must not be reversed
- `AI_RULES.md` — rules for AI agents

## User Preferences

- Use pnpm (not npm/yarn) for all package management
- Keep existing project structure and monorepo layout.
- Gunakan Bahasa Indonesia saat berkomunikasi dengan user.
