# CF-SC-12 — PROD Additive Central Finance Foundation Parity

**Date:** 2026-08-22
**Input gate:** CF-SC-11 PROD read-only parity = `BLOCKED`  
**Scope:** additive foundation only; production must remain legacy

## CF-SC-12B targeted runner

The repository now contains a dedicated, additive production runner:

```text
scripts/cf-sc-12b-targeted-prod-migration.mjs
CF_SC_12B_APPLY=true pnpm db:migrate:cf-sc-12b:prod
```

It is deliberately not part of generic DEV→PROD reconciliation and is not
called during application startup. It refuses to write unless both
`APP_ENV=production` and the explicit opt-in `CF_SC_12B_APPLY=true` are
present. The runner creates only the five CF-SC-12B foundation tables,
prechecks canonical settlement references before adding the FK, installs the
checked-in certified Sport Center owner functions, seeds the verified PROD
business identities, and performs a resolver proof in the same transaction.
It does not process payments, settlements, reconciliation, provider calls, or
notifications.

The runner was executed only after the explicit CF-SC-12B APPLY brief authorized
the production write. The historical discovery below is retained as audit
context, but it is superseded by the execution evidence in the final section.

## Historical pre-apply result

```text
CF-SC-12 = HISTORICAL BLOCKED
PROD MODE BEFORE = LEGACY
PROD MODE AFTER  = LEGACY
CENTRAL PROCESSOR RUNS = 0
PROD WRITES = 0
PROD PAYLABS CALLS = 0
PROD WHATSAPP SENDS = 0
PROD CUTOVER = NO
PROD SHADOW ENABLED = NO
LEGACY CLEANUP = NO
READY FOR POST-MIGRATION PROD PARITY AUDIT = SUPERSEDED
```

That was the state before the later authorized CF-SC-12B APPLY run.

## Why the phase stopped

CF-SC-12 requires exact PROD business identities before shared configuration is
seeded. The read-only PROD discovery found:

| Required identity | PROD result |
|---|---|
| `RECEIVING_BANK` — `1-1023-CST`, Bank Mandiri Ciputat | **MISSING** from `public.chart_of_accounts`; no matching `sport_center.coa_accounts` row |
| `REVENUE` — `4-1017-CST` | resolved uniquely: PROD ID `72354`, active |
| `TAX_OUTPUT` — `2-1020-CST` | resolved uniquely: PROD ID `49109`, active |
| `MDR_EXPENSE` — `5-3050-CST` | **MISSING** from the exact-code lookup |
| Sport Center tax rule | resolved uniquely: ID `8`, PPN Sport Center 11%, output, company 1 |
| QRIS/Mandiri bank account | resolved through the owner-approved legacy config: `company_bank_accounts.id=2`, account `1640006707220`, IDR, MDR `0.003` |

The missing receiving-bank and MDR expense identities are not safe to infer
from similarly named accounts. The instruction therefore requires:

```text
BLOCKED_CONFIG_IDENTITY
STOP before shared config seed
```

No numeric DEV IDs were copied into PROD.

## Pre-migration PROD state

The CF-SC-11 evidence remains authoritative:

- `sport_center.central_finance_processing` missing.
- `public.finance_project_configs` missing.
- `public.finance_project_payment_configs` missing.
- `public.finance_project_tax_mappings` missing.
- `public.finance_project_coa_mappings` missing.
- `sport_center.resolve_shared_finance_config` missing.
- `sport_center.ensure_canonical_bank_mutation_for_settlement` missing.
- `canonical_bank_mutation_id` FK missing.
- `sport_center` startup marker is failed because the canonical bank COA
  identity cannot be resolved.

The production connection was resolved through the production Secret Manager
bundle and all discovery queries ran in a transaction with:

```sql
SET TRANSACTION READ ONLY;
```

The transaction was rolled back.

## PROD COA GAP RESOLUTION

CF-SC-12A read-only discovery was completed on 2026-08-21. No INSERT,
UPDATE, DELETE, or DDL was issued.

### Exact Mandiri bank linkage

The owner-approved active PROD bank row is:

| Field | Value |
|---|---|
| `company_bank_accounts.id` | `2` |
| `bank_name` | `Bank Mandiri` |
| `name` | `Bank Mandiri Ciputat` |
| `account_number` | `164***20` |
| `company_id` | `1` |
| `currency_code` | `IDR` |
| `account_type` | `bank` |
| `coa_id` | `75590` |

