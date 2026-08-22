# CF-SC-14 — Sport Center PROD Shadow Certification

**Date:** 2026-08-22  
**Scope:** controlled shadow certification only  
**Required safety:** legacy remains the financial owner; no central cutover

## Final verdict

```text
CF-SC-14 = BLOCKED
SHADOW ACTIVATED = NO
READY FOR CONTROLLED CENTRAL CUTOVER = NO
```

## Blocker

The current runtime has a safe mode boundary for `legacy`, `shadow`, and
`central`, but it does not yet have a production shadow observer satisfying
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

The mode boundary regression test now asserts:

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

## Quality gates

| Gate | Result |
|---|---|
| Workspace typecheck | PASS |
| API typecheck | PASS |
| API build | PASS |
| Pooler regression | PASS |
| Shadow boundary regression | PASS after adding the guard |
| Git diff check | PASS |
| Production shadow observer | BLOCKED — not implemented |
| Production readiness in legacy mode | PASS |

## Required next step

Implement and certify a dedicated shadow observer before any activation. It
must use an activation timestamp, a source-qualified idempotency key, read-only
financial comparison queries, bounded processing, explicit unsupported
provider/type handling, and a proof that its writes cannot reach accounting,
settlement, mutation, or reconciliation owners.

After that implementation is independently verified:

1. keep PROD in `legacy`;
2. run the observer contract and zero-effect tests;
3. capture a fresh read-only baseline;
4. activate shadow only through the official production configuration;
5. observe real events for a bounded window;
6. return to legacy unless operational approval explicitly permits keeping
   shadow enabled.

Central mode and cutover remain prohibited by this phase.