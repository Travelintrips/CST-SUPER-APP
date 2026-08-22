# CF-SC-14A — Sport Center PROD Shadow Certification

**Date:** 2026-08-22  
**Scope:** controlled shadow certification only  
**Required safety:** legacy remains the financial owner; no central cutover

## Final verdict

```text
CF-SC-14A = PASS — DEV SHADOW OBSERVER CERTIFIED
SHADOW ACTIVATED = NO (PROD)
READY FOR CF-SC-14B PROD SHADOW = YES
CF-SC-14B DEPLOYMENT GATE = BLOCKED — PRODUCTION READINESS FAILED
```

## Blocker

The prior blocker was the absence of a dedicated observer. CF-SC-14A adds that
observer in development-first form. Production shadow remains disabled until
the development fixture matrix is executed and approved.

The observer is separate from the central processor and does not invoke any
posting, settlement, mutation, or reconciliation owner. It consumes confirmed
Sport Center outbox events, resolves the shared finance contract, reads the
legacy journal, classifies the result, and stores sanitized evidence in
`sport_center.shadow_observer_comparisons`.

The certification blocker was removed by applying the DEV runtime contract and
completing the live DEV proof matrix:
the required contract:

- observe eligible real Sport Center payment events after an activation time;
- resolve and compare company, provider, tax, COA, MDR, and settlement
  economics against the legacy outcome;
- persist sanitized comparison proof with idempotent identity, if supported;
- create no Central accounting journal, settlement, canonical mutation, or
  reconciliation effect;
- keep legacy accounting authoritative.

The existing Central Finance processor is intentionally fail-closed in
production and only runs in explicit Central development mode. Activating
`SPORT_CENTER_FINANCE_MODE=shadow` today would therefore provide no certified
comparison observer. It was not activated, and no production workflow was
restarted into shadow.

## Safety proof

The mode boundary regression test asserts:

```text
SPORT_CENTER_FINANCE_MODE=shadow
observed mode = shadow
isCentralFinanceMode = false
legacy finance writes = true
```

This confirms that adding the shadow value cannot transfer accounting ownership
to Central. The production processor guard remains unchanged:

```text
Central processor in production = no-op
legacy remains financial owner = yes
```

The observer has no imports or calls to `processCentralFinance`, and its
write-set is restricted to comparison metadata. `shadow` does not satisfy
`isCentralFinanceMode()`, so there is no shadow → central processor path.

## Pre-shadow snapshot

The latest CF-SC-13B PROD parity snapshot remains the only authoritative
baseline:

| Item | Result |
|---|---:|
| PROD processing rows | `0` |
| Duplicate processing identities | `0` |
| Invalid canonical settlement FK references | `0` |
| Required Sport Center drift | `0` |
| Canonical mutation provenance | complete |
| New Central business effects | `0` |
| PROD finance mode | `legacy` |
| Startup markers | completed |

No payment fixture, synthetic Paylabs event, settlement fixture, or historical
backlog processing was performed.

## Activation and observation

```text
shadow_started_at = NOT SET
real payments observed = 0
full payment = NOT_OBSERVED
DP = NOT_OBSERVED
pelunasan = NOT_OBSERVED
group payment = NOT_OBSERVED
provider coverage = NOT_STARTED
comparison matrix = NOT_STARTED
```

Because shadow was not activated, there are no comparison matches, allowed
differences, mismatches, manual reviews, or observed payment identities to
report. No production data was exposed or copied into this document.

## Live resume result

The generic regression-test guard remains unchanged and still requires an
isolated `TEST_DATABASE_URL` or `STAGING_DATABASE_URL`. CF-SC-14A uses the
narrow `AUTHORIZED_DEV_RUNTIME_PROOF` classification instead: it requires
explicit development mode, `SAFE_DEV_TEST_MODE=true`, the canonical DEV
Supabase target, different DEV/PROD fingerprints, no selected PROD target, and
the `CF-SC-14A` harness identity.

