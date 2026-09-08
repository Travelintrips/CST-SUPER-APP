# CF-SC-13 — Post-Migration PROD Parity Certification

**Date:** 2026-08-22  
**Scope:** production read-only parity audit after CF-SC-12C-3  
**Required mode:** `SPORT_CENTER_FINANCE_MODE=legacy`

## Final verdict

```text
CF-SC-13 = BLOCKED
STRUCTURED PARITY = BLOCKED
READY FOR SHADOW ASSESSMENT = NO
```

The earlier structured-parity result is superseded by the live continuation
below. It was based on the first targeted comparison and did not include the
later semantic resolver check, exact foreign-key target inspection, or the
historical public-bank-link classification.

### CF-SC-13B targeted remediation — 2026-08-22

The official read-only parity runner was added at
`scripts/cf-sc-13b-targeted-prod-parity.mjs` with the wrapper
`scripts/cf-sc-13b-parity.sh`. It loads the DEV and PROD bundles in separate
processes, verifies project separation, opens a `READ ONLY` transaction, and
never creates rows, invokes a processor, or calls an external provider.

The audit completed three consistent PROD reads after the prior blocked
connection state was cleared:

| Gate | Result |
|---|---|
| Canonical PROD access | PASS |
| DEV project reference | `xssrfshdrtdfupgqwfdw` |
| PROD project reference | `nzdweipzckfszczzqtuw` |
| Function signatures and bodies | PASS; no routine diff |
| Sport Center required column drift | `0` |
| Shared finance required drift | `0` |
| Canonical settlement FK | PASS; `int4`, correct target, invalid references `0` |
| Mutation provenance | PASS; all five required fields present |
| PROD startup markers | `sport_center=completed`, canonical config `completed` |
| Duplicate processing identities | `0` |
| PROD processing rows | `0` |
| PROD mode | `legacy` |

The exact remaining column differences are classified rather than blindly
promoted:

- `product_scope` and `service_scope`: `CUSTOMER_PORTAL_ONLY`; no Sport Center
  consumer was found, so they are not added to PROD.
- `comparison_class` and `comparison_evidence`: `DEV_FIXTURE_ONLY`; no
  certified runtime consumer was found, so they are not added to PROD.
- PROD `config_version` columns: `PROD_ALLOWED_EXTENSION`; they are retained.
- Serial width/default and index/constraint naming differences are reported as
  catalog evidence but are not rewritten because the certified resolver and
  owner routines already operate correctly and the differences are not a
  proven shared-contract requirement.

The official guarded CF-SC-12B runner was then executed twice with
`CF_SC_12B_APPLY=true`, `APP_ENV=production`, and legacy mode. Both returned
`PASS`; the second run proved idempotency. The runner confirmed the existing
configuration identities (`project_config=2`, tax rule `8`, revenue `72354`,
tax output `49109`, receiving bank `75590`, MDR `75594`) and reported zero
processor, payment, accounting, settlement, Paylabs, and WhatsApp effects.

Deployment readiness is now `PASS` in the verified development runtime:
`GET /api/health/ready` returned HTTP 200 with `ready=true`,
`customer_portal_ready=true`, `sport_center_ready=true`, and no failed startup
stage. Both portal previews returned HTTP 200 after their workflows were
restarted. The earlier workflow secret propagation issue was resolved by
restarting the managed workflow; it was not a PROD database failure. No shadow,
central mode, cutover, or processor execution was enabled.

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

## CF-SC-13 live continuation — 2026-09-08

The authoritative DEV and PROD bundles were loaded again through
`artifacts/api-server/load-secrets.mjs`. Both targets connected to PostgreSQL
17.6 in a transaction with `SET TRANSACTION READ ONLY`; no production DDL,
DML, processor, payment, accounting, settlement, provider, or notification
operation was issued.

### Semantic configuration result

The PROD resolver is internally consistent with the frozen CF-SC-12
identities:

```text
effective identity = sport_center:2:2:1:1:1
project config     = 2
payment config     = 2
tax mapping        = 1
tax rule           = 8
bank account       = 2
REVENUE            = 72354
TAX_OUTPUT         = 49109
RECEIVING_BANK     = 75590
MDR_EXPENSE        = 75594
MDR                = 0.003
currency           = IDR
fixed fee          = 0.00
fee tax            = 0.00
settlement delay   = 1
config ambiguities = 0
```

The live DEV resolver was not a certified semantic baseline before the
owner-approved DEV repair recorded below:

```text
effective identity = sport_center:2:2:3:1:1
project config     = 2
payment config     = 2
tax mapping        = 3
bank account       = 17
REVENUE            = 72354
TAX_OUTPUT         = 49109
RECEIVING_BANK     = 75594  (expected certified role: 75590)
MDR_EXPENSE       = 75590  (expected certified role: 75594)
MDR                = 0.003
currency           = IDR
fixed fee          = 0.00
fee tax            = 0.00
settlement delay   = 1
```

This is an owner-approved semantic decision point, not a safe numeric-ID
copy. No DEV or PROD configuration was changed.

### DEV baseline certification — 2026-09-08

The owner-approved DEV semantic baseline is now recorded by business identity,
not by copying PROD surrogate IDs:

| Semantic field | Certified value |
|---|---|
| Project / company | `sport_center` / company `1` |
| Payment / provider | `QRIS` / `mandiri_direct` |
| Bank account number | `1640006707220` |
| `RECEIVING_BANK` COA code | `1-1023-CST` |
| `REVENUE` COA code | `4-1017-CST` |
| `TAX_OUTPUT` COA code | `2-1020-CST` |
| `MDR_EXPENSE` COA code | `5-3050-CST` |
| Currency / MDR | `IDR` / `0.003` |
| Fixed fee / fee tax | `0` / `0` |
| Settlement delay | `1` business day |
| Tax rule | `11%`, direction `output` |

The DEV-only canonical finance stage resolves the company bank account and
each COA from those local natural keys, then updates the existing effective
payment and role rows atomically. It never uses a PROD numeric ID. The
stage marker completed at version `9`.

The read-only CF-SC-13B rerun returned:

```text
DEV resolver rows             = 1
DEV certified baseline        = PASS
PROD certified baseline       = PASS
DEV/PROD semantic parity      = PASS
read-only transactions        = true
```

The complete wrapper remains nonzero only because the existing historical
canonical-link check reports `50 invalid canonical settlement FK reference(s)`.
That historical repair is outside this baseline task; no settlement, bank,
journal, processor, or production configuration write was issued by the audit.

### Function parity and contract classification

Required public signatures, security-definer status, volatility, and normalized
search paths are present in PROD. The remaining body differences are:

- `create_payment_settlement_supplemental_batch` uses typed integer joins in
  PROD where DEV uses equivalent text casts. The read-only comparison found no
  semantic difference.
- PROD exposes the public
  `create_payment_accounting_draft(integer)` as a thin wrapper around the live
  `create_payment_accounting_draft_owner(integer, integer)`. The owner body
  preserves the DEV idempotency, confirmed-payment, finance-mode, resolver,
  balance, and draft-line behavior. It differs only by using an explicit
  recovery argument instead of reading the transaction setting, and by a
  typed integer comparison.

These are runtime implementation variants, not signature failures. The owner
routine is nevertheless not represented as an independently certified DEV
baseline in the current source, so the function gate remains `REVIEW` until
the DEV semantic baseline and owner provenance are resolved. No finance
function was called.

### Historical canonical-link classification

The exact PROD settlement audit found 64 batches, of which 51 have a non-null
canonical link. All 51 links are:

```text
status              = reconciled
settlement date     = 2026-06-01 through 2026-09-03
gross total         = IDR 37,370,000.00
net total            = IDR 37,108,410.00
sport_center target = absent for all 51
public target       = present for all 51
active items        = present on every batch
```

