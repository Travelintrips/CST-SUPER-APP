# AI_RULES.md

Rules for AI agents (Replit Agent, Cursor, Copilot, Claude, etc.) working on this project.

---

## CRITICAL: Secret Management

### NEVER instruct developers to add application secrets to Replit Secrets

The **only** secrets that belong in Replit are:

```
GCP_PROJECT_ID
GCP_SECRET_ID
GCP_SECRET_MANAGER_BOOTSTRAP_JSON
```

**All other secrets come from Google Cloud Secret Manager automatically.**

### NEVER suggest storing these in Replit:

- `SUPABASE_DATABASE_URL`
- `OPENAI_API_KEY`
- `PAYLABS_PRIVATE_KEY`
- `FONNTE_TOKEN`
- `SESSION_SECRET`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN`
- Any other application credential

### ALWAYS reference the correct architecture

When a developer needs a new secret:

1. Add it to GCP Secret Manager payload (both `KEY` and `KEY_DEV`)
2. Use `process.env.KEY` in application code
3. Document the name in `docs/secret-architecture.md`
4. Do NOT add it to Replit

---

## Getting Started Instructions

When asked how to run this project, always say:

```
1. Add GCP_PROJECT_ID, GCP_SECRET_ID, GCP_SECRET_MANAGER_BOOTSTRAP_JSON to Replit Secrets
2. Run: pnpm run dev
3. All secrets are loaded automatically from Google Cloud Secret Manager
```

Never say: "Add SUPABASE_DATABASE_URL to Replit Secrets" or equivalent.

---

## Code Rules

### Do NOT hardcode secrets

```typescript
// ❌ WRONG
const dbUrl = "postgres://user:password@host/db";

// ✅ CORRECT
const dbUrl = process.env.SUPABASE_DATABASE_URL;
```

### Do NOT log secret values

```typescript
// ❌ WRONG
console.log("DB URL:", process.env.SUPABASE_DATABASE_URL);

// ✅ CORRECT
console.log("DB URL: [set]");
```

### Do NOT read _DEV variants in application code

```typescript
// ❌ WRONG (application code)
const url = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL;

// ✅ CORRECT (load-secrets.mjs handles the mapping)
const url = process.env.SUPABASE_DATABASE_URL;
```

---

## Architecture Reference

```
Replit Secrets (bootstrap only)
  GCP_PROJECT_ID + GCP_SECRET_ID + GCP_SECRET_MANAGER_BOOTSTRAP_JSON
          ↓
Google Cloud Secret Manager
  Full secret payload (prod + dev variants)
          ↓
load-secrets.mjs (startup, once)
  – reads APP_ENV / NODE_ENV
  – injects appropriate keys into process.env
          ↓
Application
  process.env.SUPABASE_DATABASE_URL  (always canonical, never _DEV)
```

---

## Security Checklist (run before every PR)

- [ ] No secrets hardcoded in source code
- [ ] No secrets committed to git
- [ ] No secret values logged or printed
- [ ] No application secrets added to Replit Secrets
- [ ] New secrets documented in `docs/secret-architecture.md`
- [ ] `load-secrets.mjs` updated if new bootstrap credentials needed
- [ ] `SECRET_MANAGER_RULES.md` still reflects current architecture

---

## Files to Read Before Touching Secrets

1. `SECRET_MANAGER_RULES.md` — mandatory rules
2. `docs/secret-architecture.md` — full architecture with diagram
3. `docs/environment-variables.md` — list of all secrets and their GCP key names
4. `artifacts/api-server/load-secrets.mjs` — the loader implementation

---

## ⛔ AI MUST NEVER — ARCHITECTURE VIOLATIONS

> These rules exist because AI agents have repeatedly made the same mistakes.
> Each item below has caused or would cause production incidents.

### Environment Isolation (NEVER violate)

- ❌ **NEVER** merge dev and production environment
- ❌ **NEVER** merge `dev.mjs` and `production.mjs` into a single startup script
- ❌ **NEVER** delete `dev.mjs`
- ❌ **NEVER** delete `production.mjs`
- ❌ **NEVER** delete `load-secrets.mjs`
- ❌ **NEVER** remove or replace `APP_ENV` with `NODE_ENV` alone
- ❌ **NEVER** assume `APP_ENV === NODE_ENV`
- ❌ **NEVER** simplify environment setup by removing isolation layers
- ❌ **NEVER** merge dev and production secret loading paths

### Secret Management (NEVER violate)

- ❌ **NEVER** replace GCP Secret Manager with Replit Secrets for application secrets
- ❌ **NEVER** add `SUPABASE_DATABASE_URL` directly to Replit Secrets
- ❌ **NEVER** add any application secret (OpenAI, Paylabs, etc.) to Replit Secrets
- ❌ **NEVER** remove the GCP bootstrap flow
- ❌ **NEVER** merge dev and production secret payloads

### Database (NEVER violate)

- ❌ **NEVER** allow dev code to connect to production database
- ❌ **NEVER** add a fallback from dev DB to prod DB
- ❌ **NEVER** share database credentials between environments
- ❌ **NEVER** run migrations against production from a dev context

### Accounting & Finance (NEVER violate)

- ❌ **NEVER** UPDATE or DELETE a posted `accounting_entries` record
- ❌ **NEVER** auto-approve a journal without human review
- ❌ **NEVER** auto-post a journal (status must stay `draft` until human approves)
- ❌ **NEVER** create a new journal if one already exists for the same `(source, source_id)`
- ❌ **NEVER** bypass `MANUAL_REVIEW_REQUIRED` status with an auto-approval fallback
- ❌ **NEVER** bypass the maker-checker requirement for COA changes
- ❌ **NEVER** silently swallow errors that would otherwise block a financial posting

---

## Architecture Guardrails Reference

Before making any change, read these documents:

| Document | What it covers |
|---|---|
| `AI_ARCHITECTURE_GUARDRAILS.md` | Full architecture constitution |
| `ARCHITECTURE_DECISIONS.md` | ADR-0001 to ADR-0004 (formal decisions) |
| `docs/secret-architecture.md` | Secret management architecture |
| `docs/db-dev-prod-safety.md` | Database isolation policy |
| `COA_MASTER_GOVERNANCE.md` | COA governance and maker-checker rules |
