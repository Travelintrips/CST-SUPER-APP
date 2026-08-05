# Pre-Production Deployment Checklist

**Version:** RC-2.2  
**Last Updated:** 2026-07-24  
**Complete this checklist before every production deployment.**  
**Each item must be checked by a human — do not auto-check.**

> This checklist is a gate companion to `docs/release/release-readiness.md`.
> The automated production gate (`pnpm run audit:customer-production`) must pass BEFORE
> any human checkboxes here are considered valid.

---

## Phase A — Before Touching Production

### A1. Code & Build

- [ ] **Branch is `main`** — confirm with `git branch --show-current`
- [ ] **Working tree is clean** — `git status` shows no uncommitted changes
- [ ] **Static gate passes** — `pnpm run audit:customer-static` → exit 0
- [ ] **All 917 unit tests pass** — confirmed by static gate output
- [ ] **All 4 packages typecheck** — confirmed by static gate output
- [ ] **All 4 packages build** — confirmed by static gate output

### A2. Secret Rotation

- [ ] **All 19 credentials rotated** — verify each entry in `docs/security/secret-rotation-status.json`
  - [ ] `SESSION_SECRET`
  - [ ] `PORTAL_JWT_SECRET`
  - [ ] `DRIVER_JWT_SECRET`
  - [ ] `CASHIER_TOKEN_SECRET`
  - [ ] `PORTAL_ADMIN_KEY`
  - [ ] `VAPID_PRIVATE_KEY`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - [ ] `SUPABASE_DATABASE_URL`
  - [ ] `SUPABASE_ANON_KEY`
  - [ ] `SUPABASE_MIGRATION_URL`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY_DEV`
  - [ ] `SUPABASE_DATABASE_URL_DEV`
  - [ ] `SUPABASE_ANON_KEY_DEV`
  - [ ] `FONNTE_TOKEN`
  - [ ] `WATI_API_TOKEN`
  - [ ] `SMTP_PASS`
  - [ ] `PAYLABS_PRIVATE_KEY`
  - [ ] `PAYLABS_PRIVATE_KEY_SANDBOX`
  - [ ] `GITHUB_PERSONAL_ACCESS_TOKEN`
  - [ ] `GOOGLE_CLIENT_SECRET`
- [ ] **All old credentials revoked** — confirmed in each provider dashboard
- [ ] **`pnpm run audit:secrets` → exit 0** (PRESENT: N, MISSING: 0, INVALID: 0)
- [ ] **`pnpm run audit:secret-rotation` → exit 0**
- [ ] **`docs/security/secret-rotation-status.json` updated** — `verifiedByOwner: true`

### A3. Dedicated Staging Target

- [ ] **Supabase staging project exists** — confirmed at app.supabase.com
- [ ] **Staging migrations applied** — `pnpm run db:migrate:test` → exit 0
- [ ] **`TEST_DATABASE_URL` injected** into Replit Secrets (development store)
- [ ] **Staging DB connectivity confirmed** — `psql "$TEST_DATABASE_URL" -c "SELECT 1"` → success

### A4. Full HTTP E2E

- [ ] **API server started in E2E mode** against staging DB
- [ ] **`pnpm run audit:customer-http-e2e` → exit 0**
- [ ] **Tenant isolation PASS** — verified in E2E output
- [ ] **Security PASS** — auth + RBAC + token proofs verified in E2E output
- [ ] **Accounting PASS** — journal immutability + period lock verified in E2E output
- [ ] **SSE PASS** — real-time tracking stream verified in E2E output
- [ ] **Cleanup PASS** — all synthetic records deleted after run

### A5. Full Production Gate

- [ ] **`pnpm run audit:customer-production` → exit 0 (GO verdict)**
- [ ] **`summary.json` shows `"production": "GO"`**
- [ ] **No blocker reasons in `summary.json`**

---

## Phase B — Production Infrastructure Verification

### B1. Secrets Injected Into Production

- [ ] **Replit Deploy → Secrets** contains all production-required secrets
  - Verify: `SUPABASE_DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
  - Verify: `SESSION_SECRET`, `PORTAL_JWT_SECRET`, `DRIVER_JWT_SECRET`, `CASHIER_TOKEN_SECRET`
  - Verify: `FONNTE_TOKEN`, `WATI_API_TOKEN`, `SMTP_PASS`
  - Verify: `PAYLABS_PRIVATE_KEY`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`
- [ ] **No placeholder values** — all secrets are real, non-example values

### B2. Production Database

- [ ] **Production Supabase project accessible** — app.supabase.com → project online
- [ ] **Production backup taken** — Supabase → Settings → Backups → confirm latest backup timestamp
- [ ] **Production migrations applied** — `SUPABASE_MIGRATION_URL=<prod-url> pnpm run db:migrate` → exit 0
- [ ] **No pending schema drift** — `pnpm run db:sync:check` → no diff reported

### B3. Storage

- [ ] **Production storage bucket exists** — Supabase → Storage → `attachments` bucket present
- [ ] **Storage policy correct** — only authenticated users can upload; no public write

### B4. External Integrations Verified

- [ ] **Fonnte** — test WA delivery to a known number via the sandbox flow
- [ ] **WATI** — confirm API token is valid (HTTP 200, not 401)
- [ ] **SMTP** — send a test email via `pnpm run audit:secrets --smtp-test`
- [ ] **Paylabs sandbox** — complete a sandbox payment flow end-to-end
- [ ] **Google OAuth** — complete the OAuth login flow in the Customer Portal

---

## Phase C — Production Deployment

### C1. Deploy

- [ ] **Deployment configuration reviewed** — CPU/memory limits appropriate
- [ ] **`pnpm run build` passes on production code** — confirmed in static gate
- [ ] **Deploy initiated** via Replit Deploy → Publish
- [ ] **Deployment completes without error** — Replit deploy logs show success

### C2. Post-Deploy Health Check

- [ ] **Health endpoint OK** — `curl -sf https://<production-domain>/api/health | jq .`
  - Expected: `{"status":"ok","db":"connected","workers":"running"}`
