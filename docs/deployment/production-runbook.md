# Production Operations Runbook

**Last Updated:** 2026-07-24  
**Applies to:** CST Super App — all services (API Server, BizPortal, Customer Portal, Logistic Order)
**Platform:** Replit (development + deployment) · Supabase (PostgreSQL + Storage) · Fonnte/WATI (WA) · Paylabs (payment)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Deploy](#2-deploy)
3. [Migration](#3-migration)
4. [Verification & Health Check](#4-verification--health-check)
5. [Smoke Test](#5-smoke-test)
6. [Rollback](#6-rollback)
7. [Incident Response](#7-incident-response)
8. [Health Check Reference](#8-health-check-reference)
9. [Monitoring](#9-monitoring)
10. [Post-Deploy Validation](#10-post-deploy-validation)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Replit (Production)                       │
│                                                             │
│  Gateway :5000 ──proxy──► Customer Portal :23434           │
│                  ──proxy──► BizPortal :18442               │
│                  ──proxy──► Logistic Order :19368           │
│                  ──proxy──► API Server :18444               │
│                                                             │
└───────────────────────────┬─────────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │   Supabase (Production)    │
              │   Project: nzdweipzckfsz…  │
              │   PostgreSQL (pgBouncer)   │
              │   Storage (S3-compatible)  │
              └───────────────────────────┘

External integrations:
  Fonnte / WATI    — WhatsApp business messaging
  Paylabs          — Payment processing
  Google OAuth     — Customer & admin authentication
  Google Sheets    — Operational data sync
  OpenAI           — AI-assisted features
  SMTP             — Transactional email
```

**Services:**
| Service | Artifact | Port | Command |
|---|---|---|---|
| API Server | `artifacts/api-server` | 18444 | `pnpm --filter @workspace/api-server run dev` |
| BizPortal | `artifacts/bizportal` | 18442 | `pnpm --filter @workspace/bizportal run dev` |
| Customer Portal | `artifacts/customer-portal` | 23434 | `pnpm --filter @workspace/customer-portal run dev` |
| Logistic Order | `artifacts/logistic-order` | 19368 | `pnpm --filter @workspace/logistic-order run dev` |
| Gateway | root | 5000 | `bash start-dev-all.sh` |

---

## 2. Deploy

### 2.1 Pre-deploy gate

**Must complete before deploying:**

```bash
# Run the full production gate
pnpm run audit:customer-production

# Expected final line: "[production] GO"
# summary.json must show: "production": "GO"
```

If the gate does not output `GO`, the deployment must not proceed.
See `docs/release/release-readiness.md` for blocker resolution.

### 2.2 Deploy via Replit

1. Open the Replit workspace.
2. Navigate to **Deploy** tab (or click the Deploy button).
3. Confirm the **production secrets** are set in the Deploy → Secrets panel (distinct from workspace secrets).
4. Click **Publish / Deploy**.
5. Monitor the deployment log until completion.

### 2.3 Deploy via CLI (alternative)

```bash
# Build all packages first
pnpm run build

# Confirm no build errors
echo "Build exit: $?"

# Deploy (Replit CLI or CI integration)
replit deployments deploy --project <project-id>
```

### 2.4 Zero-downtime considerations

- Replit deployments perform a blue/green swap — the old version serves traffic until the new version is healthy.
- Boot migrations run automatically on startup (`runCriticalPreStartMigrations`); they are idempotent.
- If the new version fails health checks, Replit reverts to the previous deployment automatically.

---

## 3. Migration

### 3.1 Automatic (boot migration)

The API server runs `runCriticalPreStartMigrations()` on every startup.
This covers critical schema changes needed before the server accepts traffic.

Boot migrations are:
- Idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)
- Fail-safe: if a boot migration fails, the server does not start

### 3.2 Manual (production migration)

For larger schema changes that cannot run at boot time:

```bash
# Run against production using the direct connection (not pooler)
SUPABASE_MIGRATION_URL=<prod-direct-url> node scripts/prod-migrate.cjs
```

> **Warning:** Always back up the production database before running manual migrations.
> Supabase → Settings → Backups → Download backup.

### 3.3 Migration verification

```bash
# Confirm new tables/columns exist
psql "$SUPABASE_MIGRATION_URL" -c "\dt public.*" | grep <expected_table>

# Confirm no schema drift between dev and prod
pnpm run db:sync:check
```

### 3.4 Migration rollback

There is no automatic down-migration. To rollback:

1. Restore from Supabase backup (see Section 6.3).
2. Or: write and apply a manual `ALTER TABLE DROP COLUMN` / `DROP TABLE` script.

---

## 4. Verification & Health Check

### 4.1 Immediate post-deploy checks

Run these within 5 minutes of deployment:

```bash
PROD_URL=https://<your-production-domain>

# API health
curl -sf "$PROD_URL/api/health" | jq .
# Expected: {"status":"ok","db":"connected","workers":"running"}

# E2E safety guard — must NOT be in test mode on production
curl -sf "$PROD_URL/api/e2e-safety" | jq .
# Expected: {"mode":"production","e2eTestMode":false}

# Customer Portal
curl -sf -o /dev/null -w "%{http_code}" "$PROD_URL/"
# Expected: 200

# BizPortal
curl -sf -o /dev/null -w "%{http_code}" "$PROD_URL/bizportal/"
# Expected: 200
```

### 4.2 Database health

```bash
# From Supabase dashboard: Reports → API → check recent request rate
# Or direct check:
psql "$SUPABASE_DATABASE_URL" -c "SELECT pg_is_in_recovery(), now()"
# Expected: f (not in recovery), current timestamp
```

### 4.3 Worker health

```bash
curl -sf "$PROD_URL/api/health" | jq '.workers'
# Expected: "running" or a list of active worker names
```

---

## 5. Smoke Test

**Run `scripts/smoke-test-prod.sh` after every production deployment** to confirm all routes are
serving requests before declaring the deploy successful.

```bash
# Run the automated smoke test (exits non-zero if any route fails)
bash scripts/smoke-test-prod.sh https://<your-production-domain>

# Or using the npm script alias:
PROD_URL=https://<your-production-domain> pnpm run smoke:prod
```

The script checks these routes in sequence:

| Route | Service | Expected |
|---|---|---|
| `/system/health` | Gateway liveness | 200 JSON `{status:"up"}` |
| `/api/ping` | API Server liveness | 200 JSON `{ok:true}` |
| `/bizportal/` | BizPortal frontend | 200 HTML |
| `/logistic-order/` | Logistic Order frontend | 200 HTML |
| `/` | Customer Portal | 200 HTML |

**If the script exits 1** — do NOT declare the deployment successful. Check service logs and
consider rolling back (Replit → Deploy → Deployments History → Rollback).

You may also run extended manual checks after the automated script passes:

```bash
PROD_URL=https://<your-production-domain>

# Trucking page loads
curl -sf -o /dev/null -w "HTTP %{http_code}\n" "$PROD_URL/trucking"

# Vehicle list (public endpoint)
curl -sf "$PROD_URL/api/settings/vehicle-images" | jq 'keys | length'
# Expected: positive integer

# Public marketplace (no 500 error)
curl -sf "$PROD_URL/api/marketplace/products?limit=1" | jq '.data | length'
```

All responses must be HTTP 200-399 or the expected JSON structure. Any 500 or connection refused = rollback.

---

## 6. Rollback

### 6.0 Rollback Standard — Required Fields

Every rollback decision must be documented with:

| Field | Description |
|---|---|
| **Trigger** | What condition initiated the rollback (symptom, alert, error message) |
| **Owner** | Who authorized the rollback decision |
| **Maximum Downtime** | Acceptable downtime before escalating to a higher-severity action |
| **Application Rollback** | Steps to revert the deployed application version |
| **Database Rollback** | Steps to revert schema or data (if applicable) |
| **Secret Rollback** | Steps to revert credentials to the last known-good values |
| **Storage Rollback** | Steps to revert storage changes (if applicable) |
| **Verification** | How to confirm the rollback was successful |
| **Post Incident Review** | Required within 24 hours — document in `docs/security/incident-log.md` |

---

### 6.1 Application Rollback (Replit)

- **Trigger:** HTTP 5xx on all endpoints; health check fails; deployment log shows fatal error
- **Owner:** Release Lead or on-call engineer
- **Maximum Downtime:** 15 minutes before escalating to P0
- **Steps:**
  1. Open Replit workspace → **Deploy** tab.
  2. Click **Deployments History**.
  3. Find the last known-good deployment.
  4. Click **Rollback to this version**.
  5. Confirm rollback completes (Replit deploys the previous version).
- **Verification:** Run health checks (Section 4) against the rolled-back version. All endpoints must return expected responses.
- **Post Incident Review:** Document trigger, timeline, and root cause within 24 hours.

### 6.2 Application Rollback (git + redeploy)

- **Trigger:** Specific commit introduced a regression; application rollback alone is insufficient
- **Owner:** Engineering Lead
- **Maximum Downtime:** 30 minutes
- **Steps:**
  ```bash
  # Find last known-good commit
  git log --oneline -10

  # Create a revert commit (do not force-push main)
  git revert <bad-commit-sha>
  git push origin main

  # Run gate before re-deploying
  pnpm run audit:customer-production  # must pass GO
  # Then deploy via Replit
  ```
- **Verification:** Production gate must output GO before redeployment. Health checks pass post-deploy.
- **Post Incident Review:** Document the bad commit and regression details.

### 6.3 Database Rollback

> **⚠ WARNING:** Database rollback causes data loss for any transactions after the backup point.
> Use only if schema change caused data corruption or unrecoverable service failure.
> Coordinate with operations and account owner before proceeding.

- **Trigger:** Schema migration caused data corruption; service cannot start due to DB schema error
- **Owner:** Account Owner + Engineering Lead (both must authorize)
- **Maximum Downtime:** 60 minutes for data assessment; rollback execution per Supabase restore time
- **Database Rollback Steps:**
  1. Supabase dashboard → **Settings → Backups**.
  2. Download the backup from before the migration.
  3. Create a new Supabase project (do not overwrite the existing one immediately).
  4. Restore the backup into the new project.
  5. Verify data integrity: `psql <new-project-url> -c "SELECT COUNT(*) FROM companies"`.
  6. Update `SUPABASE_DATABASE_URL` in Replit Secrets (both workspace and deployment) to point to the restored project.
  7. Restart all services.
- **Secret Rollback:** If credentials were rotated as part of the failed deployment, re-inject the previous credential values from the secure offline secret backup.
- **Storage Rollback:** If storage bucket policies were changed, revert via Supabase Storage → Policies.
- **Verification:** Health check returns `db: connected`; core business flows smoke-tested (Section 5).
- **Post Incident Review:** Document data loss window, affected records count, and prevention plan.

### 6.4 Secret Rollback

- **Trigger:** Credential rotation caused authentication failures; new credentials rejected by provider
- **Owner:** Account Owner
- **Maximum Downtime:** 10 minutes per credential class
- **Steps:**
  1. Retrieve previous credential from the offline secure backup (password manager / encrypted vault).
  2. Re-inject previous value into Replit Secrets (workspace and/or deployment store as appropriate).
  3. Restart the API server (Gateway stop → start).
  4. Verify: `pnpm run audit:customer-runtime` → exit 0.
- **Verification:** `pnpm run audit:secrets` → MISSING: 0, INVALID: 0.
- **Post Incident Review:** Document which credential failed and update rotation procedure.

### 6.5 Rollback Decision Matrix

| Symptom | Rollback Type | Section |
|---|---|---|
| HTTP 5xx on all API endpoints | Application rollback | 6.1 |
| HTTP 5xx on specific endpoint | Investigate first; hotfix or rollback | 6.1 / 6.2 |
| DB connection refused | Check Supabase status; rotate DB credentials | 6.4 |
| Schema migration caused app failure | Database rollback | 6.3 |
| Credential rotation caused auth failure | Secret rollback | 6.4 |
| WA/email delivery broken | Check Fonnte/WATI/SMTP status; no app rollback needed | — |
| Payment processing broken | Check Paylabs status; rollback only if data corrupted | 6.3 |
| Login broken (Google OAuth) | Check GCP status; verify redirect URI; no rollback needed | — |
| Intermittent 503 | Check DB pool exhaustion; scale or restart | — |
| Storage access broken | Check Supabase Storage status; revert bucket policies | 6.3 |

---

## 7. Incident Response

### 7.1 Severity levels

| Level | Definition | Response time |
|---|---|---|
| P0 — Critical | Total service unavailability; data loss risk | Immediate (<15 min) |
| P1 — High | Core flow broken (login, order creation, payment) | <1 hour |
| P2 — Medium | Secondary feature degraded | <4 hours |
| P3 — Low | UI glitch; non-critical feature | Next business day |

### 7.2 P0 / P1 Response steps

1. **Acknowledge** — Notify team in incident channel immediately.
2. **Assess** — Run health checks (Section 4) to identify the failure scope.
3. **Contain** — If data integrity at risk, put the API server in maintenance mode:
   ```bash
   # In Replit: stop the API Server workflow
   # This returns 503 to all clients — preferable to silent data corruption
   ```
4. **Diagnose** — Check logs:
   - Replit: Deploy → Logs → filter by ERROR
   - Supabase: Dashboard → Logs → API / Database
5. **Remediate** — Apply fix (hotfix deploy or rollback per Section 6).
6. **Restore** — Re-run health checks and smoke test (Sections 4 and 5).
7. **Post-mortem** — Document in `docs/security/incident-log.md` within 24 hours.

### 7.3 Communication

- **Internal:** post status updates to team channel every 30 minutes during active incident.
- **External:** if customer-facing outage > 30 minutes, update status page.

---

## 8. Health Check Reference

| Endpoint | Method | Expected response | Auth required |
|---|---|---|---|
| `/api/health` | GET | `{"status":"ok","db":"connected","workers":"running"}` | No |
| `/api/e2e-safety` | GET | `{"mode":"production","e2eTestMode":false}` | No |
| `/api/settings/vehicle-images` | GET | JSON object with vehicle IDs as keys | No |
| `/api/marketplace/products` | GET | `{"data":[...],"total":N}` | No |
| `/api/health/db` | GET | `{"status":"ok"}` (if implemented) | No |

---

## 9. Monitoring

### 9.1 Uptime monitoring

Configure an external uptime monitor (e.g., Better Uptime, UptimeRobot, or Pingdom):

| Check | URL | Interval | Alert if |
|---|---|---|---|
| API health | `https://<domain>/api/health` | 60s | HTTP != 200 or status != ok |
| Customer Portal | `https://<domain>/` | 5min | HTTP != 200 |
| BizPortal | `https://<domain>/bizportal/` | 5min | HTTP != 200 |

### 9.2 Database monitoring

In Supabase dashboard → **Reports**:
- **API requests:** track error rate — alert if > 1% of requests are 5xx.
- **Database:** track connection count — alert if approaching pool limit (pool max = 8 in production).
- **Storage:** track usage — alert if approaching project limit.

### 9.3 Application logs

In Replit Deploy → Logs:
- Filter by `ERROR` or `FATAL` to surface application exceptions.
- Filter by `[circuit-breaker]` to detect DB connectivity issues.
- Filter by `[pgBouncer]` to detect connection pool exhaustion.

### 9.4 Key metrics to watch post-deploy

| Metric | Healthy range | Alert threshold |
|---|---|---|
| API p95 response time | < 500ms | > 2000ms |
| DB connection pool usage | < 6 / 8 | = 8 (exhausted) |
| Error rate (5xx) | < 0.1% | > 1% |
| WA delivery success rate | > 98% | < 90% |
| Payment callback processing | < 5s | > 30s |

---

## 10. Post-Deploy Validation

Complete within 1 hour of deployment:

### 10.1 Business flows

- [ ] **Customer can register or log in** (Google OAuth or email/password)
- [ ] **Customer can browse trucking services and submit a booking request**
- [ ] **Booking appears in BizPortal admin inbox**
- [ ] **Admin can approve a booking and assign a vendor**
- [ ] **Vendor receives WhatsApp notification** (or notification appears in vendor portal)
- [ ] **GPS tracking stream is live** — SSE events received for an active booking
- [ ] **Invoice can be generated** from BizPortal
- [ ] **Payment sandbox webhook processed** — accounting journal entry created

### 10.2 Accounting integrity

- [ ] **Journal entries are immutable** — attempt to edit a posted entry via API → 403 rejected
- [ ] **Period lock is active** — attempt to post to a locked period → 422 rejected
- [ ] **Trial balance balances** — debit total equals credit total for the current period

### 10.3 Security

- [ ] **Unauthenticated requests to protected endpoints return 401** — `curl /api/orders` without token → 401
- [ ] **Cross-tenant data isolation** — company A's data is not visible to company B's session
- [ ] **Admin endpoints require admin role** — vendor session cannot access `/api/admin/*`

### 10.4 Final gate re-run (optional but recommended)

```bash
# If staging is still available, run one final gate check post-deploy
TEST_DATABASE_URL=<staging-url> pnpm run audit:customer-production
# Expected: GO
```

---

## Appendix: Useful Commands

```bash
# Check all running workflows
pnpm run audit:customer-runtime

# Validate all secrets present
pnpm run audit:secrets

# Check secret rotation status
pnpm run audit:secret-rotation

# Full production gate
pnpm run audit:customer-production

# Read current release summary
cat summary.json | jq .

# Check DB schema drift
pnpm run db:sync:check

# Start all services locally (for debugging)
bash start-dev-all.sh
```
