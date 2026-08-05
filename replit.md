# CST Super App

B2B Marketplace and Logistics platform — pnpm monorepo with multiple services.

## Stack

- **Backend:** Node.js 20, Express, Drizzle ORM, PostgreSQL (Supabase)
- **Frontend:** React 19, Vite 7, Tailwind CSS 4, Radix UI, TanStack Query
- **Monorepo:** pnpm workspaces, TypeScript

## Services

| Service | Internal Port | Description |
|---|---|---|
| Gateway | 5000 | Reverse proxy; main entrypoint (preview pane) |
| API Server | 18444 | Express REST API |
| BizPortal | 18442 | Business admin frontend (`/bizportal/`) |
| Customer Portal | 23434 | Public B2B marketplace (`/`) |
| Logistic Order | 19368 | Logistics management frontend (`/logistic-order/`) |

## Running on Replit

**One workflow runs everything:** `Start application` → `bash start-dev-all.sh`

This script:
1. Starts the Gateway on port 5000 (what the preview pane shows)
2. Spawns the API server with GCP Secret Manager bootstrap (`dev:secure`)
3. Spawns BizPortal, Customer Portal, and Logistic Order frontends
4. Starts the system watchdog on port 3001

### Required Replit Secrets

| Secret | Purpose |
|---|---|
| `GCP_PROJECT_ID` | GCP project owning the secrets |
| `GCP_SECRET_ID` | Secret name in GCP Secret Manager |
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Service account JSON (secretAccessor role) |
| `SUPABASE_DATABASE_URL_DEV` | Dev database URL (prevents prod DB in dev) |

### Required Environment Variables

| Variable | Value |
|---|---|
| `APP_ENV` | `development` |

All other secrets (Supabase keys, OpenAI, Paylabs, etc.) are loaded automatically from GCP Secret Manager at startup.

## Architecture Notes

- **Secret loading:** `load-secrets.mjs` fetches all secrets from GCP at startup. In development, `*_DEV` keys override their canonical names (e.g. `SUPABASE_DATABASE_URL_DEV` → `SUPABASE_DATABASE_URL`).
- **Dev/prod isolation:** `APP_ENV=development` is mandatory. The API server refuses to start if it detects a production database in development mode.
- **Accounting immutability:** No UPDATE/DELETE on posted journal entries — reversal only.
- **AI advisor only:** AI recommendations must never auto-approve or auto-post financial entries.

## User Preferences

_Add any preferences here._
