# CST Super App

A multi-service monorepo ERP/operations platform for logistics and sport center management. Built with TypeScript, Express, React (Vite), Drizzle ORM, and Supabase.

## Project Structure

```
artifacts/
  api-server/       — Express REST API, Drizzle ORM, Supabase Postgres
  bizportal/        — Admin/back-office dashboard (React + Vite)
  customer-portal/  — Public-facing customer app (React + Vite)
  cst-driver/       — Driver-side app
  logistic-order/   — Logistics order management
  qr-menu/          — QR-based menu/ordering
  mockup-sandbox/   — UI prototyping sandbox
config/             — Shared configuration
docs/               — Architecture and deployment documentation
```
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

## Key Architecture Decisions

- **Gateway on port 5000** routes to all internal services
- **APP_ENV** (not NODE_ENV) is the source of truth for dev vs. prod
- **GCP Secret Manager** loads production secrets at startup; dev secrets come from Replit Secrets
- **Supabase** for database (separate dev and prod projects)
- **Accounting entries are immutable** — no updates/deletes on posted journals; reversal only
- **AI is advisor only** — never auto-approves or auto-posts financial entries

## Required Secrets (to run)

See `.env.example` for the full list. Minimum to start the API:
- `GCP_PROJECT_ID`, `GCP_SECRET_ID`, `GCP_SECRET_MANAGER_BOOTSTRAP_JSON`
- `SUPABASE_DATABASE_URL_DEV`
- `SESSION_SECRET`

## To Run (development)

```bash
pnpm install
bash start-dev.sh
```

The gateway starts on port 5000 and proxies to all sub-services.
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

## Key Documentation

- `AI_ARCHITECTURE_GUARDRAILS.md` — Architecture constitution
- `ARCHITECTURE_DECISIONS.md` — Formal ADRs
- `AI_RULES.md` — Rules for AI agents
- `docs/` — Deployment, secret architecture, and more

## User Preferences

- This project was imported for exploration/study purposes only.
- `APP_ENV=development` is enforced in every `start-dev.sh` — never change this.
- `load-secrets.mjs` runs before the server starts and injects secrets. `*_DEV` keys from GCP (or Replit Secrets) are promoted to their canonical names in dev mode.
- The API server will **refuse to start** if it detects a production database in development mode. Always ensure `SUPABASE_DATABASE_URL_DEV` is set.
- See `AI_ARCHITECTURE_GUARDRAILS.md` and `ARCHITECTURE_DECISIONS.md` for immutable architecture rules.

## User preferences

- Keep the existing monorepo structure and stack
- Use pnpm (not npm or yarn)
