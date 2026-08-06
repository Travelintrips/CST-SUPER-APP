# CST Super App

B2B Marketplace and Logistics platform — pnpm monorepo with multiple services.

## Stack

- **Backend:** Node.js 20, Express, Drizzle ORM, PostgreSQL (Supabase)
- **Frontend:** React 19, Vite 7, Tailwind CSS 4, Radix UI, TanStack Query
- **Monorepo:** pnpm workspaces, TypeScript

## Running on Replit

### Required Replit Secrets

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

## Architecture Notes

- `APP_ENV=development` is enforced in every `start-dev.sh` — never change this.
- `load-secrets.mjs` runs before the server starts and injects secrets. `*_DEV` keys from GCP (or Replit Secrets) are promoted to their canonical names in dev mode.
- The API server will **refuse to start** if it detects a production database in development mode. Always ensure `SUPABASE_DATABASE_URL_DEV` is set.
- See `AI_ARCHITECTURE_GUARDRAILS.md` and `ARCHITECTURE_DECISIONS.md` for immutable architecture rules.

## User Preferences

- Keep existing project structure and stack intact — do not restructure or migrate without explicit request.