The live constraint target is explicitly `public.bank_mutations`, but it is
`NOT VALID`; the legacy Sport Center lookup used by the first audit therefore
reported 51 apparent orphans. These are public-bank links in a historical
identity space, not missing mutations. They must not be nulled, relinked, or
reconstructed from amount/date coincidence. Any future repair must use the
public mutation contract and independently validate every active settlement
item, payment journal owner, company/account identity, and settlement economics
in one governed transaction.

This historical identity mismatch blocks a clean historical-compatibility
claim. It also prevents treating the canonical FK/index gate as a simple
additive repair.

### Foundation and index classification

- All shared finance foundation columns required by the Sport Center contract
  exist in PROD.
- `product_scope` and `service_scope` remain customer-portal-only DEV
  extensions; `comparison_class` and `comparison_evidence` remain DEV-fixture
  fields; PROD `config_version` remains an allowed extension.
- PROD processing uniqueness for `(source_project, source_payment_id,
  event_type)` and `correlation_id`, plus the ready/claim index, is present.
- PROD configuration identity indexes use the live version-based contract,
  while DEV uses effective-date/scope-aware indexes. The difference is not
  promoted because DEV’s semantic baseline is currently invalid and the
  historical public-link boundary is unresolved.
- PROD has the canonical settlement unique index and public-bank foreign-key
  shape, but the canonical FK is not validated against the historical rows.

### Startup, readiness, and quality gates

The PROD read-only marker audit shows both relevant stages completed:

```text
sport_center                         = completed / version 1
sport_center_canonical_finance_config = completed / version 8
failed relevant stages               = 0
```

After the source/build verification, the development API workflow restarted
cleanly. `GET /api/health/ready` returned HTTP 200 with:

```text
ready                  = true
customer_portal_ready  = true
sport_center_ready     = true
failed_stage            = null
```

The production HTTP readiness endpoint was not started or invoked as part of
this read-only certification; database marker/readiness evidence is therefore
not upgraded into a production HTTP readiness claim.

```text
workspace typecheck             = PASS
API typecheck                   = PASS (included in workspace typecheck)
API build                       = PASS
focused contract/regression    = 23/23 PASS
pooler regression               = PASS
git diff --check                = PASS
```

### Final live continuation verdict

```text
CF-SC-13                         = BLOCKED
FOUNDATION COLUMN PARITY         = PASS (classified extensions excluded)
PROCESSING CONTRACT              = PASS
PROD CONFIG PARITY               = PASS
DEV CERTIFIED BASELINE           = PASS
FUNCTION SIGNATURE PARITY        = PASS
FUNCTION CONTRACT PARITY         = REVIEW
SETTLEMENT FK/UNIQUE GATE        = BLOCKED (51 historical public-link rows)
MUTATION CONTRACT                = PASS for public identity columns/index
HISTORICAL COMPATIBILITY         = BLOCKED
STARTUP MARKERS                  = PASS
DEV READINESS                    = PASS
PROD HTTP READINESS              = NOT RUN
PROD MODE                        = legacy
PROD SHADOW                      = NO
PROD CENTRAL                     = NO
PROD CUTOVER                     = NO
PROD PROCESSOR RUNS              = 0
PROD BUSINESS EFFECTS            = 0
READY FOR SHADOW ASSESSMENT      = NO (historical canonical-link blocker)
```

Required owner decisions before a retry:

1. certify/correct the DEV role-to-COA and bank-account baseline without
   copying numeric IDs across environments;
2. certify the PROD public-bank canonical-link ownership boundary and provide
   a governed historical repair plan for the 51 reconciled batches; and
3. certify the PROD accounting-owner routine provenance if exact source parity
   is required.

Until those decisions are complete, no additive PROD constraint promotion,
historical link rewrite, shadow enablement, central-mode change, or processor
execution is authorized by this report.
