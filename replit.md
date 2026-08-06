# CST Super App

B2B Marketplace and Logistics platform — a pnpm monorepo with multiple services.

## Stack

- **Backend:** Node.js 20, Express, Drizzle ORM, PostgreSQL (Supabase)
- **Frontend:** React 19, Vite 7, Tailwind CSS 4, Radix UI, TanStack Query
- **Monorepo:** pnpm workspaces, TypeScript

## Services

| Service | Dev Port | Description |
|---|---|---|
| Gateway | 5000 | Reverse proxy — primary entry point (webview) |
| API Server | 18444 | Express REST API |
| BizPortal | 18442 | Business admin frontend (`/bizportal/*`) |
| Customer Portal | 23434 | Public-facing B2B marketplace (`/*`) |
| Logistic Order | 19368 | Logistics management frontend (`/logistic-order/*`) |

## How to run

The **"Start application"** workflow runs `APP_ENV=development bash start-dev-all.sh`, which:
1. Installs any missing dependencies via `scripts/ensure-deps.sh`
2. Spawns all services (api-server, bizportal, customer-portal, logistic-order) with auto-restart
3. Starts the Gateway on port 5000 once the API server is healthy

## Required secrets (Replit Secrets)

| Secret | Purpose |
|---|---|
| `GCP_PROJECT_ID` | GCP project that owns the Secret Manager secrets |
| `GCP_SECRET_ID` | Secret name in Secret Manager (e.g. `replit-app-secrets`) |
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Service account JSON with `roles/secretmanager.secretAccessor` |
| `SUPABASE_DATABASE_URL_DEV` | Dev Supabase pooler URL (required — dev mode blocks prod DB by default) |

All other secrets (Supabase keys, OpenAI, etc.) are loaded automatically from GCP Secret Manager at startup.

## Architecture rules

- `APP_ENV` (not `NODE_ENV`) is the source of truth for environment
- Dev and prod are permanently separate databases — never merge
- Accounting entries are immutable once posted (reversal only)
- AI is advisor only — never auto-approves or auto-posts financial entries

See `AI_ARCHITECTURE_GUARDRAILS.md`, `ARCHITECTURE_DECISIONS.md`, and `AI_RULES.md` before making changes.

## User preferences

- Keep the existing monorepo structure and stack