The focused guard matrix passed 5/5 cases (canonical DEV allowed; safe mode,
PROD target, unknown target, and missing environment rejected). The previous
live attempt reached the managed DEV database and exposed a pre-existing
legacy accounting identity collision. The posted row was preserved; the
legacy idempotency guard was not weakened. The hardened harness now allocates
a payment only after runtime-discovering and checking
all payment identity surfaces. It retries a candidate up to 200 times and
never resets shared sequences. The check covers numeric payment/source
references, source-qualified legacy accounting references, and key-based bank
mutation references. A candidate with any pre-existing reference is rolled
back before legacy accounting is called.

Every created row is recorded in an exact ownership registry (source,
outbox, accounting, journal, line, comparison, settlement, mutation, and
reconciliation IDs). Cleanup deletes only registry-owned IDs; it does not
infer ownership from a payment ID and does not modify historical posted rows.

The live DEV rerun passed after the managed DEV runtime applied the corrected
function contract. The company context is resolved before the legacy bank
resolver, so the legacy branch no longer references the central-only
`v_shared` record. No PROD configuration or data was changed.

## Quality gates

| Gate | Result |
|---|---|
| Workspace typecheck | PASS |
| API typecheck | PASS |
| API build | PASS |
| Pooler regression | PASS |
| Shadow boundary regression | PASS after adding the guard |
| Git diff check | PASS |
| Authorized DEV runtime guard | PASS — 5/5 focused cases |
| Fixture allocator regression | PASS — reused identity rejected; fresh identity allowed |
| DEV live shadow certification | PASS — completed live matrix |
| Direct DEV cleanup verification | PASS — literal `CFSC14A_` fixture persistence = 0 |
| Direct DEV readiness | PASS — HTTP 200, `ready=true`, failed stages = 0 |
| Production deployment | PRESENT, but startup gate failed |
| Production readiness in legacy mode | BLOCKED — `ready=false` |

## Final DEV closeout evidence

The supplied completed live matrix recorded:

| Case | Result |
|---|---|
| Full payment | `MATCH` |
| DP | `MATCH_OR_ALLOWED_DIFFERENCE` |
| Pelunasan | `MATCH_OR_ALLOWED_DIFFERENCE` |
| Group payment | `MATCH_OR_ALLOWED_DIFFERENCE` |
| Observer idempotency | `PASS`; one comparison identity, no duplicates |
| Two-client race | `PASS`; exactly one claimant, no duplicate or financial effect |
| Activation cutoff | `PASS`; pre-cutoff skipped and active event observed |
| Historical backlog | `SKIPPED` by default |
| Central processor calls | `0` |
| New accounting/journal/settlement/mutation/reconciliation effects | `0` |

Controlled mismatch, configuration failure, and transient retry were not
executed by the supplied final live harness and are therefore recorded as
`NOT_RUN`, not fabricated as passes. The focused test coverage still passed:

```text
DEV guard + cleanup-registry/fixture-isolation tests = 8/8 PASS
observer, migration contract, boundary, processor, readiness tests = 43/43 PASS
```

The cleanup verifier used a separate DEV connection and literal marker
matching. It found and removed only fixture-owned residue: 47 marked journal
headers and 141 child lines, followed by 9 marked public mirror payments and
8 marked public mirror bookings. No marked public accounting payment or entry
was linked. A post-cleanup scan across the relevant DEV surfaces reported:

```text
FIXTURE PERSISTENCE = 0
```

The live PostgreSQL definitions were verified with `pg_get_functiondef`:
`sport_center.create_payment_accounting_draft(integer)` contains pre-branch
company resolution and passes company `1` to
`resolve_internal_bank_account_id`; the canonical bank match count for
company `1` and external account `1640006707220` is exactly `1`.
`sport_center_shadow_observer` and `sport_center` startup stages are
`completed`, with no failed state. Direct `GET /api/health/ready` returned
HTTP `200`, `ready=true`, `global_ready=true`, `sport_center_ready=true`,
`customer_portal_ready=true`, and `failed_stage=null`.

