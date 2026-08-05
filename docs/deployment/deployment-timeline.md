# Deployment Timeline

**Version:** 1.0  
**Last Updated:** 2026-07-24  
**Owner:** Technical Lead (accountable for timeline) · DevOps (executes infrastructure steps)

> This timeline governs every production deployment of CST Super App.  
> Each stage must be completed before the next begins.  
> Times are relative to the agreed deployment window (T=0 = deployment initiated).  
> All commands are run on the Replit workspace unless otherwise noted.

---

## T-7 Days — Pre-Deployment Preparation

**Owner:** Technical Lead + Owner

| # | Task | Verification | Rollback Trigger |
|---|---|---|---|
| 1 | Confirm deployment date and window with Owner | Owner confirms in writing | If Owner unavailable → reschedule |
| 2 | Review all open incidents in `docs/security/incident-log.md` | No open P0/P1 incidents | Any unresolved P0/P1 → postpone deployment |
| 3 | Review release risk matrix with Technical Lead | `docs/release/release-risk-matrix.md` — all HIGH risks mitigated | Any unmitigated HIGH risk → postpone |
| 4 | Notify all roles of deployment schedule | All roles confirm receipt | — |
| 5 | Confirm on-call engineer availability for T+0 to T+2h window | Written confirmation from on-call | If no on-call available → postpone |
| 6 | Begin secret rotation process (Owner action) | `pnpm run audit:secret-rotation-status` — start tracking | If rotation cannot begin → postpone |
| 7 | Check Supabase platform status | `status.supabase.com` — Operational | Supabase degraded → monitor, do not deploy |

---

## T-3 Days — Readiness Gate

**Owner:** Technical Lead + DevOps + Security Officer

| # | Task | Verification | Rollback Trigger |
|---|---|---|---|
| 1 | Run static gate | `pnpm run audit:customer-static` → exit 0 | Any test failure → fix or postpone |
| 2 | Run runtime gate | `pnpm run audit:customer-runtime` → exit 0 | Any runtime failure → investigate |
| 3 | Confirm secret rotation progress | `pnpm run audit:secret-rotation-status` | If rotation at < 50% → escalate to Owner |
| 4 | Provision Supabase staging project (if not done) | `psql $TEST_DATABASE_URL -c "SELECT 1"` succeeds | If staging unavailable → notify Technical Lead; deployment at risk |
| 5 | Apply all migrations to staging | `pnpm run db:migrate:test` → exit 0 | Migration failure on staging → fix before proceeding |
| 6 | Take pre-deployment backup of production DB | Supabase → Settings → Backups → timestamp confirmed | If backup fails → postpone deployment |
| 7 | Run preflight validator | `pnpm run deployment:dry-run` → PASS or PASS WITH WARNINGS | Any FAIL → resolve before T-1 Day |

---

## T-1 Day — Final Verification

**Owner:** Technical Lead + QA Engineer + Security Officer

| # | Task | Verification | Rollback Trigger |
|---|---|---|---|
| 1 | Confirm secret rotation complete | `pnpm run audit:secret-rotation` → exit 0 | Incomplete rotation → postpone deployment |
| 2 | Inject production secrets into Replit Deploy → Secrets panel | `pnpm run audit:secrets` → MISSING: 0, INVALID: 0 | Any MISSING or INVALID → resolve before deploying |
| 3 | Run full HTTP E2E on staging | `pnpm run audit:customer-http-e2e` → exit 0; all 16 scenarios PASS | Any E2E failure → investigate; may require code fix and postpone |
| 4 | Run production gate | `pnpm run audit:customer-production` → GO | NO-GO → resolve blockers or postpone |
| 5 | Run production GO validator | `pnpm run validate:production-go` → all gates PASS | Any gate FAIL → resolve before T=0 |
| 6 | Confirm monitoring is configured | Uptime monitor active; alert channel confirmed | Monitoring not ready → configure before deploying |
| 7 | Verify storage bucket policies on production | Supabase → Storage → bucket policies correct | Incorrect policy → fix before deploying |
| 8 | Test OAuth redirect URI for production domain | Attempt Google login in staging using prod-equivalent config | OAuth fails → update GCP Console before deploying |
| 9 | Security Officer sign-off | `docs/release/final-go-checklist.md` Section 3 — Security Owner signed | No sign-off → postpone |
| 10 | Technical Lead sign-off | `docs/release/final-go-checklist.md` Section 3 — Technical Lead signed | No sign-off → postpone |

---

## T=0 — Deployment Day (Deployment Window)

**Owner:** DevOps (executes) · Technical Lead (authorizes) · Owner (GO decision)