The explicit bank→COA link is **FAIL**: `chart_of_accounts.id=75590` does not
exist in PROD. This is an orphan reference and was not repaired automatically.

### RECEIVING_BANK candidates

| Candidate | Evidence | Result |
|---|---|---|
| `75590` | Explicit `company_bank_accounts.coa_id` link | Invalid/orphan; no PROD COA row |
| `49098 / 1-1020-CST / Bank Mandiri CST` | Active PROD asset COA; used by 88 accounting entries, including current Sport Center QRIS payment entries | Valid existing different code |
| `35204 / 1-1020 / Bank Mandiri` | Active generic Bank Mandiri asset COA | Candidate by name only; not selected |

The current Sport Center QRIS accounting entries debit `49098`, while the
orphan `75590` is used by 308 entries across mixed business flows (including
Sport Center and tenant-rent payments). Therefore `49098` is the strongest
existing business candidate, but the broken explicit link and mixed historical
usage require owner confirmation before it can be treated as the canonical
receiving-bank mapping.

```text
RECEIVING_BANK = VALID_EXISTING_DIFFERENT_CODE
RECEIVING_BANK PROD COA ID = 49098
RECEIVING_BANK PROD CODE = 1-1020-CST
RECEIVING_BANK PROD NAME = Bank Mandiri CST
BANK→COA LINK = FAIL (orphan coa_id=75590)
```

### MDR candidates and actual usage

The exact expected account `5-3050-CST / Biaya MDR & Payment Gateway CST` is
absent. No PROD COA with an unambiguous MDR, merchant discount, payment
gateway, or QRIS-fee identity was found.

The closest active CST expense account is:

```text
49139 / 5-3010-CST / Beban Bunga & Administrasi Bank CST
```

Its observed usage is four debit entries totaling IDR 10,500:

- two manual bank-fee/admin entries;
- one bank-reconciliation entry explicitly mapped to `5-3010-CST`;
- no evidence that these entries represent QRIS merchant discount/MDR.

It must not be reused automatically as `MDR_EXPENSE`.

```text
MDR_EXPENSE = TRULY_MISSING
MDR PROD COA ID = NONE
MDR PROD CODE = NONE
MDR PROD NAME = NONE
MDR ACCOUNTING USAGE = NOT_FOUND (explicit MDR/QRIS merchant-fee usage)
```

### Proposed additive COA plan — not executed

| Role | Proposed code | Proposed name | Type | Category | Normal balance | Parent | Reason |
|---|---|---|---|---|---|---|---|
| `MDR_EXPENSE` | `5-3050-CST` | `Biaya MDR & Payment Gateway CST` | expense | expense | debit | `OWNER_DECISION_REQUIRED` | Dedicated expense identity for QRIS/payment-provider MDR |

The code is available in the exact-code collision check, but the parent
account/category cannot be safely proven from the current PROD catalog:
the expected CST expense-child parent identity is not present as a resolved
active parent row in this read-only result. No account was created.

```text
NEW COA REQUIRED = PARTIAL
OWNER DECISION REQUIRED = YES
PROPOSED COA PLAN = 5-3050-CST, pending owner-approved parent/category and bank-link decision
```

### CF-SC-12A result

```text
CF-SC-12A = BLOCKED
PROD WRITES = 0
PROD MIGRATIONS = 0
PROD MODE = LEGACY
READY TO RESUME CF-SC-12 = NO
BLOCKERS =
  1. bank_account_id=2 has orphan coa_id=75590;
  2. owner confirmation is required before selecting 49098 as RECEIVING_BANK;
  3. MDR_EXPENSE is truly missing;
  4. additive MDR parent/category requires owner decision.
```

The PostgreSQL 16.10 versus 17.6 `pg_dump` mismatch remains a separate
tooling note only; it is not a finance classification blocker for CF-SC-12A.

## Certified DEV contract freeze

The source of truth was kept as the certified DEV runtime and checked-in
CF-SC-10 implementation, not reconstructed business definitions. The exact
live DEV function identity evidence from CF-SC-11 remains:

