---
name: dev-prod schema drift
description: DEV DB is 83 tables behind PROD. Key marketplace tables (mkt_rfqs, portal_company_members, etc.) only exist in PROD. mkt_dual_write_log only in DEV with partial schema.
---

# DEV vs PROD Schema Drift

## As of 2026-07-02

### Migration log state (drizzle.__drizzle_migrations)
Both DBs: only 0000–0003 recorded. Migrations 0013–0016 applied via boot/manual, not via drizzle CLI.

### Migration 0013–0016 Status

| Migration | DEV | PROD |
|-----------|-----|------|
| 0013 `users.password_hash` | ✅ Applied | ✅ Applied |
| 0014 `mkt_dual_write_log` | ⚠️ Partial (7 cols missing, status=TEXT not enum) | ❌ MISSING |
| 0015 `mkt_rfqs.portal_customer_id` | ❌ N/A (mkt_rfqs not in DEV) | ✅ Applied |
| 0016 `portal_company_members` | ❌ Missing | ✅ Applied |

### Table gap summary
- PROD has 83 tables not in DEV (mkt_rfqs, mkt_rfq_lines, portal_company_members, etc.)
- DEV has 1 table not in PROD (mkt_dual_write_log — partial schema)

## Action Required

### PROD — run 0014 to create mkt_dual_write_log
```bash
psql "$SUPABASE_DATABASE_URL" -f lib/db/drizzle/0014_mkt_dual_write_log.sql
```
Migration is fully idempotent. See `docs/migration-plan-0013-0016.md`.

### DEV — run 0014 to upgrade partial table
```bash
psql "$SUPABASE_DATABASE_URL_DEV" -f lib/db/drizzle/0014_mkt_dual_write_log.sql
```
Adds 7 missing columns + migrates status TEXT → enum.

### DEV — migrations 0015/0016 blocked
DEV missing mkt_rfqs entirely. Consider fresh DEV Supabase project rather than incremental patching.

## Why
DEV schema diverged because boot migrations create partial tables, while PROD received full SQL via manual apply. Never assume DEV = PROD schema parity.