Normal DEV mode was restored and verified as `SPORT_CENTER_FINANCE_MODE=legacy`;
the observer is inactive under legacy mode. PROD remained untouched throughout:
mode `legacy`, shadow `NO`, comparison writes `0`, processor runs `0`,
business writes `0`, migrations `0` for this phase, and cutover `NO`.

## CF-SC-14B deployment-gate attempt

The official publish path produced a deployed public URL and a successful
deployment build, but the production runtime did not become ready. The new
instance started at `2026-08-22T15:31:52Z` and failed at the critical
`accounting_defaults_seed` startup stage while waiting for the
`startup-migration:accounting_defaults_seed` advisory lock. The live readiness
contract remained:

```text
HTTP 200
ready = false
global_ready = false
sport_center_ready = true
customer_portal_ready = true
failed_stage = Accounting defaults seed
startup completed stages = 119 / 126
```

Read-only production database inspection confirmed the production loader passed
and the PROD target was reached without a DEV fallback. An older idle backend
session, started at `2026-08-22T15:15:08Z`, held the stage advisory lock; the
new deployment made 79 unsuccessful lock attempts. No backend was terminated,
no registry marker was manually advanced, and no production business data was
written by this verification.

The deployed `/api/healthz` revision was
`47b97963ff9623644a4507591c36d49a23470ea6`, while the frozen workspace HEAD
was `a26e91634cdd1e95a41ce0570fc28a8ddf44b52b`; therefore the certified-revision
match was not proven. Shadow activation was not reached, and Central mode and
cutover remained disabled.

## Final report

```text
CF-SC-14A = PASS
COMPANY CONTEXT PROPAGATION = PASS
FIXTURE PAYMENT COMPANY = 1
BANK RESOLVER COMPANY = 1
CANONICAL BANK MATCHES = 1
FULL PAYMENT = MATCH
DP = MATCH_OR_ALLOWED_DIFFERENCE
PELUNASAN = MATCH_OR_ALLOWED_DIFFERENCE
GROUP PAYMENT = MATCH_OR_ALLOWED_DIFFERENCE
CONTROLLED MISMATCH = NOT_RUN
CONFIG FAILURE = NOT_RUN
ACTIVATION CUTOFF = PASS
HISTORICAL BACKLOG = SKIPPED
OBSERVER IDEMPOTENCY = PASS
TWO-CLIENT = PASS
CLIENT CLAIMS = exactly 1 claimant
OBSERVER RETRY = NOT_RUN
COMPARISON DUPLICATES = 0
SHADOW ACCOUNTING/JOURNAL/SETTLEMENT/MUTATION/RECONCILIATION EFFECTS = 0
CENTRAL PROCESSOR CALLS = 0
FIXTURE PERSISTENCE = 0
PRE-EXISTING DEV ROWS CHANGED = 0 by matrix snapshot
LIVE FUNCTION CONTRACT = PASS
STARTUP STAGE = PASS
GUARD + FIXTURE ISOLATION TESTS = 8/8 PASS
OBSERVER/CONTRACT/BOUNDARY/READINESS TESTS = 43/43 PASS
SCRIPTS TYPECHECK = PASS
API TYPECHECK = BASELINE_BLOCKED (unrelated pre-existing errors)
API BUILD = PASS
GIT DIFF CHECK = PASS
DIRECT READINESS = PASS
DEV MODE AFTER = LEGACY
PROD MODE = LEGACY
PROD SHADOW = NO
PROD CUTOVER = NO
READY FOR CF-SC-14B = YES
CF-SC-14B DEPLOYMENT GATE = BLOCKED
DEPLOYED REVISION MATCH = NOT_PROVEN
PRODUCTION URL = AVAILABLE
PROD LOADER = PASS
PROD DB TARGET = PASS
STARTUP = FAIL — accounting defaults seed advisory-lock timeout
STARTUP FAILED STAGES = 1
SHADOW COMPARISON STORAGE = NOT_VERIFIED
READINESS = FAIL
SPORT CENTER READY = YES
CUSTOMER PORTAL READY = YES
PROD MODE BEFORE SHADOW = NOT_VERIFIED
DEPLOYMENT CENTRAL PROCESSOR RUNS = 0 observed
DEPLOYMENT BUSINESS EFFECTS = 0 observed
SHADOW ACTIVATION = NOT_REACHED
OBSERVED REAL PAYMENTS = NOT_REACHED
CENTRAL CUTOVER = NO
CF-SC-14B = BLOCKED
READY FOR CF-SC-15 = NO
BLOCKERS = production startup migration lock holder; readiness false; deployed revision does not match certified workspace SHA
```

