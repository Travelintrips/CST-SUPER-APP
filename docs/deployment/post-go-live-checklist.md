# Post Go-Live Checklist

**Version:** 1.0  
**Last Updated:** 2026-07-24  
**Owner:** Technical Lead (accountable) · QA Engineer (executes verification)

> This checklist is executed **after** production deployment is confirmed successful.
> It does NOT replace the pre-deployment gate (`audit:customer-production`).
> Every item must be confirmed by a human — no automated check substitutes for human verification.
> Record the verifier name, time, and evidence for every item.

---

## T+0 — Immediately After Deployment (< 5 minutes)

| # | Check | Who | Evidence | PASS Criteria |
|---|---|---|---|---|
| 1 | **Deployment confirmed in Replit** | DevOps | Replit Deploy tab shows new deployment live | Status: "Deployed" |
| 2 | **Health endpoint responds** | DevOps | `curl https://<production-domain>/api/health` | `status: ok`, `db: connected` — response time < 3 s |
| 3 | **Gateway proxying correctly** | DevOps | `curl https://<production-domain>/` → Customer Portal loads | HTTP 200, page renders |
| 4 | **BizPortal loads** | DevOps | Navigate to `https://<production-domain>/bizportal/` | HTTP 200, page renders |
| 5 | **No fatal errors in Gateway log** | DevOps | Replit workflow logs — Gateway | No FATAL, no EADDRINUSE, no DB connection error |
| 6 | **No fatal errors in API Server log** | Backend Engineer | Replit workflow logs — API Server | No FATAL, no Drizzle error, no pool exhausted |

**Time target:** Complete within 5 minutes of deployment confirmation.  
**Block on:** Items 2 (health) and 5–6 (logs). Any failure → immediate rollback per `docs/deployment/rollback-decision-tree.md`.

---

## T+15 — 15 Minutes Post-Deployment

| # | Check | Who | Evidence | PASS Criteria |
|---|---|---|---|---|
| 7 | **Customer Portal login** (Google OAuth) | QA Engineer | Screenshot of successful login | Logged in, session cookie set, dashboard loads |
| 8 | **BizPortal login** | QA Engineer | Screenshot of successful login | Logged in, company selector works |
| 9 | **API health — second check** | QA Engineer | `curl /api/health` × 3 (30-second intervals) | All 3 return `status: ok` |
| 10 | **Worker heartbeat confirmed** | Backend Engineer | `/api/health` response | `workers: running` — all workers scheduled |
| 11 | **Database read confirmed** | Backend Engineer | `curl /api/health` `db: connected` | No DB timeout, no pool exhaustion in logs |
| 12 | **No increased error rate** | Technical Lead | API Server logs — 15 min window | 5xx rate < 1% of requests |

**Time target:** Complete by T+15.  
**Block on:** Item 7 (login). Any authentication failure → investigate before continuing.

---

## T+30 — 30 Minutes Post-Deployment

| # | Check | Who | Evidence | PASS Criteria |
|---|---|---|---|---|
| 13 | **Marketplace listing loads** | QA Engineer | Navigate to Customer Portal marketplace | Products listed, no 500 error |
| 14 | **BizPortal company data loads** | QA Engineer | Navigate to BizPortal → select company | Company data visible, no 401/403/500 |
| 15 | **Logistic Order portal loads** | QA Engineer | Navigate to `/logistic-order/` | Page renders, no 500 |
| 16 | **WhatsApp notification delivery** | QA Engineer | Trigger a workflow that sends WhatsApp | Message delivered within 2 min; check Fonnte/WATI dashboard |
| 17 | **SMTP email delivery** | QA Engineer | Trigger a workflow that sends email | Email delivered to test address within 5 min |
| 18 | **SSE connection established** | QA Engineer | Open Customer Portal notification stream | SSE connection established (check browser Network → EventStream) |
| 19 | **Connection pool — no exhaustion** | Backend Engineer | API Server log — 30 min window | No "pool exhausted" or "connection timeout" log entry |

**Time target:** Complete by T+30.  
**Escalate if:** Items 13–15 fail → Technical Lead; items 16–17 fail → Owner + investigate credential injection.

---

## T+1 Hour — 1 Hour Post-Deployment

| # | Check | Who | Evidence | PASS Criteria |
|---|---|---|---|---|
| 20 | **Payment sandbox verified** | QA Engineer | Paylabs sandbox callback flow | `[paylabs] signature OK` in API log; journal entry created |
| 21 | **Accounting journal entry correct** | Finance Owner | Create a test journal entry (use staging/test data — no real financial transaction) | Debit = Credit; journal posted; period lock respected |
| 22 | **Tenant isolation spot check** | Security Officer | Log in as Company A → verify Company B data not visible | No cross-company data returned |
| 23 | **Admin access control** | QA Engineer | Attempt admin action with non-admin account | 401 or 403 returned correctly |
| 24 | **Rate limiting active** | QA Engineer | Send > rate limit requests to `/api/auth` endpoint | 429 returned correctly |
| 25 | **Health — sustained green** | Technical Lead | Review 1-hour health log | No sustained 5xx period; no DB connection failures |
| 26 | **Backup confirmed** | DevOps | Supabase → Backups → confirm post-deployment backup exists | Backup timestamp after deployment time |