- [ ] **E2E safety guard OK** — `curl -sf https://<production-domain>/api/e2e-safety | jq .`
  - Expected: `{"mode":"production","e2eTestMode":false}`
- [ ] **Customer Portal loads** — navigate to `https://<production-domain>/` → page renders
- [ ] **Login flow works** — complete a customer login (Google OAuth or email/password)
- [ ] **BizPortal loads** — navigate to `https://<production-domain>/bizportal/` → page renders
- [ ] **Admin login works** — log in with an admin account

### C3. Smoke Test

- [ ] **Automated smoke test passes** — run immediately after publish:
  ```bash
  bash scripts/smoke-test-prod.sh https://<production-domain>
  # or: PROD_URL=https://<production-domain> pnpm run smoke:prod
  ```
  Expected output: `✅  SMOKE TEST PASSED — all 5 routes are healthy.`  
  If the script exits non-zero, **do not declare the deploy successful** — check logs and consider rolling back.

- [ ] **Create a trucking inquiry** — submit a booking request in Customer Portal → receive booking number
- [ ] **Admin notification received** — confirm notification appears in BizPortal admin inbox
- [ ] **GPS tracking responds** — open a booking with active status → SSE stream receives events
- [ ] **Invoice generated** — trigger invoice generation from BizPortal → PDF or record created

---

## Phase D — Backup Requirements

> **Required before every production deployment. Never deploy without a verified backup.**

### D1. Database Backup

- [ ] **Production backup taken** — Supabase → Settings → Backups → confirm latest backup timestamp is within 24 hours
- [ ] **Backup download verified** — download and spot-check at least one table from the backup
- [ ] **Backup stored offsite** — copy stored outside Supabase (e.g., encrypted cloud storage)
- [ ] **Restore verified** — backup was successfully restored to a test environment at least once (staging)
- [ ] **Backup verification timestamp recorded** — note date/time of last successful restore test

### D2. Storage Backup

- [ ] **Supabase Storage bucket exported** — `attachments` and `vehicle-images` buckets backed up
- [ ] **Storage backup timestamp recorded**

### D3. Secret Backup Policy

- [ ] **All 19 credentials stored in a secure, offline-accessible secret manager** (not only Replit Secrets)
- [ ] **Secret backup is encrypted** — password manager or encrypted vault
- [ ] **Access to secret backup confirmed** — at least two authorized persons can access it

### D4. Configuration Snapshot

- [ ] **`.replit` and workflow configuration snapshot taken** — export or document current workflow config
- [ ] **Environment variable list documented** (names only, not values) — `pnpm run audit:secrets --list-keys`

### D5. Migration Snapshot

- [ ] **Current schema state documented** — `pnpm run db:sync:check` output captured
- [ ] **Applied migration list recorded** — list of all migrations applied to production as of this release

### D6. Rollback Verification

- [ ] **Rollback procedure tested on staging** — application rolled back to previous version, health checks passed
- [ ] **Database rollback procedure confirmed** — team knows Supabase backup restore procedure
- [ ] **Secret rollback procedure confirmed** — old credentials are available for emergency re-injection
- [ ] **Owner sign-off on backup completeness** — owner confirms all backup items above are complete

---

## Phase E — Monitoring & Observability

- [ ] **Error monitoring enabled** — confirm Sentry / log aggregator is receiving events
- [ ] **Uptime monitoring configured** — external ping to `/api/health` every 60 seconds
- [ ] **Database metrics visible** — Supabase dashboard → Reports → API traffic showing requests
- [ ] **Alert channel confirmed** — on-call contact notified that deployment is live

---

## Phase F — Rollback Readiness

- [ ] **Previous deployment checkpoint noted** — Replit Deployments → record the previous deploy ID
- [ ] **Rollback procedure documented** — confirm team knows: Replit Deploy → History → Rollback
- [ ] **Database rollback plan confirmed** — if schema changes were deployed, migration rollback script ready
- [ ] **Rollback drill completed** (recommended for first production release) — deploy to rollback + verify health

---

## Sign-Off

| Role | Name | Date | Signature |
|---|---|---|---|
| Release Lead | | | |
| Security Owner | | | |
| DevOps | | | |
| Product Owner | | | |

**Deployment may not proceed until all Phase A and Phase B items are checked and all sign-offs are obtained.**

---

## Emergency Contacts

| Role | Contact method |
|---|---|
| API outage | Incident channel + on-call rotation |
| DB inaccessible | Supabase status page + account owner |
| Payment processing failure | Paylabs merchant dashboard + support email |
| WA delivery failure | Fonnte/WATI dashboard + account owner |
