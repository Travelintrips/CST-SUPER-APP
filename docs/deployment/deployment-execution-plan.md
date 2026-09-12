# Deployment Execution Plan

**Version:** 1.0  
**Last Updated:** 2026-07-24  
**Scope:** CST Super App — full production deployment  
**Gate required:** `pnpm run audit:customer-production` → GO before any deployment step begins  
**Verdict:** ⛔ NO-GO — deployment cannot proceed until all blockers are resolved

> **READ-ONLY TOOLING:** All validation commands listed here are read-only.  
> No command in this plan modifies application code, business logic, or database schema.

---

## Overview — Deployment Sequence

```
Phase A — Pre-Deployment Validation
  A1. Secret rotation complete
  A2. Staging provisioned and healthy
  A3. HTTP E2E PASS on staging
  A4. Production gate GO

Phase B — Production Infrastructure
  B1. Production secrets verified in deployment store
  B2. Production database migration applied
  B3. Storage bucket policies verified
  B4. External integrations verified

Phase C — Deployment Execution
  C1. Pre-deploy safety checks
  C2. Production deployment initiated
  C3. Post-deploy immediate health check

Phase D — Post-Deployment Verification
  D1. T+15 minutes — login and service verification
  D2. T+30 minutes — full portal verification
  D3. T+1 hour — financial and security verification

Phase E — Monitoring Handover
  E1. Alert routing confirmed
  E2. On-call handover
  E3. KPI baseline recording
```

---

## Phase A — Pre-Deployment Validation

### A1. Secret Rotation

| Field | Detail |
|---|---|
| **Prerequisite** | Owner has access to all provider dashboards (Supabase, Fonnte, WATI, Paylabs, Google, GitHub) |
| **Command** | `pnpm run audit:secret-rotation-status` |
| **Expected Output** | All 19 credentials: ☑ all 7 steps complete; `verifiedByOwner: true` |
| **Failure Condition** | Any credential shows incomplete steps or `verifiedByOwner=false` |
| **Rollback Point** | N/A — this is pre-deployment; rotation must complete before proceeding |
| **Owner** | Account Owner |
| **Reference** | `docs/security/secret-rotation-runbook.md` |

**Steps:**
1. Follow `docs/security/secret-rotation-runbook.md` for each of the 19 credentials
2. After each credential is rotated: update `docs/security/secret-rotation-status.json`
3. After all rotations complete: set `verifiedByOwner: true`, `verifiedAt: <ISO timestamp>`
4. Verify: `pnpm run audit:secret-rotation` → exit 0
5. Verify: `pnpm run audit:secrets` → MISSING: 0, INVALID: 0

---

### A2. Staging Provisioned and Healthy

| Field | Detail |
|---|---|
| **Prerequisite** | Supabase account access; ability to create a new project |
| **Command** | `psql "$TEST_DATABASE_URL" -c "SELECT current_database()"` |
| **Expected Output** | Returns staging project name (not `postgres` of prod project) |
| **Failure Condition** | Connection fails, or returns production project name |
| **Rollback Point** | N/A — staging is separate from production |
| **Owner** | DevOps |
| **Reference** | `docs/deployment/staging-environment.md` |

**Steps:**
1. Create new Supabase project (dedicated, not shared with dev or prod)
2. Inject `TEST_DATABASE_URL` into Replit Secrets (development store)
3. Apply migrations: `pnpm run db:migrate:test` → exit 0
4. Verify connectivity: `node scripts/verify-db-target.mjs --env test`
5. Confirm staging DB name ≠ production DB name

---

### A3. HTTP E2E on Staging

| Field | Detail |
|---|---|
| **Prerequisite** | A2 complete; API server running with `TEST_DATABASE_URL` |
| **Command** | `pnpm run audit:customer-http-e2e` |
| **Expected Output** | Exit 0; all 16 business scenarios PASS; 1 cleanup validation PASS |
| **Failure Condition** | Any scenario FAIL or BLOCKED |
| **Rollback Point** | N/A — staging only; no production touched |
| **Owner** | QA Engineer + Backend Engineer |
| **Reference** | `scripts/customer-full-http-e2e.mjs` |

**Steps:**
1. Start API server with staging DB: `TEST_DATABASE_URL=$TEST_DATABASE_URL pnpm run dev` (or point existing server)
2. Run: `pnpm run audit:customer-http-e2e`
3. Review JSON output — all scenarios must show `status: PASS`
4. If any FAIL: Backend Engineer investigates; fix required before proceeding
5. Re-run until exit 0

---

### A4. Production Gate GO