**Time target:** Complete by T+1 hour.  
**Owner notified:** Yes — send summary of T+0 through T+1 hour status to Owner by T+1 hour.

---

## T+6 Hours — 6 Hours Post-Deployment

| # | Check | Who | Evidence | PASS Criteria |
|---|---|---|---|---|
| 27 | **Error rate — 6 hour window** | Technical Lead | Aggregate API Server logs | 5xx rate < 1% over 6-hour window |
| 28 | **Latency — 6 hour window** | Technical Lead | API Server response time logs | p95 < 500 ms over 6-hour window |
| 29 | **Notification queue depth** | Backend Engineer | `SELECT COUNT(*) FROM mkt_notification_queue WHERE status='pending'` | < 100 items; no item stuck > 30 min |
| 30 | **DB connection pool — 6 hour** | Backend Engineer | API Server log review | No pool exhaustion; active connections < 6 sustained |
| 31 | **Uptime monitor — first report** | DevOps | Uptime monitor dashboard | 100% availability over 6-hour window |

---

## T+24 Hours — 24 Hours Post-Deployment

| # | Check | Who | Evidence | PASS Criteria |
|---|---|---|---|---|
| 32 | **24-hour error rate** | Technical Lead | API Server logs | 5xx < 1%; 4xx < 5% |
| 33 | **24-hour latency** | Technical Lead | API Server logs | p95 < 500 ms |
| 34 | **24-hour uptime** | DevOps | Uptime monitor | ≥ 99.9% (< 86.4 s downtime) |
| 35 | **Worker health — 24 hours** | Backend Engineer | API Server logs | All workers completed scheduled cycles; no crash-loop |
| 36 | **Financial integrity — 24 hours** | Finance Owner | Spot check accounting_entries | All journal entries balanced; no unposted entries from yesterday |
| 37 | **Incident log reviewed** | Technical Lead | `docs/security/incident-log.md` | No open incidents; all alerts triaged |
| 38 | **Storage usage** | DevOps | Supabase Storage dashboard | No unexpected usage spike |
| 39 | **KPI baseline recorded** | Technical Lead | `docs/operations/operational-kpi.md` | First 24-hour actuals recorded against targets |

---

## T+72 Hours — 72 Hours Post-Deployment

| # | Check | Who | Evidence | PASS Criteria |
|---|---|---|---|---|
| 40 | **72-hour uptime** | DevOps | Uptime monitor | ≥ 99.9% |
| 41 | **72-hour error rate** | Technical Lead | Logs | 5xx < 1% |
| 42 | **Payment reconciliation** | Finance Owner | Compare Paylabs dashboard vs accounting_entries | All payment callbacks recorded; no unrecorded transactions |
| 43 | **Monitoring alerts reviewed** | Technical Lead | Alert channel history | All alerts investigated; no open P0/P1 alerts |
| 44 | **Notification delivery rate** | Backend Engineer | Fonnte/WATI + SMTP dashboard | WhatsApp > 95%; email > 99% |
| 45 | **Tenant isolation — extended** | Security Officer | Review API Server logs for cross-company query attempts | No cross-company data access in logs |

---

## T+7 Days — 7 Days Post-Deployment

| # | Check | Who | Evidence | PASS Criteria |
|---|---|---|---|---|
| 46 | **7-day uptime** | DevOps | Uptime monitor | ≥ 99.9% |
| 47 | **7-day KPI review** | Technical Lead | `docs/operations/operational-kpi.md` | All KPIs within target; anomalies documented |
| 48 | **Security review** | Security Officer | API Server logs; auth failure rate | No sustained auth failure spike; no token breach detected |
| 49 | **Financial weekly reconciliation** | Finance Owner | Accounting journals for week | No unbalanced journal; period lock intact |
| 50 | **Post-deployment retrospective** | All roles | Meeting notes | Root causes of all incidents documented; risk matrix updated |
| 51 | **Secret rotation schedule updated** | Owner | `docs/security/secret-rotation-runbook.md` | Next rotation date recorded for each credential based on new baseline |
| 52 | **Monitoring thresholds adjusted** | DevOps | `docs/operations/monitoring-matrix.md` | Thresholds updated based on 7-day observed baseline |
| 53 | **Backup verified** | DevOps | Supabase backup + restore test | 7-day backup available; restore test successful |

---

## Escalation — When to Rollback Post Go-Live

If any of the following occur at any time window, initiate rollback immediately per `docs/deployment/rollback-decision-tree.md`:

- Health endpoint returns non-200 for > 2 consecutive checks
- 5xx rate > 5% sustained for > 5 minutes
- Any cross-tenant data access confirmed
- Any journal entry imbalance in accounting
- Any payment signature validation failure
- DB connection pool fully exhausted (> 8 active connections) with no recovery in 5 minutes
- Owner or Technical Lead determines rollback is necessary