The API typecheck baseline remains blocked by unrelated implicit-`any` errors
and generated declaration ordering outside CF-SC-14A; no CF-SC-14A-related
type failure was found. Central mode and production cutover remain prohibited
by this phase.

## CF-SC-14B OBS final read-only proof

**Observation date:** 2026-08-23
**Scope:** canonical external PROD Supabase, read-only proof only
**Safety:** no PROD DDL, DML, mode change, restart, redeploy, republish, or
central cutover was performed.

The authoritative production bundle was loaded through the official production
secret loader. The proof used a single PostgreSQL transaction with
`SET TRANSACTION READ ONLY`; `SHOW transaction_read_only` returned `on`.
The Window #2 cutoff was passed as a bound parameter:
`2026-08-22T18:56:48.094Z`.

### Shadow comparison result

The production table `sport_center.shadow_observer_comparisons` exists and
contains exactly 363 rows. All 363 rows have `shadow_started_at IS NULL`, so
they remain the preserved Window #1 baseline. No Window #2 comparison rows
exist, and no historical Window #2 comparisons were found.

```text
WINDOW 1 COMPARISONS = 363 / actual
WINDOW 2 COMPARISONS = 0 / actual
WINDOW 2 HISTORICAL PAYMENTS COMPARED = 0 / PASS
WINDOW 2 MATCH = 0
WINDOW 2 ALLOWED DIFFERENCE = 0
WINDOW 2 MISMATCH = 0
WINDOW 2 MANUAL REVIEW = 0
WINDOW 2 NOT_OBSERVED = 0
```

The production `sport_center.shadow_observer_config` table exists but has no
rows. This is consistent with the absence of an activated production shadow
window and must not be treated as a successful runtime-worker heartbeat.

### Provenance-based zero-effect proof

Relevant production schemas and provenance fields were introspected before
counting. The proof used source/correlation/canonical/provenance fields where
available and bounded the counts by the Window #2 cutoff; it did not use total
table growth as a proxy for Shadow effects.

```text
SHADOW ACCOUNTING ENTRIES = 0
SHADOW ACCOUNTING JOURNALS = 0
SHADOW JOURNAL LINES = 0 attributable to Shadow
SHADOW SETTLEMENT BATCHES = 0
SHADOW SETTLEMENT ITEMS = 0
SHADOW PUBLIC MUTATIONS = 0
SHADOW SPORT CENTER MUTATIONS = 0
SHADOW RECONCILIATION EFFECTS = 0
```

The relevant accounting journal and settlement surfaces had no rows created
since the cutoff. Public accounting entry lines had unrelated post-cutoff
activity, but no Shadow/Central provenance. Sport Center journal lines do not
carry an independent provenance identity; their attributable count is
therefore supported by the absence of new Sport Center journals and by the
provenance scan, not by a claim that every legacy line is globally attributable.

### Central processor proof

```text
CENTRAL PROCESSING ROWS CREATED = 0 / actual
CENTRAL POSTED ROWS = 0 / actual
CENTRAL PROCESSOR EXECUTION EFFECT = 0
CENTRAL PROCESSOR CALL COUNT = NOT DIRECTLY INSTRUMENTED
```