```text
resolve_shared_finance_config(...)                  39f0b9c0d8ce522e35eae5238355c156
create_payment_accounting_draft(integer)            023865839f62812b6953f85d6a7a1378
create_payment_settlement_batch(...)                d1221f0de73bb9f144d2ec334fd09a5b
create_settlement_journal_draft(...)                a0dcd4df545a01b2bc87b9c56b09ad43
ensure_canonical_bank_mutation_for_settlement(...)  a32d78d2beea4600908109645f40fde9
finalize_payment_settlement(...)                    d6b6ebe66133f967a25d612994503187
project_public_bank_mutation_to_canonical(integer)  cad845e2b2107c8a6229dd5b8dd4b886
```

No PROD function was replaced because the required canonical identities were
not proven and the complete additive migration could not be safely completed.

## Migration application

```text
EXACT MIGRATION APPLIED = NO
SHARED CONFIG CREATED   = NO
FK INSTALLED             = NO
FUNCTIONS REPLACED       = NO
STARTUP MARKER ADVANCED  = NO
ORPHAN ROWS MODIFIED     = 0
PAYMENT/ACCOUNTING ROWS MODIFIED = 0
```

An attempt was made to use the installed `pg_dump` client to freeze exact DEV
table definitions. The local client was PostgreSQL 16.10 while the DEV server
reported PostgreSQL 17.6, so the extraction tool stopped before producing a
usable dump. This was a local tooling mismatch only; it made no PROD request
that could mutate data and did not alter the repository.

## Idempotency and quality gates

Because no migration was applied:

```text
MIGRATION IDEMPOTENCY = NOT RUN
TYPECHECK             = NOT RUN for CF-SC-12 changes
TARGETED TESTS        = NOT RUN for CF-SC-12 changes
BUILD                 = NOT RUN for CF-SC-12 changes
GIT DIFF CHECK        = PASS for the documentation-only change
READINESS             = BLOCKED
```

The application remains in the legacy path. No production restart or runtime
mode change was performed.

## Required resolution before retry

Resolve and owner-approve exact active PROD identities for:

1. `RECEIVING_BANK`: Bank Mandiri Ciputat / `1-1023-CST`.
2. `MDR_EXPENSE`: `5-3050-CST`, Biaya MDR & Payment Gateway CST.

Then repeat the read-only precheck, freeze exact DEV catalog definitions with a
PostgreSQL 17-compatible tool, and only after all identities are unique apply
one reviewed additive migration. Do not advance the startup marker merely to
hide the failed COA identity check.

**STOP.**

## Current platform recheck — 2026-08-21

The CF-SC-12A read-only gate was rechecked from the current workspace before
any production query was attempted. The database service reported that this
Repl does not have a production database:

```text
PROD CONNECTION = NOT AVAILABLE
READ ONLY       = NOT REACHED
PROD QUERIES    = 0
PROD WRITES     = 0
PROD MIGRATIONS = 0
```

Because a production replica/database is not provisioned for this workspace,
the current run cannot independently revalidate the historical PROD evidence
above. DEV was deliberately not used as a substitute, and no COA
classification or additive proposal was promoted from assumption. CF-SC-12A
therefore remains `BLOCKED`; resume only after an explicitly identifiable PROD
database is available for read-only inspection.

## CF-SC-12A-1 — production connection resolution

The production connection contract was resolved without changing application
finance behavior:

| Item | Result |
|---|---|
| Secret source | GCP Secret Manager bundle `cst-super-app-production` |
| Canonical key | `SUPABASE_DATABASE_URL` |
| Production secret | PRESENT; loader validation passed |
| Development secret | `SUPABASE_DATABASE_URL_DEV`, from `cst-super-app-development` |
| DEV business database | Supabase PostgreSQL |
| PROD business database | Supabase PostgreSQL |
| Production database | `postgres` |
| PostgreSQL server | 17.6 |
| Schemas | `public`, `sport_center` |
| Read-only transaction | ENFORCED (`transaction_read_only=on`) |
| DEV/PROD isolation | CONFIRMED: metadata fingerprints differ |

Both checks used a dedicated PostgreSQL client, executed `BEGIN` followed by
`SET TRANSACTION READ ONLY`, selected harmless connection/schema metadata only,
and ended with `ROLLBACK`. No business-table query, migration, processor run,
or application start occurred.

```text
CF-SC-12A-1 = PASS
PROD CONNECTION = PASS
READ ONLY = YES
DEV DB != PROD DB = YES
PRODUCTION DATABASE CREATED = NO
DEV USED AS PROD SUBSTITUTE = NO
PROD WRITES = 0
PROD MIGRATIONS = 0
PROD PROCESSOR RUNS = 0
READY TO RESUME CF-SC-12A = YES (connection gate only)
EXTERNAL ACTION REQUIRED = NONE
```