| Field | Detail |
|---|---|
| **Prerequisite** | A1, A2, A3 all complete |
| **Command** | `pnpm run audit:customer-production` |
| **Expected Output** | `GO` verdict; `summary.json` → `"production": "GO"` |
| **Failure Condition** | NO-GO verdict; any blocker reason in output |
| **Rollback Point** | N/A — do not proceed to Phase B if NO-GO |
| **Owner** | Technical Lead (runs); Owner (authorizes) |

**Steps:**
1. Run: `pnpm run audit:customer-production`
2. Confirm output ends with `GO`
3. Run: `pnpm run validate:production-go` → all gates PASS
4. Record gate result in `docs/release/release-history.md`
5. Owner provides written GO authorization

---

## Phase B — Production Infrastructure

### B1. Production Secrets in Deployment Store

| Field | Detail |
|---|---|
| **Prerequisite** | All 19 credentials rotated (A1 complete) |
| **Command** | `PRODUCTION_GATE=true node scripts/validate-secret-rotation.mjs` |
| **Expected Output** | MISSING: 0, INVALID: 0 for all production secrets |
| **Failure Condition** | Any production secret MISSING or INVALID |
| **Rollback Point** | Correct injection; do not deploy until all PRESENT |
| **Owner** | Owner (injects) + Technical Lead (verifies) |

**Steps:**
1. Navigate to Replit → Deploy → Secrets
2. Verify all production secrets are present with correct values:
   - `SUPABASE_DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
   - `SESSION_SECRET`, `PORTAL_JWT_SECRET`, `DRIVER_JWT_SECRET`, `CASHIER_TOKEN_SECRET`
   - `FONNTE_TOKEN`, `WATI_API_TOKEN`, `SMTP_PASS`
   - `PAYLABS_PRIVATE_KEY`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`
3. Run: `PRODUCTION_GATE=true node scripts/validate-secret-rotation.mjs`
4. Confirm: MISSING: 0, INVALID: 0

---

### B2. Production Database Migration

| Field | Detail |
|---|---|
| **Prerequisite** | Production Supabase project accessible; backup taken (Phase D in pre-production checklist) |
| **Command** | `SUPABASE_MIGRATION_URL=<prod-url> pnpm run db:migrate` |
| **Expected Output** | All migrations applied successfully; exit 0 |
| **Failure Condition** | Any migration error |
| **Rollback Point** | Restore from backup taken before this step |
| **Owner** | DevOps + Backend Engineer |

**Steps:**
1. Confirm production backup taken: Supabase → Settings → Backups → timestamp < 24h
2. Check pending migrations: `pnpm run db:sync:check` → review diff
3. Apply: `SUPABASE_MIGRATION_URL=<prod-url> pnpm run db:migrate` (if migrations pending)
4. Verify: no schema drift — `pnpm run db:sync:check` → no diff
5. If migration fails: restore from backup; abort deployment

---

### B3. Storage Bucket Verification (Read-Only Check)

| Field | Detail |
|---|---|
| **Prerequisite** | Supabase production project accessible |
| **Command** | Manual: Supabase → Storage → verify bucket policies |
| **Expected Output** | `attachments` bucket: authenticated upload only; no public write |
| **Failure Condition** | Bucket missing or policy incorrect |
| **Rollback Point** | Fix policy via Supabase dashboard; no app rollback needed |
| **Owner** | DevOps |

**Steps:**
1. Supabase dashboard → Storage → confirm `attachments` bucket exists
2. Confirm bucket policy: authenticated users can upload; no public write
3. Confirm `vehicle-images` bucket exists with correct policy
4. Note: storage policy fix does not require application rollback

---

### B4. External Integrations Verification

| Field | Detail |
|---|---|
| **Prerequisite** | Production secrets injected (B1 complete) |
| **Command** | See steps below — each is read-only probe |
| **Expected Output** | Each integration responds with success |
| **Failure Condition** | Any integration returns 401/403 or connection error |
| **Rollback Point** | Fix credential injection; do not deploy if payment is broken |
| **Owner** | Owner (dashboard access) + Technical Lead (verifies) |

**Steps:**
1. **Fonnte** (read-only validate endpoint):
   ```bash
   curl -s https://api.fonnte.com/validate -H "Authorization: $FONNTE_TOKEN" | jq .status
   # Expected: "true"
   ```
2. **WATI** (read-only contacts probe):
   ```bash
   curl -s "$WATI_BASE_URL/api/v1/getContacts?pageSize=1" \
     -H "Authorization: Bearer $WATI_API_TOKEN" | jq .result
   # Expected: ok or empty list — NOT 401
   ```
3. **Paylabs** (sandbox only — no real transaction):
   - Trigger sandbox callback flow; verify `[paylabs] signature OK` in API log
   - If Paylabs has no verification endpoint: owner-approved alternative procedure
