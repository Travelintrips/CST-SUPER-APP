# CST Super App

B2B Marketplace and Logistics platform — a pnpm monorepo with multiple services.

## Stack

- **Backend:** Node.js 20, Express, Drizzle ORM, PostgreSQL (Supabase)
- **Frontend:** React 19, Vite 7, Tailwind CSS 4, Radix UI, TanStack Query
- **Monorepo:** pnpm workspaces, TypeScript

## Services

| Service | Dev Port | Description |
|---|---|---|
| Gateway | 5000 | Reverse proxy routing all services; primary internal entrypoint |
| API Server | 18444 | Express REST API (proxied via Gateway) |
| BizPortal | 6800 | Business admin frontend |
| Customer Portal | 23434 | Public-facing B2B marketplace frontend (exposed on external port 80) |
| Logistic Order | 19368 | Logistics management frontend |

---

## Getting Started

### 1. Add Bootstrap Credentials to Replit Secrets

Only **three** secrets belong in Replit. Everything else is loaded automatically from Google Cloud Secret Manager.

| Secret | Purpose |
|---|---|
| `GCP_PROJECT_ID` | GCP project that owns the Secret Manager secrets |
| `GCP_SECRET_ID` | Secret name in Secret Manager (e.g. `replit-app-secrets`) |
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Service account JSON with `roles/secretmanager.secretAccessor` |

### 2. Run the Application

```bash
# Install dependencies
pnpm install

# Development (loads secrets from GCP automatically)
pnpm run dev

# Production (load secrets then start server)
npm run start:secure
```

Loader (`load-secrets.mjs`) runs **once at startup** and injects all application secrets from GCP Secret Manager into `process.env` before the server starts.

> **No manual secret copying required.** You do not need to add `SUPABASE_DATABASE_URL`, `OPENAI_API_KEY`, `SESSION_SECRET`, or any other application secret to Replit.

### 3. Secret Architecture

```
Replit Secrets (bootstrap only)
  GCP_PROJECT_ID + GCP_SECRET_ID + GCP_SECRET_MANAGER_BOOTSTRAP_JSON
          ↓
Google Cloud Secret Manager
  projects/{GCP_PROJECT_ID}/secrets/{GCP_SECRET_ID}/versions/latest
          ↓
load-secrets.mjs
  – reads APP_ENV / NODE_ENV
  – development: injects *_DEV keys as canonical names
  – production:  injects production keys only
          ↓
process.env (full application secrets available)
          ↓
API Server  →  BizPortal  →  Customer Portal
```

See [`docs/secret-architecture.md`](docs/secret-architecture.md) for the complete specification.

---

## Port Architecture

The Gateway (port 5000) orchestrates internal service routing. The Customer Portal (port 23434) is additionally exposed directly on external port 80 as it is the primary public-facing application. BizPortal is exposed on port 6800 for admin access.

## Deployment

```bash
# Build all packages
pnpm run build

# Start with secrets loaded from GCP
npm run start:secure
```

Entry point: `node artifacts/api-server/dist/index.mjs`

For full deployment documentation see [`docs/deployment/`](docs/deployment/).

---

## ⚠️ Architecture Rules

**All AI agents and developers must read these documents before making changes:**

| Document | Purpose |
|---|---|
| [`AI_ARCHITECTURE_GUARDRAILS.md`](AI_ARCHITECTURE_GUARDRAILS.md) | Architecture constitution — environment isolation, secret management, accounting rules |
| [`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md) | Formal ADRs (ADR-0001 to ADR-0004) — permanent decisions that must not be reversed |
| [`AI_RULES.md`](AI_RULES.md) | Rules for AI agents — what is forbidden and why |

### Critical Guardrails Summary

1. **Dev/Prod are permanently separate** — different DB, different secrets, different startup scripts (`dev.mjs` vs `production.mjs`). Never merge them.
2. **`APP_ENV` is the source of truth** — not `NODE_ENV`. Never delete or replace `APP_ENV`.
3. **GCP Secret Manager for production** — Replit Secrets hold only the 3 bootstrap keys. Never add application secrets to Replit.
4. **Accounting is immutable** — no UPDATE or DELETE on posted journals. Reversal only.
5. **Universal Journal Reuse** — always check for existing journal before creating a new one.
6. **AI is advisor only** — AI must never auto-approve or auto-post financial entries.
