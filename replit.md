# CST Super App

B2B Marketplace and Logistics platform — a pnpm monorepo with multiple services.

## Architecture

### Sub-apps (`artifacts/`)
| App | Port | Purpose |
|-----|------|---------|
| `api-server` | 18444 | Core REST API (Express + Drizzle ORM + Supabase Postgres) |
| `bizportal` | 18442 | Admin/back-office UI (React + Vite) |
| `customer-portal` | 23434 | Customer-facing storefront/booking UI |
| `logistic-order` | 19368 | Logistics order management UI |
| `cst-driver` | — | Driver app (React Native / Expo) |
| `customer-poster` | — | Customer poster/print generation |
| `qr-menu` | — | QR-code menu viewer |
| `mockup-sandbox` | — | UI component mockup sandbox |

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
| `SUPABASE_DATABASE_URL_DEV` | PostgreSQL connection string for the **dev** Supabase project |
| `SUPABASE_URL_DEV` | Supabase API URL for the dev project |
| `SUPABASE_ANON_KEY_DEV` | Anon key for the dev project |
| `SUPABASE_SERVICE_ROLE_KEY_DEV` | Service role key for the dev project |

All other application secrets (OpenAI, Paylabs, SMTP, etc.) are loaded automatically from Google Cloud Secret Manager at startup via `load-secrets.mjs`. The `_DEV` Supabase keys above are read from Replit Secrets directly as a local override.

### Services & Ports

| Service | Dev Port | Workflow name |
|---|---|---|
| API Server | 18444 | `artifacts/api-server: API Server` |
| BizPortal (admin) | 18442 | `artifacts/bizportal: web` |
| Customer Portal | 23434 | `artifacts/customer-portal: web` |
| Logistic Order | varies | `artifacts/logistic-order: web` |
| CST Driver (Expo) | — | `artifacts/cst-driver: expo` |

### Start / Restart

Each service has its own workflow. Start or restart them from the Workflows panel. The API server must be running for the frontends to function fully.

```bash
# Install all dependencies (run once after cloning or adding packages)
pnpm install
```

## Architecture rules

- `APP_ENV` (not `NODE_ENV`) is the source of truth for environment
- Dev and prod are permanently separate databases — never merge
- Accounting entries are immutable once posted (reversal only)
- AI is advisor only — never auto-approves or auto-posts financial entries

- `APP_ENV=development` is enforced in every `start-dev.sh` — never change this.
- `load-secrets.mjs` runs before the server starts and injects secrets. `*_DEV` keys from GCP (or Replit Secrets) are promoted to their canonical names in dev mode.
- The API server will **refuse to start** if it detects a production database in development mode. Always ensure `SUPABASE_DATABASE_URL_DEV` is set.
- See `AI_ARCHITECTURE_GUARDRAILS.md` and `ARCHITECTURE_DECISIONS.md` for immutable architecture rules.

## User preferences

- Keep the existing monorepo structure and stack
- Use pnpm (not npm or yarn)