4. **Google OAuth**: complete login flow in staging/preview environment

---

## Phase C — Deployment Execution

### C1. Pre-Deploy Safety Checks

| Field | Detail |
|---|---|
| **Prerequisite** | Phase A and Phase B complete; Owner GO authorization received |
| **Command** | `pnpm run deployment:dry-run` |
| **Expected Output** | PASS (no FAIL or BLOCKED items) |
| **Failure Condition** | Any FAIL or BLOCKED item in output |
| **Rollback Point** | Resolve blocker; do not proceed to C2 |
| **Owner** | Technical Lead |

**Steps:**
1. Clear circuit breaker: `rm -f /tmp/db-startup-cb.json`
2. Run: `pnpm run deployment:dry-run` → must exit 0
3. Confirm production gate still GO: `pnpm run validate:production-go`
4. Confirm Owner GO authorization recorded in writing
5. Notify all roles: deployment beginning

---

### C2. Production Deployment

| Field | Detail |
|---|---|
| **Prerequisite** | C1 complete; Owner authorization confirmed |
| **Command** | Replit → Deploy → Publish (UI action) |
| **Expected Output** | Replit Deploy tab shows "Deployed"; build log shows success |
| **Failure Condition** | Deployment fails; build error; health check timeout |
| **Rollback Point** | Replit → Deploy → Deployments History → Rollback to previous |
| **Owner** | DevOps (executes) |

**Steps:**
1. Replit → Deploy tab → Publish
2. Monitor build log — no errors expected
3. Wait for "Deployed" status
4. If deployment fails during build: check build logs; do not rollback yet (app still running on previous version)
5. If health check times out: initiate rollback per `docs/deployment/rollback-decision-tree.md`

---

### C3. Post-Deploy Immediate Health Check

| Field | Detail |
|---|---|
| **Prerequisite** | C2 complete — deployment confirmed |
| **Command** | `curl -sf https://<production-domain>/api/health \| jq .` |
| **Expected Output** | `{"status":"ok","db":"connected","workers":"running"}` |
| **Failure Condition** | Non-200 response; `db: disconnected`; no response for > 60s |
| **Rollback Point** | 2 consecutive failures → initiate rollback immediately |
| **Owner** | DevOps |
| **Time Limit** | Complete within 5 minutes of deployment confirmation |

**Steps:**
1. `curl -sf https://<production-domain>/api/health | jq .` — expect status: ok
2. Navigate to `https://<production-domain>/` — Customer Portal must load
3. Navigate to `https://<production-domain>/bizportal/` — BizPortal must load
4. Check Gateway workflow logs — no FATAL errors
5. Check API Server workflow logs — no FATAL errors
6. If all pass: notify all roles "Deployment successful, monitoring in progress"
7. If any fail: initiate rollback; notify all roles

---

## Phase D — Post-Deployment Verification

> See `docs/deployment/post-go-live-checklist.md` for the full timeline (T+15 through T+7 Days).  
> See `docs/deployment/deployment-timeline.md` for owner assignments per time window.

### D1. T+15 Minutes (QA Engineer)
- Customer Portal login via Google OAuth
- BizPortal admin login
- Health check × 3
- Worker heartbeat confirmed

### D2. T+30 Minutes (QA Engineer + Backend Engineer)
- Marketplace, BizPortal, Logistic Order portals load
- WhatsApp and SMTP test delivery
- SSE connection established
- Connection pool health confirmed

### D3. T+1 Hour (Finance Owner + Security Officer)
- Payment sandbox signature verified (no real transaction)
- Accounting journal entry balance checked
- Tenant isolation spot check
- Admin access control verified
- Backup post-deployment confirmed

---

## Phase E — Monitoring Handover

### E1. Alert Routing

| Field | Detail |
|---|---|
| **Command** | Manual: confirm uptime monitor dashboard and alert channel |
| **Expected Output** | Uptime monitor active at 60-second interval; alert channel designated |
| **Owner** | DevOps |

### E2. On-Call Handover

| Field | Detail |
|---|---|
| **Command** | Written handover message to on-call engineer |
| **Expected Output** | On-call engineer acknowledges |
| **Owner** | Technical Lead |

### E3. KPI Baseline Recording

| Field | Detail |
|---|---|
| **Command** | Technical Lead notes first actuals in `docs/operations/operational-kpi.md` |
| **Expected Output** | T+24h actuals recorded for all KPIs |
| **Owner** | Technical Lead |

---

## Operational Readiness Audit (Phase 1 of Deployment Execution Preparation)

The following table categorizes all deployment tasks by automation level:

| Task | Category | Automation Possible | Tooling | Notes |
|---|---|---|---|---|
| Run static gate (typecheck + tests + build) | A — Fully Automated | Yes | `pnpm run audit:customer-static` | Exit 0 = PASS |
| Run runtime health check | A — Fully Automated | Yes | `pnpm run audit:customer-runtime` | Exit 0 = PASS |
| Validate secret availability | A — Fully Automated | Yes | `pnpm run audit:secrets` | Exit 0 = all PRESENT |
| Check secret rotation status | A — Fully Automated | Yes | `pnpm run audit:secret-rotation-status` | Reads status.json |
| Validate preflight / dry-run | A — Fully Automated | Yes | `pnpm run deployment:dry-run` | Exit 0 = no blockers |
| Run production GO validator | A — Fully Automated | Yes | `pnpm run validate:production-go` | Table output |
| Run full HTTP E2E (once staging ready) | A — Fully Automated | Yes | `pnpm run audit:customer-http-e2e` | Requires TEST_DATABASE_URL |
| Run full production gate | A — Fully Automated | Yes | `pnpm run audit:customer-production` | Requires staging + rotation |
| Apply migrations to staging | A — Fully Automated | Yes | `pnpm run db:migrate:test` | Requires TEST_DATABASE_URL |
| Verify DB target | A — Fully Automated | Yes | `pnpm run db:verify:dev` / `db:verify:prod` | Read-only probe |
| Secret rotation — internal JWT generation | B — Semi Automated | Partial | `openssl rand -hex 64` | Owner injects into Replit Secrets |
| VAPID key generation | B — Semi Automated | Partial | `npx web-push generate-vapid-keys` | Owner injects into Replit Secrets |
| Update secret-rotation-status.json | B — Semi Automated | Partial | Manual JSON edit after each rotation | Owner marks each field |
| Production deployment initiation | B — Semi Automated | Partial | Replit → Deploy → Publish | Owner authorizes; DevOps executes |
| Post-deploy health check | B — Semi Automated | Partial | `curl /api/health` | Script-assisted; human confirms |
| Secret rotation — Supabase keys | C — Manual Only | No | Supabase dashboard → Settings → API | Requires Supabase account owner |
| Secret rotation — Fonnte token | C — Manual Only | No | app.fonnte.com → API | Requires Fonnte account access |
| Secret rotation — WATI token | C — Manual Only | No | app.wati.io → Settings → API | Requires WATI account access |
| Secret rotation — SMTP credential | C — Manual Only | No | SMTP provider dashboard | Requires SMTP account access |
| Secret rotation — Paylabs keys | C — Manual Only | No | Paylabs merchant dashboard | Requires Paylabs merchant access |
| Secret rotation — GitHub PAT | C — Manual Only | No | github.com → Settings → Developer settings | Requires GitHub account |
| Secret rotation — Google OAuth | C — Manual Only | No | console.cloud.google.com | Requires GCP project access |
| Provision Supabase staging project | C — Manual Only | No | app.supabase.com → New project | Requires Supabase account owner |
| Inject secrets into Replit Deploy Secrets | C — Manual Only | No | Replit → Deploy → Secrets panel | Requires Replit account access |
| Owner GO authorization | C — Manual Only | No | Written sign-off | Cannot be automated |
| Revoking old credentials at provider | C — Manual Only | No | Per-provider dashboard | Cannot be automated |
| Storage bucket policy verification | C — Manual Only | No | Supabase → Storage dashboard | Visual confirmation required |
| Paylabs sandbox callback test | C — Manual Only | No | Sandbox flow trigger | Manual trigger; API log verified |
| Post-deploy smoke test (login flows) | C — Manual Only | No | Browser action | Human verification required |
| Sign-off on final-go-checklist.md | C — Manual Only | No | Written sign-off | Human authority required |

---

## Abort Criteria

Abort deployment (do not proceed to next phase) if:

| Phase | Abort Condition |
|---|---|
| Phase A | Production gate outputs NO-GO |
| Phase A | HTTP E2E FAIL (not BLOCKED — BLOCKED means staging not ready) |
| Phase B | Any production secret MISSING or INVALID |
| Phase B | Migration fails on production |
| Phase C | Preflight dry-run exits non-zero |
| Phase C | Owner GO authorization not received |
| Phase C | Deployment health check fails after 2 consecutive attempts |

---

## Emergency Contacts During Deployment

| Issue | Contact |
|---|---|
| Deployment fails | On-call Backend Engineer → Technical Lead |
| DB unavailable | Supabase status page + account owner |
| Payment callback broken | Paylabs merchant dashboard + Technical Lead |
| WA delivery broken | Fonnte/WATI dashboard + Owner |
| Accounting imbalance | Finance Owner + Technical Lead |
| Rollback decision | Owner must authorize |