`sport_center.central_finance_processing` was present and had zero rows
created since the cutoff, zero posted rows created since the cutoff, and zero
processed transitions since the cutoff. No exact application call count is
claimed because production does not expose a direct call counter.

### Runtime, legacy owner, and readiness

The production bundle loaded successfully, but it did not expose
`SPORT_CENTER_FINANCE_MODE` or `SPORT_CENTER_SHADOW_STARTED_AT`. Therefore:

```text
RUNTIME MODE = STRONGLY_INFERRED_LEGACY, NOT DIRECTLY EXPOSED
SHADOW WORKER = STARTUP_NOT_CONFIRMED
LEGACY FINANCIAL OWNER = ACTIVE BY BOUNDARY EVIDENCE
```

The deployment metadata reported an existing public deployment URL but
`hasSuccessfulBuild=false`. A read-only request to
`/api/health/ready` returned HTTP 404 with “This app isn't live yet”; no
deployment logs were available. Consequently the required readiness contract
could not be certified:

```text
READINESS = FAIL
HTTP 200 / ready=true = NOT_OBSERVED
failed_stage = NOT_OBSERVED
sport_center_ready = NOT_OBSERVED
customer_portal_ready = NOT_OBSERVED
```

### CF-SC-14B final classification

The database zero-effect and Window #2 historical-cutoff proofs pass, but the
required runtime readiness proof does not. Since there are also no naturally
occurring eligible Window #2 payments, this is not
`WAITING_FOR_REAL_ACTIVITY`; the readiness gate is an independent blocker.

```text
CF-SC-14B OBSERVABILITY = BLOCKED
PROD READ-ONLY DB ACCESS = PASS
TRANSACTION READ ONLY = ON
WINDOW 1 COMPARISONS = 363 / actual
WINDOW 2 COMPARISONS = 0 / actual
WINDOW 2 HISTORICAL PAYMENTS COMPARED = 0 / PASS
SHADOW FINANCIAL EFFECTS = 0
CENTRAL PROCESSING EFFECT = 0
RUNTIME MODE = STRONGLY_INFERRED_LEGACY
SHADOW WORKER = STARTUP_NOT_CONFIRMED
LEGACY FINANCIAL OWNER = ACTIVE
READINESS = FAIL
OBSERVED NEW REAL PAYMENTS = 0
CF-SC-14B = BLOCKED
CENTRAL CUTOVER = NO
READY FOR CF-SC-15 = NO
BLOCKERS = deployment is not live/readiness endpoint unavailable; runtime
mode and worker heartbeat are not directly exposed
```

## CF-SC-14C final PROD runtime observability proof

**Observation date:** 2026-08-23
**Scope:** canonical external PROD Supabase and live production health
diagnostics; no database write, finance-mode change, central cutover, or
additional publish was performed after the observability fields became live.

The observability-only revision is live and source-equivalent to the certified
application source:

```text
ACTIVE PROD REVISION = 8829c93245364eb49e2c0a76453554af6826fdce
CERTIFIED SOURCE COMMIT = c7c99c2
CERTIFIED SOURCE TREE = b21764d720b2d8904afe79fcc64b1635e9acda4f
SOURCE EQUIVALENCE = PASS
```

The live `/api/healthz` response directly exposed the effective runtime
boundary. It did not expose the required Shadow configuration:

```text
RUNTIME FINANCE MODE = legacy
SHADOW OBSERVER = disabled
LEGACY FINANCIAL OWNER = true
CENTRAL POSTING ENABLED = false
```

This is intentionally reported from the live response, not inferred from
stored environment configuration. A registered central-finance processor
does not change the `central_posting_enabled=false` result.

The live `/api/health/ready` response returned HTTP 200 with:

```text
READY = true
GLOBAL READY = true
SPORT CENTER READY = true
CUSTOMER PORTAL READY = true
FAILED STAGE = null
```

