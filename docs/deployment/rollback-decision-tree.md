# Rollback Decision Tree

**Version:** 1.0  
**Last Updated:** 2026-07-24  
**Owner:** Technical Lead (authorize) · DevOps + Backend Engineer (execute)  
**Reference:** `docs/deployment/production-runbook.md` Section 6 for detailed rollback procedures

> **Read this document FIRST when any post-deployment issue is detected.**  
> Follow the tree top-to-bottom. At each decision point, stop and confirm the answer before proceeding.  
> Do not skip steps. Do not assume. Verify each condition explicitly.

---

## Entry Point

```
POST-DEPLOYMENT ISSUE DETECTED
(alert fired / health check failed / user report / log anomaly)
          │
          ▼
┌─────────────────────────────────────┐
│  Step 0 — Identify the symptom      │
│                                     │
│  Capture:                           │
│  - Time of first detection          │
│  - Error message / HTTP status      │
│  - Which endpoint / component       │
│  - Whether issue is persistent      │
│    or intermittent                  │
└─────────────────────────────────────┘
          │
          ▼
     ─────────────
    Is the issue
    CRITICAL?
    (data corruption /
     financial error /
     security breach /
     total service down)
     ─────────────
     │          │
    YES         NO
     │          │
     ▼          ▼
[TREE A]    [TREE B]
Critical    Non-Critical
Rollback    Investigation
```

---

## Tree A — Critical Rollback Path

```
CRITICAL ISSUE CONFIRMED
          │
          ▼
┌─────────────────────────────────────┐
│  A1 — Notify & Authorize            │
│                                     │
│  1. Notify Owner + Technical Lead   │
│  2. Owner authorizes rollback       │
│  3. Record: time, symptom, auth     │
│  4. Start incident timer            │
└─────────────────────────────────────┘
          │
          ▼
     ─────────────────────
    Was a database migration
    run as part of this
    deployment?
     ─────────────────────
          │          │
         YES         NO
          │          │
          ▼          ▼
   [A2 DB Path]  [A3 App-Only Path]
```

### A2 — Database Migration Was Run

```
MIGRATION RAN
          │
          ▼
┌─────────────────────────────────────┐
│  A2a — Assess Data Loss Risk        │
│                                     │
│  - Are there transactions recorded  │
│    after the backup point?          │
│  - What is the data loss window?    │
│  - Owner confirms acceptable loss   │
└─────────────────────────────────────┘
          │
          ▼
     ─────────────────────
    Is data loss
    acceptable?
     ─────────────────────
          │          │
         YES         NO
          │          │
          ▼          ▼
   [A2b — Full    [A2c — Partial
    DB Rollback]   Investigation]
```

#### A2b — Full Database Rollback

```
FULL DB ROLLBACK
          │
          ▼
┌─────────────────────────────────────┐
│  A2b-1 — Stop all writes            │
│  Restart Gateway with READ_ONLY=true│
│  or set maintenance page            │
└─────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────┐
│  A2b-2 — Restore backup             │
│  Supabase → Settings → Backups →    │
│  Download → Create new project →    │
│  Restore to new project             │
└─────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────┐
│  A2b-3 — Verify restore integrity   │
│  psql <restored-url> -c             │
│  "SELECT COUNT(*) FROM companies"   │
└─────────────────────────────────────┘
          │
          ▼
     ─────────────
    Restore
    verified?
     ─────────────
          │          │
         YES         NO
          │          │
          ▼          ▼
   [A2b-4]       Escalate to
   Update secrets  Supabase support
                   Maximum: 60 min
          │
          ▼
┌─────────────────────────────────────┐
│  A2b-4 — Update SUPABASE_DATABASE_URL│
│  in Replit Secrets (deployment store)│
│  to point to restored project       │
└─────────────────────────────────────┘
          │
          ▼
   [A4 — Application Rollback]
```

#### A2c — Partial Investigation (Data Loss Not Acceptable)

```
DATA LOSS NOT ACCEPTABLE
          │
          ▼
┌─────────────────────────────────────┐
│  A2c-1 — Engage Backend Engineer    │
│  Determine: can the migration be    │
│  reversed without data loss?        │
│  (e.g. DROP COLUMN with no data)    │
└─────────────────────────────────────┘
          │
          ▼
     ─────────────────────
    Can migration be
    reversed safely?
     ─────────────────────
          │          │
         YES         NO
          │          │
          ▼          ▼
   Reverse migration    Escalate:
   manually (hotfix)    Data recovery
   → [A4]               specialist required
                        → Owner decision
```

### A3 — App-Only Path (No Migration)

```
NO MIGRATION RAN
          │
          ▼
   [A4 — Application Rollback]
```

---

### A4 — Application Rollback

```
PROCEED TO APP ROLLBACK
          │
          ▼
┌─────────────────────────────────────┐
│  A4-1 — Replit Application Rollback │
│  1. Open Replit → Deploy tab        │
│  2. Click Deployments History       │
│  3. Find last known-good deployment │
│  4. Click Rollback to this version  │
│  5. Wait for completion             │
└─────────────────────────────────────┘
          │
          ▼
     ─────────────────────
    Were credentials
    rotated as part of
    this deployment?
     ─────────────────────
          │          │
         YES         NO
          │          │
          ▼          ▼
   [A5 — Secret     [A6 — Verify]
    Rollback]
```

