# CF-SC-13 — Post-Migration PROD Parity Certification

**Date:** 2026-08-22  
**Scope:** production read-only parity audit after CF-SC-12C-3  
**Required mode:** `SPORT_CENTER_FINANCE_MODE=legacy`

## Final verdict

```text
CF-SC-13 = BLOCKED
READY FOR SHADOW ASSESSMENT = NO
```

### Latest recheck

On the latest read-only retry, both DEV and PROD stopped in the official
Secret Manager loader before database access:

```text
bundle mode = legacy
secret resource = sport-center
result = PERMISSION_DENIED
permission = secretmanager.versions.access
```

This replaces the previous PROD `28P01` observation as the current blocker.
No database connection or business-finance operation was reached in this
retry. The required repair is to grant the bootstrap service account
`Secret Manager Secret Accessor` access to the selected legacy secret, or
complete the canonical per-environment bundle setup and remove the legacy
selectors only after validation succeeds.

The official loader is now available through the legacy bundle selectors, and
the development audit completed. Production certification is still blocked
because the authoritative production Supabase runtime connection fails
authentication:

```text
password authentication failed for user "postgres" (28P01)
```

The official production runner was invoked through `load-secrets.mjs` with
`APP_ENV=production`, `NODE_ENV=production`,
`SECRET_MANAGER_LEGACY_MODE=1`, and
`SPORT_CENTER_FINANCE_MODE=legacy`. Secret loading succeeded, but the runner
stopped before the startup stage when the database pool could not authenticate.
No production query, migration, marker update, processor run, payment write,
accounting write, settlement effect, or mutation effect was performed.

This is an infrastructure/access blocker, not a parity failure. The prior
CF-SC-12C-3 evidence remains the last authoritative live-production evidence:
runtime and migration authentication passed, the official startup runner
returned `already_completed / skipped`, the `sport_center` marker was
`completed`, and production remained in legacy mode.

## Frozen baseline and evidence boundary

CF-SC-12C-3 established these production identities and invariants:

| Contract | Certified value |
|---|---|
| Production project reference | `nzdweipzckfszczzqtuw` |
| Project config | `2` |
| Tax rule | `8` |
| Revenue COA | `72354` |
| Tax output COA | `49109` |
| Receiving bank COA | `75590` |
| MDR expense COA | `75594` |
| MDR | `0.003` |
| Currency | `IDR` |
| Production finance mode | `legacy` |
| Production processor runs | `0` |

The attached CF-SC-13 runbook requires exact current DEV and PROD catalog
comparison. PROD catalog/function/index/data parity remains unverified because
authentication failed. `DATABASE_URL` was never used as a substitute for the
authoritative Supabase DEV or PROD targets.

## Current DEV live audit

The legacy bundle loaded successfully for development and the read-only audit
connected to PostgreSQL 17.6. The expected foundation tables and processing
table were present, with the following catalog shape:

```text
finance_project_configs              = 13 columns
finance_project_payment_configs     = 25 columns
finance_project_tax_mappings        = 15 columns
finance_project_coa_mappings        = 16 columns
central_finance_processing          = 15 columns
constraints                         = 30
indexes                             = 61
invalid processing states            = 0
duplicate source groups              = 0
duplicate correlation groups        = 0
startup marker                       = sport_center / version 1 / completed
```

The DEV effective configuration resolved uniquely for
`sport_center / company 1 / QRIS / mandiri_direct`, with MDR `0.003`, fixed
fee `0.00`, fee tax `0`, settlement delay `1`, and tax rule `8`.

However, the live DEV mapping must not be certified as a clean baseline yet:
the observed role rows associate `RECEIVING_BANK` with COA `75594`
(`1-1023-CST`) and `MDR_EXPENSE` with COA `75590` (`5-3050-CST`), which is
opposite the certified business identities. The DEV payment config also
resolves to bank account `17`, not the production identity `2`. This is
recorded as deterministic drift requiring owner-approved semantic correction;
no COA or configuration mutation was attempted.

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| DEV certified baseline | BLOCKED | Live DEV read succeeded, but role-to-COA semantic drift was observed |
| PROD foundation table parity | BLOCKED | No authoritative PROD connection available |
| Processing state parity | BLOCKED | No live PROD catalog/data query performed |
| Config parity | BLOCKED | DEV drift observed; PROD not reachable |
| Function signature parity | BLOCKED | DEV signatures read; no live PROD comparison |
| Function behavior contract | BLOCKED | No production function execution permitted or attempted |
| Settlement FK parity | BLOCKED | No live PROD catalog query performed |
| Index/unique parity | BLOCKED | No live PROD catalog query performed |
| Canonical mutation contract | BLOCKED | No live PROD catalog query performed |
| Accounting contract parity | BLOCKED | No live PROD function body query performed |
| Settlement economics | BLOCKED | No live PROD config query performed |
| Historical compatibility | BLOCKED | No live PROD data query performed |
| Startup marker | PASS (DEV live and prior PROD evidence) | DEV marker completed; prior CF-SC-12C-3 reported PROD marker completed |
| Pooler connection regression | PASS | Static regression test added and passed |
| Workspace/API typecheck | PASS | `pnpm typecheck` |
| API build | PASS | `pnpm build` |
| Focused Central Finance tests | PASS | 84/84 tests passed |
| Git diff check | PASS | `git diff --check` |
| Production readiness | BLOCKED | PROD authentication failed; no production runtime or `/api/health/ready` access |

## Pooler regression

The current shared database pool does not pass `search_path` as a PostgreSQL
startup option. Instead, for non-local connections it applies:

```sql
SET search_path = public;
SET lock_timeout = '20s';
SET sport_center.finance_mode = '<legacy|central>';
```

through the compatible per-connection handler. The focused regression test
asserts both properties and prevents a recurrence of the CF-SC-12C-3
pooler startup-option issue.

## Business-effect audit

No CF-SC-13 production operation was reached. Therefore the audit introduced:

```text
processing business rows = 0
payment writes = 0
accounting writes = 0
settlement effects = 0
public/canonical mutation effects = 0
processor runs = 0
```

The new workspace changes are limited to the pooler regression test and this
documentation. No production data or configuration was changed.

## Mode and cutover safety

```text
PROD MODE BEFORE = LEGACY (CF-SC-12C-3 evidence)
PROD MODE AFTER  = NOT REACHED; no production process was started
PROD SHADOW      = NO
PROD CENTRAL     = NO
PROD CUTOVER     = NO
PROCESSOR RUN    = NO
PAYMENT FIXTURE  = NO
SETTLEMENT FIXTURE = NO
```

## Required next step

Repair or republish the authoritative production database credentials in the
legacy bundle consumed by the official loader, then rerun the audit. The
canonical bundle migration should be completed separately after both bundles
exist. The audit must:

1. load the authoritative DEV and PROD bundles through `load-secrets.mjs`;
2. verify both target references and both read-only connections;
3. compare current catalog/function/config/history results against the frozen
   DEV-certified contract;
4. apply only explicitly safe additive deterministic repairs, if any;
5. rerun all gates and `GET /api/health/ready`;
6. keep `SPORT_CENTER_FINANCE_MODE=legacy` throughout.

Do not treat this report as authorization to enable shadow, central mode,
processor execution, payment fixtures, settlement fixtures, or cutover.