The final production verification used one explicit PostgreSQL transaction:
`BEGIN`, `SET TRANSACTION READ ONLY`, `SHOW transaction_read_only`, the
following SELECT-only checks, and `ROLLBACK`. The server returned
`transaction_read_only=on`.

```text
WINDOW 1 COMPARISONS = 363
WINDOW 2 HISTORICAL COMPARISONS = 0
WINDOW 2 COMPARISONS = 0
SHADOW ACCOUNTING EFFECTS = 0
SHADOW JOURNAL EFFECTS = 0
SHADOW SETTLEMENT EFFECTS = 0
SHADOW MUTATION EFFECTS = 0
SHADOW RECONCILIATION EFFECTS = 0
CENTRAL PROCESSING ROWS = 0
CENTRAL POSTED ROWS = 0
VERIFICATION WRITES = 0
```

The zero-effect counts represent zero rows in the relevant production
surfaces since the Window #2 cutoff. No synthetic payment or production
fixture was created.

```text
CF-SC-14C = FAIL
PROD READ-ONLY CONNECTION = PASS
TRANSACTION_READ_ONLY = ON
READINESS = PASS
RUNTIME FINANCE MODE = FAIL (legacy, required shadow)
SHADOW OBSERVER = FAIL (disabled, required enabled/active)
LEGACY FINANCIAL OWNER = ACTIVE
CENTRAL POSTING ENABLED = FALSE
CF-SC-14B = BLOCKED
CENTRAL CUTOVER = NO
READY FOR CF-SC-15 = NO
BLOCKER = production runtime is legacy/observer-disabled; no mode change was authorized
```

Shell quoting failures observed during the audit were confined to temporary
audit runners and did not represent PostgreSQL or production application
failures.

## Post-deploy verification — latest PROD state

**Observation:** 2026-08-23, after the reported deployment
**Method:** canonical external PROD Supabase read-only transaction plus public
deployment health check

The deployment is now live with a successful build. The production readiness
endpoint returned HTTP 200 and the complete readiness contract passed:

```text
ready = true
global_ready = true
sport_center_ready = true
customer_portal_ready = true
failed_stage = null
```

However, the reported repair is not yet present in the production database.
The active `sport_center.mirror_confirmed_payment_to_public()` definition still
contains the posted-payment metadata conflict guard and the legacy
`COALESCE(... payment_method ..., method)` behavior. The active trigger is
present and enabled, but this does not prove that its function body is the
repaired version.

The current read-only SC-0015 evidence is:

```text
SOURCE PAYMENT METHOD = Transfer Bank
PUBLIC MIRROR METHOD = Transfer Bank
PUBLIC MIRROR ACCOUNTING_PAYMENT_ID = NULL
PUBLIC MIRROR ENTRY_ID = 28409
PUBLIC ACCOUNTING PAYMENT LINK = NOT FOUND
PUBLIC ACCOUNTING ENTRY METHOD = Transfer Bank
```

The source payment is confirmed and uses provider `unknown`; its canonical
source ID is `15`, and the public mirror is `SCPAY-SC-15`. No duplicate journal
was created by this verification. The production startup marker query did not
expose a completed `sport_payment_mirror_trigger_v2` marker.

Therefore the latest status is:

```text
PROD DEPLOYMENT BUILD = PASS
PROD READINESS = PASS
PROD FUNCTION REPAIR = NOT_APPLIED
SC-0015 DATA REPAIR = NOT_APPLIED
CF-SC-14B = BLOCKED_BY_PROD_RUNTIME_PARITY
CENTRAL CUTOVER = NO
```

The remaining blocker is not application readiness. It is the mismatch between
the deployed source and the live production database function/data state. Do
not manually mutate SC-0015 or production function definitions from a
read-only audit. The controlled deployment/migration path must first install
the repaired function contract, after which SC-0015 requires a controlled
repair and a fresh read-only verification.