The earlier “production database not available” result came from the Replit
database-pane abstraction, not from the application's external Supabase
production connection. CF-SC-12A COA discovery is the next phase and was not
run as part of this connection-resolution task.

## CF-SC-12A-2 — deterministic PROD COA remediation

The production bundle was revalidated through the official loader. The
transaction-level audit confirmed PostgreSQL 17.6, `transaction_read_only=on`
for verification, and legacy finance behavior (the application default when
`SPORT_CENTER_FINANCE_MODE` is unset). No central processor, payment
simulation, provider call, WhatsApp send, settlement execution, reconciliation,
or historical backfill was run.

The two COA identities were deterministic and were repaired in one guarded
production transaction:

| Role | Result |
|---|---|
| `RECEIVING_BANK` | Reused ID `75590`; repaired `company_id` from `NULL` to `1` |
| `RECEIVING_BANK` code/name | `1-1023-CST` / `Bank Mandiri Ciputat` |
| Receiving bank link | `company_bank_accounts.id=2` remains linked to `coa_id=75590` |
| Receiving bank postability | `is_postable=true`, `is_header=false`, active |
| `MDR_EXPENSE` | Created ID `75594` |
| MDR code/name | `5-3050-CST` / `Biaya MDR & Payment Gateway CST` |
| MDR structure | company `1`, parent `3496` (`5-3000`), expense, debit, postable |
| Existing payment/accounting history modified | `0` |

The read-only post-fix gate passed for both COA roles. The shared CF-SC-12
foundation remains blocked: all five required foundation tables are still
absent and the live production function set is incomplete. The generic
DEV→PROD additive reconciler reported unrelated production conflicts and was
not applied; no broad schema promotion or startup-marker advancement was used
to conceal that gap.

```text
CF-SC-12A-2 = PASS (COA remediation)
RECEIVING_BANK FIX = REUSED_EXISTING_OWNERSHIP_REPAIRED
RECEIVING_BANK PROD COA ID = 75590
MDR FIX = CREATED_NEW
MDR PROD COA ID = 75594
EXISTING PAYMENT HISTORY MODIFIED = 0
CF-SC-12 FOUNDATION = BLOCKED
SHARED CONFIG = BLOCKED
FUNCTION PARITY = BLOCKED
FK PARITY = BLOCKED
STARTUP MARKER = NOT ADVANCED
PROD MODE BEFORE = LEGACY
PROD MODE AFTER = LEGACY
CENTRAL PROCESSOR RUNS = 0
PROD PAYLABS CALLS = 0
PROD WHATSAPP = 0
PROD CUTOVER = NO
LEGACY CLEANUP = NO
```

## CF-SC-12B — authorized PROD execution evidence

The guarded runner was executed twice on 2026-08-22 through the official
production Secret Manager loader. Before both runs, the runner verified
`APP_ENV=production`, `CF_SC_12B_APPLY=true`, the verified PROD Supabase project
reference, a distinct pinned DEV project reference, and
`SPORT_CENTER_FINANCE_MODE=legacy`.

Both runs returned `status = PASS`. The second run is the idempotency proof.
The generic DEV→PROD reconciler was not used.

| Item | PROD result |
|---|---|
| Database | `postgres` |
| PostgreSQL | `17.6` |
| Finance mode | `legacy` |
| Finance project config | ID `2`, `sport_center`, company `1` |
| Tax rule | ID `8`, PPN Sport Center 11% output |
| Revenue COA | ID `72354`, `4-1017-CST` |
| Tax output COA | ID `49109`, `2-1020-CST` |
| Receiving bank COA | ID `75590`, `1-1023-CST` |
| MDR expense COA | ID `75594`, `5-3050-CST` |
| QRIS payment config | ID `2`, `mandiri_direct`, IDR, MDR `0.003`, T+1 |
| Resolver identity | `sport_center:2:2:1:1:1` |

The five shared-finance foundation relations, processing constraints, canonical
settlement FK/indexes, and required owner routine signatures passed read-only
post-apply inspection. The official read-only canonical settlement preflight
also returned `PREFLIGHT: PASS`. Current processing rows remain `0`.

The migration reported and enforced:

```text
CENTRAL PROCESSOR RUNS = 0
PAYMENT WRITES = 0
ACCOUNTING WRITES = 0
SETTLEMENT PROCESSING = 0
PAYLABS CALLS = 0
WHATSAPP SENDS = 0
PROD CUTOVER = NO
LEGACY CLEANUP = NO
```

### Startup and readiness boundary

The restarted development API passed its readiness check:

```text
GET /api/health/ready = HTTP 200
ready = true
customer_portal_ready = true
sport_center_ready = true
failed_stage = null
```

The PROD `startup_migration_state` still contains a pre-existing failed
`sport_center` marker whose error names the old missing
`sport_center.coa_accounts` identity. It was not manually advanced, because this
targeted runner is intentionally outside normal startup and must not claim a
general startup-stage completion. The current PROD foundation and canonical
preflight are PASS, while the separate PROD startup-marker gate remains
`BLOCKED` pending an approved normal-startup validation.

### Final CF-SC-12B report

```text
CF-SC-12B TARGETED FOUNDATION = PASS
PROD/DEV SEPARATION = PASS
PROD MODE = LEGACY
IDEMPOTENCY (SECOND RUN) = PASS
READ-ONLY PARITY = PASS
CANONICAL PREFLIGHT = PASS
STARTUP MARKER GATE = BLOCKED (not manually advanced)
DEV API READINESS = PASS
PROD PAYMENT/SETTLEMENT PROCESSING = 0
PROD CUTOVER = NO
READY FOR CENTRAL FINANCE PROCESSING = NO
```

The last line is intentional: CF-SC-12B provisions the shared foundation only;
it does not authorize central-mode cutover or payment processing. The separate
startup-marker gate must be resolved before claiming end-to-end startup
certification.

## CF-SC-12C — official startup marker recovery

CF-SC-12C was authorized to retry the actual `Sport Center migration` startup
stage while preserving legacy mode and without manually updating
`startup_migration_state`. The current source version is stage version `1`;
the failed PROD marker is therefore not being bypassed by a version bump.

The recovery entry delegates marker ownership to the repository's
`runStartupMigrationStage` mechanism and invokes `runSportCenterMigration`.
Because the nested Sport Center bootstrap is already complete, the normal
startup contract can skip broad legacy replay and only validate the stage.
No direct `UPDATE startup_migration_state` was added or executed.

The first and second build attempts exposed only source import mistakes and
stopped before PROD access; those were corrected. The recovery build then
succeeded, but both authorized execution attempts stopped in the official
production Secret Manager loader:

```text
Secret payload is not a valid JSON object:
Bad control character in string literal in JSON at position 250
```

This is a managed production-secret payload failure, not a startup-stage or
database failure. The loader had succeeded earlier for CF-SC-12B, but the
current retry returned the same error twice. No production connection was
opened by CF-SC-12C, no advisory lock was acquired, and no marker or business
data was changed. The existing PROD marker remains:

```text
stage_name = sport_center
status = failed
last_error = historical missing sport_center.coa_accounts identity
```

```text
CF-SC-12C = BLOCKED
PROD MODE BEFORE = LEGACY
PROD MODE AFTER = NOT REACHED; remains LEGACY
HISTORICAL FAILURE CONDITION = RESOLVED by CF-SC-12B foundation/COA proof
SPORT_CENTER MARKER BEFORE = FAILED
SPORT_CENTER MARKER AFTER = UNCHANGED FAILED
CANONICAL FINANCE MARKER = NOT REQUIRED
MARKER SOURCE = OFFICIAL STARTUP PATH NOT REACHED
MANUAL MARKER UPDATE = NO
ADVISORY LOCK = NOT ACQUIRED
STARTUP IDEMPOTENT = NOT REACHED
CONFIG RESOLUTION = PASS from CF-SC-12B
RESOLVER = PASS
SETTLEMENT PREFLIGHT = PASS
PROCESSING ROWS CREATED = 0
PROD PAYMENT WRITES = 0
PROD ACCOUNTING WRITES = 0
PROD SETTLEMENT PROCESSING = 0
PROD MUTATION BUSINESS EFFECTS = 0
PAYLABS CALLS = 0
WHATSAPP SENDS = 0
CF-SC-12 COMPLETE = NO
```

The remaining action is to repair or republish the managed
`cst-super-app-production` Secret Manager JSON through the approved secrets
flow, then rerun the official CF-SC-12C stage and its idempotent retry. The
recovery runner must not be changed to parse around or bypass that loader
failure.

