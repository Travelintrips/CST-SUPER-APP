# CF-SC-14A — Sport Center PROD Shadow Certification

**Date:** 2026-08-22  
**Scope:** controlled shadow certification only  
**Required safety:** legacy remains the financial owner; no central cutover

## Final verdict

```text
CF-SC-14A = BLOCKED — DEV LIVE PROOF ENVIRONMENT CREDENTIAL UNAVAILABLE
SHADOW ACTIVATED = NO
READY FOR CONTROLLED CENTRAL CUTOVER = NO
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

The remaining certification blocker is execution of the live DEV proof matrix:
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

The live rerun could not reach the DEV database because the managed secret
loader reported that `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` is unavailable in
this workspace. No PROD configuration or data was changed.

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
| DEV live shadow certification | BLOCKED — DEV Secret Manager bootstrap unavailable |
| Production readiness in legacy mode | PASS |

## Required next step

Run the DEV fixture certification with an explicit
`SPORT_CENTER_FINANCE_MODE=shadow`, then return DEV to `legacy`. The observer
supports an activation timestamp and defaults to skipping historical events
when that timestamp is configured; no historical PROD backfill is enabled.

After that implementation is independently verified:

1. keep PROD in `legacy`;
2. run the observer contract and zero-effect tests;
3. capture a fresh read-only baseline;
4. activate shadow only through the official production configuration;
5. observe real events for a bounded window;
6. return to legacy unless operational approval explicitly permits keeping
   shadow enabled.

Central mode and cutover remain prohibited by this phase.