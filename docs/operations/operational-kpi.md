# Operational KPI

**Version:** 1.0  
**Last Updated:** 2026-07-24  
**Owner:** Technical Lead (reports) · Owner (reviews)  
**Review Cadence:** Weekly (first 4 weeks post-launch); monthly thereafter

> **Instructions:**
> This file defines KPI targets only. Do not enter operational data or actual values here.
> Record actuals in a separate tracking sheet (e.g. `docs/operations/kpi-actuals/YYYY-MM.md`).
> Every KPI has a Target, a Warning threshold, and a Critical threshold.
> Adjust targets after 30 days of production baseline observation.

---

## KPI Summary Table

| # | KPI | Unit | Target | Warning | Critical | Owner | Measurement Source |
|---|---|---|---|---|---|---|---|
| 1 | Deployment Success Rate | % of deploys that go live without rollback | ≥ 95% | < 95% | < 80% | Technical Lead | Release history log |
| 2 | Rollback Rate | % of deploys that result in rollback | ≤ 5% | > 5% | > 20% | Technical Lead | Release history log |
| 3 | Incident Count | # of P0/P1 incidents per month | 0 P0; ≤ 2 P1 | > 0 P0; > 2 P1 | > 1 P0; > 5 P1 | Technical Lead | Incident log |
| 4 | Mean Time To Detect (MTTD) | Minutes from incident start to alert | ≤ 5 min | > 5 min | > 15 min | DevOps | Alert timestamp vs incident log |
| 5 | Mean Time To Recover (MTTR) | Minutes from detection to full recovery | ≤ 30 min | > 30 min | > 90 min | Technical Lead | Incident log |
| 6 | Service Availability | % uptime (monthly) | ≥ 99.9% (≤ 43.8 min downtime/month) | < 99.9% | < 99.5% | DevOps | Uptime monitor |
| 7 | API Error Rate (5xx) | % of all API requests | ≤ 0.5% | > 0.5% | > 2% | Technical Lead | API Server logs |
| 8 | API Latency p95 | Milliseconds | ≤ 500 ms | > 500 ms | > 2000 ms | Technical Lead | API Server logs |
| 9 | HTTP E2E Success Rate | % of E2E scenarios PASS (on staging runs) | 100% | < 100% | Any gate BLOCKED | QA Engineer | E2E harness output |
| 10 | Payment Success Rate | % of initiated payments that complete successfully | ≥ 99% | < 99% | < 95% | Finance Owner | Paylabs dashboard + accounting_entries |
| 11 | Payment Callback Processing Time | Seconds from Paylabs callback to journal entry posted | ≤ 5 s | > 5 s | > 30 s | Backend Engineer | API Server logs |
| 12 | SSE Success Rate | % of SSE connections that successfully receive events | ≥ 99% | < 99% | < 95% | Technical Lead | E2E SSE verification + logs |
| 13 | Tenant Isolation Success Rate | % of E2E tenant isolation tests PASS | 100% | < 100% | Any failure | Security Officer | E2E output |
| 14 | Accounting Accuracy Rate | % of journal entries where debit = credit | 100% | < 100% | Any imbalance | Finance Owner | accounting_entries validation query |
| 15 | Backup Success Rate | % of scheduled backups that complete successfully | 100% | < 100% | Any failure | DevOps | Supabase Backups dashboard |
| 16 | Recovery Success Rate | % of rollback operations that fully restore service | 100% | < 100% | Any failed rollback | Technical Lead | Incident log |
| 17 | WhatsApp Delivery Rate | % of WhatsApp notifications delivered | ≥ 95% | < 95% | < 80% | Owner | Fonnte / WATI dashboard |
| 18 | Email Delivery Rate | % of SMTP emails delivered | ≥ 99% | < 99% | < 95% | Owner | SMTP provider dashboard |
| 19 | Secret Rotation Compliance | % of credentials rotated on schedule | 100% | < 100% | Any overdue | Owner | secret-rotation-runbook status |
| 20 | DB Connection Pool Utilization | % of max pool in use (max=8) | ≤ 75% sustained | > 75% | > 95% | Backend Engineer | API Server logs |

---

## KPI Detail

### KPI 1 — Deployment Success Rate
- **Definition:** `(Deploys without rollback / Total deploys) × 100`
- **Target rationale:** A 95% success rate allows for ≤ 1 rollback per 20 deploys under normal velocity.
- **Data source:** `docs/release/release-history.md` — count rows by Type and Rollback columns.

### KPI 3 — Incident Count
- **Definition:** Count of incidents logged in `docs/security/incident-log.md` per calendar month, by severity.
- **P0:** Data loss, financial error, security breach, total service outage.
- **P1:** Partial service outage, payment failure, authentication failure.

### KPI 4 — Mean Time To Detect (MTTD)
- **Definition:** `(Alert timestamp − Actual incident start timestamp)` in minutes.
- **Measurement:** Requires accurate incident start time from logs; not from when a user reports it.
- **Target rationale:** 5-minute detection requires active uptime monitoring at ≤ 60-second check intervals.

### KPI 5 — Mean Time To Recover (MTTR)
- **Definition:** `(Full service restoration timestamp − Incident detection timestamp)` in minutes.
- **Includes:** Time to authorize rollback, execute rollback, verify health.
- **Excludes:** Time for post-incident review or hotfix development.

### KPI 6 — Service Availability
- **Definition:** `(Total minutes − Downtime minutes) / Total minutes × 100` per calendar month.
- **99.9% target:** ≤ 43.8 minutes total downtime per 30-day month.
- **Data source:** Uptime monitor (external probe, not self-reported).

### KPI 9 — HTTP E2E Success Rate
- **Definition:** Must be 100% — partial E2E PASS is not acceptable for production GO.
- **16 business scenarios + 1 cleanup validation** must all PASS.
- **Measurement:** `pnpm run audit:customer-http-e2e` exit code on dedicated staging.

### KPI 14 — Accounting Accuracy Rate
- **Definition:** Every journal entry must satisfy `SUM(debit_amount) = SUM(credit_amount)` where `company_id` and `journal_date` match.
- **Measurement query:** `SELECT COUNT(*) FROM accounting_entries WHERE status = 'posted' AND NOT balanced_flag`
- **Any non-zero result is Critical.**

---

## KPI Review Process

1. **Weekly (first 4 weeks):** Technical Lead reviews all KPIs; anomalies escalated to Owner within 24 hours.
2. **Monthly:** Technical Lead prepares written KPI summary; Finance Owner reviews KPIs 10, 14; Security Officer reviews KPIs 13, 19; DevOps reviews KPIs 6, 15.
3. **After every incident:** MTTD, MTTR, Incident Count updated; root cause documented.
4. **After 30 days baseline:** Targets reviewed and adjusted if real-world data shows systematic deviation.

---

## KPI Non-Negotiables

The following KPIs may never be waived, negotiated, or reported as "acceptable below target":

| KPI | Why Non-Negotiable |
|---|---|
| HTTP E2E Success Rate (100%) | A BLOCKED gate means production GO cannot be declared |
| Accounting Accuracy Rate (100%) | Any journal imbalance is a financial integrity failure |
| Tenant Isolation Success Rate (100%) | Any leakage is a data breach |
| Backup Success Rate (100%) | A failed backup means rollback is impossible |
| Secret Rotation Compliance (100%) | An unrotated credential is a live security vulnerability |
