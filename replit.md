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

## Key Documentation

- `AI_ARCHITECTURE_GUARDRAILS.md` — Architecture constitution
- `ARCHITECTURE_DECISIONS.md` — Formal ADRs
- `AI_RULES.md` — Rules for AI agents
- `docs/` — Deployment, secret architecture, and more

## User Preferences

- This project was imported for exploration/study purposes only.
