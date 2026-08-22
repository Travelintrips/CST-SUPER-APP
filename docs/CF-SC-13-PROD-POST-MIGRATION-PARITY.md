# CF-SC-13 — Post-Migration PROD Parity Certification

**Date:** 2026-08-22  
**Scope:** production read-only parity audit after CF-SC-12C-3  
**Required mode:** `SPORT_CENTER_FINANCE_MODE=legacy`

## Final verdict

```text
CF-SC-13 = BLOCKED
READY FOR SHADOW ASSESSMENT = NO
```

The certification could not be completed in this workspace session because the
official production Secret Manager loader failed before database access:

```text
GCP_SECRET_MANAGER_BOOTSTRAP_JSON is not set
```

The only exposed database variable in this session was `DATABASE_URL`. It was
not used as a substitute for the authoritative Supabase development or
production targets. No production query, migration, marker update, processor
run, payment write, accounting write, settlement effect, or mutation effect was
performed.

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
comparison. Because the official loader could not initialize, no claim is made
here about current live PROD table/function/index/data parity.

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| DEV certified baseline | BLOCKED | Official loader could not initialize in this session |
| PROD foundation table parity | BLOCKED | No authoritative PROD connection available |
| Processing state parity | BLOCKED | No live PROD catalog/data query performed |
| Config parity | BLOCKED | CF-SC-12C-3 identities retained as historical baseline only |
| Function signature parity | BLOCKED | No live PROD `pg_proc` comparison performed |
| Function behavior contract | BLOCKED | No production function execution permitted or attempted |
| Settlement FK parity | BLOCKED | No live PROD catalog query performed |
| Index/unique parity | BLOCKED | No live PROD catalog query performed |
| Canonical mutation contract | BLOCKED | No live PROD catalog query performed |
| Accounting contract parity | BLOCKED | No live PROD function body query performed |
| Settlement economics | BLOCKED | No live PROD config query performed |
| Historical compatibility | BLOCKED | No live PROD data query performed |
| Startup marker | PASS (prior evidence) | CF-SC-12C-3 reported official marker `completed` |
| Pooler connection regression | PASS | Static regression test added and passed |
| Workspace/API typecheck | PASS | `pnpm typecheck` |
| API build | PASS | `pnpm build` |
| Focused Central Finance tests | PASS | 84/84 tests passed |
| Git diff check | PASS | `git diff --check` |
| Production readiness | BLOCKED | No production runtime or `/api/health/ready` access |

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

Run the same official read-only audit from a session where the approved
`GCP_SECRET_MANAGER_BOOTSTRAP_JSON` is available to the workspace secret
loader. The audit must:

1. load the authoritative DEV and PROD bundles through `load-secrets.mjs`;
2. verify both target references and both read-only connections;
3. compare current catalog/function/config/history results against the frozen
   DEV-certified contract;
4. apply only explicitly safe additive deterministic repairs, if any;
5. rerun all gates and `GET /api/health/ready`;
6. keep `SPORT_CENTER_FINANCE_MODE=legacy` throughout.

Do not treat this report as authorization to enable shadow, central mode,
processor execution, payment fixtures, settlement fixtures, or cutover.