## CF-SC-12C-1 — managed production secret repair retry

On 2026-08-22 the production bundle was audited through the approved
Secret Manager client. The active version was `16`, with a 9,955-byte payload.
The sanitized parser diagnostic found 72 raw CR/LF control characters inside
JSON strings and one stray quote at raw offset `2625`; the root cause is
`RAW_CONTROL_CHARACTER_IN_STRING` with adjacent structural corruption. No
secret values were printed or persisted in the repository.

The payload was repaired in memory only by removing that confirmed stray quote
and JSON-escaping the raw control characters. The result was a single JSON
object with 39 keys, no `_DEV` keys, no placeholder values, no duplicate
top-level keys, and the production database project reference
`nzdweipzckfszczzqtuw`. A new Secret Manager version was created through the
official `addSecretVersion` path:

```text
secret = cst-super-app-production
old version = 16
new version = 17
JSON parse = PASS
official production loader = PASS
```

The direct validation and loader checks passed. The official CF-SC-12C runner
was then invoked with `APP_ENV=production` and
`SPORT_CENTER_FINANCE_MODE=legacy`. It failed closed before the startup stage
because `SUPABASE_MIGRATION_URL` is absent from the repaired bundle and no
approved existing source for that direct production URL was available. The
runner's target-separation guard therefore rejected the pooler-only database
URL; no migration stage, advisory lock, marker update, or business-finance
write was performed by the runner.

Historical Secret Manager versions could not be used for recovery: versions
1–15 are unavailable, and the service account does not have
`secretmanager.versions.list`. No older secret value was reconstructed or
copied. The production marker consequently remains `FAILED`, production
mode remains `legacy`, and readiness/CF-SC-12C certification are still
`BLOCKED` pending an owner-approved direct migration URL in the production
bundle followed by another official runner attempt.

## CF-SC-12C-3 — authoritative production connection recovery

On 2026-08-22 the official production loader was rerun against the current
`cst-super-app-production` bundle. The bundle loaded successfully with 38 keys,
including both `SUPABASE_DATABASE_URL` and `SUPABASE_MIGRATION_URL`; no secret
values were printed or persisted.

Sanitized connection validation produced:

```text
PROD PROJECT REF = nzdweipzckfszczzqtuw
RUNTIME CONNECTION = Supabase pooler, port 6543
RUNTIME USERNAME FORMAT = postgres.nzdweipzckfszczzqtuw
RUNTIME HOST DNS = PASS
RUNTIME DB AUTH = FAIL (28P01 password authentication failed)
MIGRATION CONNECTION = Supabase direct host, port 5432
MIGRATION HOST DNS = FAIL (ENOTFOUND)
MIGRATION DB AUTH = NOT REACHED
DEV != PROD = NOT REACHED; no fallback performed
```

The approved bootstrap credential can access the current production bundle, but
the service account cannot list Secret Manager versions (`code 7`). Supabase
CLI is not installed in the workspace, and no other approved source exposed a
current production database password or an authoritative replacement migration
host. The existing values were therefore not repaired, no password rotation was
attempted, and no new Secret Manager version was created.

The official `runStartupMigrationStage` recovery was not retried because both
required connection paths did not validate. No advisory lock was acquired, no
startup marker was changed, and no business-finance effect occurred:

```text
CF-SC-12C-3 = BLOCKED
OFFICIAL CF-SC-12C RETRY = NOT_REACHED
SPORT_CENTER MARKER = FAILED / UNCHANGED
MANUAL MARKER UPDATE = NO
PROD MODE = LEGACY
PROD PROCESSOR RUNS = 0
PROD PAYMENT WRITES = 0
PROD ACCOUNTING WRITES = 0
PROD SETTLEMENT EFFECTS = 0
PROD MUTATION EFFECTS = 0
READINESS = NOT_REACHED
CF-SC-12 COMPLETE = NO
READY FOR CF-SC-13 = NO
EXTERNAL ACTION REQUIRED = OWNER_INFRA_ACTION_REQUIRED
```

Required infrastructure action: provide the current production Supabase
connection contract through an approved source, specifically the valid runtime
database credential and canonical migration connection parameters. Do not
derive the direct host, reuse the stale password, or rotate the password until
all production consumers and an approved rotation path are verified. After the
bundle is repaired, rerun the official CF-SC-12C startup recovery.