### A5 — Secret Rollback

```
CREDENTIAL ROTATION NEEDS REVERTING
          │
          ▼
┌─────────────────────────────────────┐
│  A5-1 — Retrieve old credentials   │
│  from offline secure backup         │
│  (password manager / encrypted vault│
│  — accessible to Owner only)        │
└─────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────┐
│  A5-2 — Re-inject old values        │
│  Replit Secrets deployment store    │
│  → update affected credentials      │
└─────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────┐
│  A5-3 — Restart Gateway             │
│  WorkflowsRestart: Gateway          │
└─────────────────────────────────────┘
          │
          ▼
   [A6 — Verify Health]
```

### A6 — Verify Health

```
VERIFY ALL SERVICES HEALTHY
          │
          ▼
┌─────────────────────────────────────┐
│  A6-1 — Run health check            │
│  curl https://<domain>/api/health   │
│  Expected: status: ok, db: connected│
└─────────────────────────────────────┘
          │
          ▼
     ─────────────
    Health check
    PASS?
     ─────────────
          │          │
         YES         NO
          │          │
          ▼          ▼
   [A7 — Smoke    Re-check logs →
    Test]         Technical Lead
                  escalates within
                  15 min
          │
          ▼
┌─────────────────────────────────────┐
│  A6-2 — Run audit                   │
│  pnpm run audit:customer-runtime    │
│  Expected: exit 0                   │
└─────────────────────────────────────┘
```

### A7 — Post-Rollback Smoke Test

```
SMOKE TEST AFTER ROLLBACK
          │
          ▼
┌─────────────────────────────────────┐
│  A7-1 — Test core flows             │
│  - Homepage loads                   │
│  - BizPortal login                  │
│  - Customer Portal login            │
│  - /api/health → status: ok         │
│  - Database read succeeds           │
└─────────────────────────────────────┘
          │
          ▼
     ─────────────
    All smoke
    tests PASS?
     ─────────────
          │          │
         YES         NO
          │          │
          ▼          ▼
   [A8 — Incident  Technical Lead:
    Review]        investigate & fix
                   or escalate
```

### A8 — Post-Rollback Incident Review

```
INCIDENT REVIEW (required within 24 hours)
          │
          ▼
┌─────────────────────────────────────┐
│  A8-1 — Document                    │
│  File: docs/security/incident-log.md│
│                                     │
│  Include:                           │
│  - Detection time                   │
│  - Symptom and root cause           │
│  - Rollback path taken              │
│  - Data loss window (if any)        │
│  - Prevention plan                  │
│  - Risk matrix update               │
└─────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────┐
│  A8-2 — Hotfix or re-deploy         │
│  Fix root cause → re-run gate →     │
│  pnpm run audit:customer-production │
│  Must output GO before next deploy  │
└─────────────────────────────────────┘
```

---

## Tree B — Non-Critical Investigation Path

```
NON-CRITICAL ISSUE
          │
          ▼
┌─────────────────────────────────────┐
│  B1 — Check logs first              │
│  - Gateway logs                     │
│  - API Server logs                  │
│  - Browser console logs             │
│  - Supabase dashboard logs          │
└─────────────────────────────────────┘
          │
          ▼
     ─────────────────────
    Root cause
    identified?
     ─────────────────────
          │          │
         YES         NO
          │          │
          ▼          ▼
   [B2 — Hotfix]  Escalate to
                  Technical Lead
                  within 30 min
          │
          ▼
┌─────────────────────────────────────┐
│  B2 — Hotfix                        │
│  1. Fix in code                     │
│  2. pnpm run audit:customer-production│
│     → must exit 0 (GO)             │
│  3. Re-deploy via Replit            │
│  4. Verify health check             │
│  5. Monitor 30 min post-deploy      │
└─────────────────────────────────────┘
          │
          ▼
     ─────────────────────
    Does the issue affect
    data integrity or
    security?
     ─────────────────────
          │          │
         YES         NO
          │          │
          ▼          ▼
   → Escalate to   Continue monitoring
   [Tree A]         Log in incident-log.md
```

---

## Quick Reference

| Symptom | Tree | Max Response Time |
|---|---|---|
| Total service down (all endpoints 5xx) | A — Critical | 15 min |
| Financial / accounting error | A — Critical | 15 min |
| Tenant data leakage | A — Critical | Immediate |
| Payment data corruption | A — Critical | 15 min |
| DB connection refused | A — Critical | 15 min |
| Login broken (all users) | A — Critical | 30 min |
| Single endpoint 5xx | B — Non-Critical | 30 min |
| Specific feature broken | B — Non-Critical | 60 min |
| SSE intermittent | B — Non-Critical | 60 min |
| WhatsApp notification failed | B — Non-Critical | 2 hours |
| Storage image not loading | B — Non-Critical | 2 hours |

---

## Rollback Time Targets

| Rollback Type | Target | Maximum |
|---|---|---|
| Application rollback (Replit) | < 10 min | 15 min |
| Secret rollback | < 10 min | 10 min |
| Database rollback (backup restore) | < 60 min | 90 min (escalate) |
| Full recovery (all components) | < 90 min | 120 min (P0 escalation) |
