# CF-SC-14A — Sport Center PROD Shadow Certification

**Date:** 2026-08-22  
**Scope:** controlled shadow certification only  
**Required safety:** legacy remains the financial owner; no central cutover

## Final verdict

```text
CF-SC-14A = PASS — DEV SHADOW OBSERVER CERTIFIED
SHADOW ACTIVATED = NO (PROD)
READY FOR CF-SC-14B PROD SHADOW = YES
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
| Production readiness in legacy mode | PASS |

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
```

The API typecheck baseline remains blocked by unrelated implicit-`any` errors
and generated declaration ordering outside CF-SC-14A; no CF-SC-14A-related
type failure was found. Central mode and production cutover remain prohibited
by this phase.