### Pre-Deploy — Final Check (before clicking Deploy)

| # | Task | Command | Expected Output | Rollback Trigger |
|---|---|---|---|---|
| 1 | Clear DB startup circuit breaker file | `rm -f /tmp/db-startup-cb.json` | File removed (or not found) | — |
| 2 | Final preflight check | `pnpm run deployment:dry-run` | PASS | Any FAIL → abort deployment |
| 3 | Confirm backup taken within 24h | Supabase → Backups → timestamp | Backup timestamp < 24h | No recent backup → take backup before deploying |
| 4 | Confirm Owner GO authorization | Written authorization from Owner | Owner GO received | No authorization → abort |

### Deploy

| # | Task | Command | Expected Output | Rollback Trigger |
|---|---|---|---|---|
| 5 | Initiate deployment | Replit → Deploy → Publish | "Deploying…" status visible | Deployment fails to start → check Replit status |
| 6 | Monitor deployment progress | Replit Deploy → Logs | Build succeeds; deployment completes | Build error → abort; investigate logs |
| 7 | Confirm deployment status | Replit Deploy tab | Status: "Deployed" | Status error → check logs; initiate rollback if service is down |

### Post-Deploy — Immediate (< 5 minutes)

| # | Task | Command | Expected Output | Rollback Trigger |
|---|---|---|---|---|
| 8 | Health check | `curl -sf https://<prod-domain>/api/health` | `{"status":"ok","db":"connected"}` | Non-200 for 2+ consecutive checks → rollback |
| 9 | Gateway log check | Replit → Gateway workflow logs | No FATAL; no EADDRINUSE; no DB error | Any FATAL → rollback |
| 10 | API Server log check | Replit → API Server workflow logs | No FATAL; no Drizzle error | Any FATAL → rollback |
| 11 | Customer Portal loads | Navigate to `https://<prod-domain>/` | HTTP 200; page renders | HTTP 5xx → rollback |
| 12 | BizPortal loads | Navigate to `https://<prod-domain>/bizportal/` | HTTP 200; page renders | HTTP 5xx → rollback |

> **Rollback authority:** Technical Lead or Owner may call rollback at any time after T=0.  
> Execute per `docs/deployment/rollback-decision-tree.md`.

---

## T+15 Minutes

**Owner:** QA Engineer (executes) · Technical Lead (monitors)

| # | Task | Verification | Rollback Trigger |
|---|---|---|---|
| 1 | Customer Portal login (Google OAuth) | Screenshot of successful login | Auth failure for all users → rollback |
| 2 | BizPortal admin login | Screenshot of successful login + company selector | Admin login broken → investigate |
| 3 | Health check × 3 (30-second intervals) | All 3 return `status: ok` | Any failure → Technical Lead investigates |
| 4 | Worker heartbeat | `/api/health` → `workers: running` | Workers not running → check API Server logs |
| 5 | Error rate check | API Server logs — 5xx rate | < 1% of requests | > 1% sustained → Technical Lead investigates |

---

## T+30 Minutes

**Owner:** QA Engineer + Backend Engineer

| # | Task | Verification | Rollback Trigger |
|---|---|---|---|
| 1 | Marketplace listing loads | Customer Portal → marketplace → products visible | HTTP 500 → investigate |
| 2 | BizPortal company data loads | BizPortal → select company → data visible | HTTP 401/403/500 → investigate |
| 3 | Logistic Order portal loads | `/logistic-order/` → page renders | HTTP 500 → investigate |
| 4 | WhatsApp notification delivery | Trigger test WA → delivered within 2 min | WA fails → check FONNTE_TOKEN; non-blocking |
| 5 | SMTP email delivery | Trigger test email → delivered within 5 min | Email fails → check SMTP_PASS; non-blocking |
| 6 | SSE connection established | Browser Network → EventStream → events received | SSE fails → investigate; non-critical |
| 7 | Connection pool health | API Server logs — 30 min window | No "pool exhausted" entries | Pool exhausted → check DB; rollback if persistent |
| 8 | Notify Owner of T+30 status | Written summary to Owner | Owner acknowledges | — |

---

## T+1 Hour

**Owner:** Finance Owner + Security Officer + Technical Lead

| # | Task | Verification | Rollback Trigger |
|---|---|---|---|
| 1 | Payment sandbox verified | Paylabs sandbox callback → `[paylabs] signature OK` in logs | Signature INVALID → check PAYLABS_PRIVATE_KEY; rollback if payment broken |
| 2 | Accounting journal entry correct | Create test entry → debit = credit; period lock respected | Imbalance → rollback |
| 3 | Tenant isolation spot check | Log in as Company A → Company B data not visible | Leakage detected → immediate rollback |
| 4 | Admin access control | Non-admin account → 401 or 403 | Admin bypass → immediate rollback |
| 5 | Rate limiting active | > rate limit requests → 429 | No rate limiting → investigate |
| 6 | Backup confirmed post-deployment | Supabase → Backups → new backup after deployment time | No backup → take manual backup |
| 7 | Owner summary report | Technical Lead sends T+1h summary | — | — |

---

## T+6 Hours

**Owner:** Technical Lead + Backend Engineer + DevOps

| # | Task | Verification | Rollback Trigger |
|---|---|---|---|
| 1 | Error rate — 6h window | Aggregate API logs — 5xx rate | < 1% | > 2% sustained → investigate |
| 2 | Latency — 6h window | API Server response time | p95 < 500 ms | p95 > 2000 ms → investigate |
| 3 | Notification queue depth | `SELECT COUNT(*) FROM mkt_notification_queue WHERE status='pending'` | < 100; none stuck > 30 min | Queue stuck → check worker logs |
| 4 | DB connection pool — 6h | API Server logs | Active connections < 6 sustained | Pool exhaustion → investigate |
| 5 | Uptime monitor — first report | Uptime monitor dashboard | 100% availability | Any downtime → Technical Lead reviews |

---

## T+24 Hours

**Owner:** Technical Lead + Finance Owner + DevOps

| # | Task | Verification | Rollback Trigger |
|---|---|---|---|
| 1 | 24-hour error rate | API Server logs | 5xx < 1%; 4xx < 5% | — |
| 2 | 24-hour latency | API Server logs | p95 < 500 ms | — |
| 3 | 24-hour uptime | Uptime monitor | ≥ 99.9% | — |
| 4 | Worker health | API logs | All workers completed cycles; no crash-loop | Worker crash-loop → investigate |
| 5 | Financial integrity | Spot check `accounting_entries` | All entries balanced; no unposted from yesterday | Any imbalance → Finance Owner investigates |
| 6 | Incident log reviewed | `docs/security/incident-log.md` | No open incidents | Open incident → escalate to Technical Lead |
| 7 | KPI baseline recorded | `docs/operations/operational-kpi.md` | First 24h actuals noted | — |
| 8 | Update `release-history.md` | `docs/release/release-history.md` | New production row added with status, gate result, summary | — |

---

## T+72 Hours

**Owner:** DevOps + Finance Owner + Security Officer

| # | Task | Verification | Rollback Trigger |
|---|---|---|---|
| 1 | 72-hour uptime | Uptime monitor | ≥ 99.9% | — |
| 2 | 72-hour error rate | API logs | 5xx < 1% | — |
| 3 | Payment reconciliation | Paylabs dashboard vs `accounting_entries` | All payment callbacks recorded; no unrecorded transactions | Any gap → Finance Owner investigates |
| 4 | Monitoring alerts reviewed | Alert channel history | All P0/P1 alerts investigated; none open | — |
| 5 | Notification delivery rate | Fonnte/WATI + SMTP dashboard | WhatsApp > 95%; email > 99% | — |
| 6 | Tenant isolation — extended | API Server logs | No cross-company access attempts | Any leakage → Security Officer incident review |
| 7 | Post-deployment retrospective scheduled | Calendar invite sent to all roles | Meeting scheduled | — |

---

## Deployment Communication Plan

| Time | Message | Audience | Channel |
|---|---|---|---|
| T-7 Days | Deployment schedule confirmed | All roles | Chat + email |
| T-1 Day | Deployment proceeding tomorrow at [time] | All roles | Chat + email |
| T=0 | Deployment initiated | All roles | Chat |
| T+0 (deployed) | Deployment complete — monitoring in progress | All roles | Chat |
| T+1h | T+1h status summary | Owner + Technical Lead | Chat + email |
| T+24h | 24-hour report | Owner + Finance Owner | Email |
| T+72h | 72-hour report | All roles | Email |

---

## Abort and Rollback Triggers

Abort the deployment immediately (before T=0 completes) if:
- `pnpm run deployment:dry-run` exits non-zero
- Owner GO authorization not received
- Supabase platform degraded at time of deploy

Initiate rollback immediately after T=0 if any of the following occur:
- Health endpoint returns non-200 for > 2 consecutive checks
- 5xx rate > 5% sustained for > 5 minutes
- Any cross-tenant data access confirmed
- Any journal entry imbalance in accounting
- Any payment signature validation failure
- DB connection pool fully exhausted with no recovery in 5 minutes
- Owner or Technical Lead calls rollback

**Rollback procedure:** `docs/deployment/rollback-decision-tree.md`
