# CF-SC-10 — Central Finance Shared Config Runtime Adoption

## Scope and safety

This gate is development-only. The runtime mode is selected with
`SPORT_CENTER_FINANCE_MODE=central`; the default remains legacy. No production
database, finance mode, legacy table, trigger, Paylabs call, or WhatsApp send is
modified by this change.

## Old config read graph

Before CF-SC-10, the Sport Center payment owner read:

```text
sport_center.sport_payments
  -> sport_center.payment_settlement_configs
  -> public.company_bank_accounts
  -> sport_center.coa_accounts / booking tax snapshot
  -> sport_center.accounting_journals + journal_lines
  -> sport_center.payment_settlement_batches
```

The payment journal function also carried literal labels/codes for the bank,
revenue, and PPN accounts. Settlement ownership and mirror/replay functions
used the Sport Center settlement configuration directly.

## New config read graph

Central mode installs one database-owned resolver and exposes the same contract
to TypeScript:

```text
project + company + method + provider + effective date
  -> public.finance_project_configs
  -> public.finance_project_payment_configs
  -> public.finance_project_tax_mappings -> public.tax_rules
  -> public.finance_project_coa_mappings -> public.chart_of_accounts
  -> public.company_bank_accounts
  -> payment accounting / tax / public mutation / settlement
```

The pool sets the session-local `sport_center.finance_mode` setting from the
environment. Legacy and shadow callers do not opt into the shared resolver.

## Shared config resolver contract

`resolveFinanceProjectConfig({ projectCode, companyId, paymentMethod,
providerCode, effectiveDate })` resolves exact, active, effective rows only.
It returns the effective configuration identity, canonical bank account and
currency, settlement delay, MDR/fixed/fee-tax values, tax identity/rate, and
role-keyed COA IDs/codes/names. Missing, duplicate, inactive, expired, or
mismatched rows raise a deterministic `BLOCKED_CONFIG_*` error.

No first-row, `MIN(id)`, fuzzy company/provider, or legacy fallback is used.
Clearing is optional and is absent in the verified Sport Center configuration.

## Verified positive configuration

| Field | Development result |
|---|---:|
| Project/company | `sport_center / 1` |
| Payment/provider | `QRIS / mandiri_direct` |
| Tax rule | `8` |
| RECEIVING_BANK | `75594` (`1-1023-CST`) |
| REVENUE | `72354` (`4-1017-CST`) |
| TAX_OUTPUT | `49109` (`2-1020-CST`) |
| MDR_EXPENSE | `75590` (`5-3050-CST`) |
| Clearing | optional / null |
| Currency | `IDR` |
| Settlement delay | `1` business day |
| MDR rate | `0.003` |
| Fixed provider fee | `0` |
| Fee tax rate | `0` |

## Remaining legacy dependencies

The existing Sport Center settlement owner remains the transition adapter for
the settlement batch calculation and historical mirror/recovery contracts.
This preserves the already-verified idempotency, concurrency, and trigger
ownership boundary; it is not a second accounting engine and it does not seed
or overwrite legacy configuration. The shared resolver is still required and
validated before central accounting proceeds.

Transfer Bank and Paylabs have no canonical shared configuration and are not
seeded by this gate.

## Negative configuration matrix

| Input | Expected result | Financial effects |
|---|---|---:|
| QRIS + unknown provider | `BLOCKED_CONFIG_MISSING` | 0 |
| Transfer Bank | `BLOCKED_CONFIG_MISSING` | 0 |
| Paylabs | `BLOCKED_CONFIG_MISSING` | 0 |

## Idempotency, concurrency, and rollback

The existing payment advisory lock, unique source identity, canonical
settlement group lock, and two-independent-client concurrency harness remain
unchanged. Retries therefore retain the existing single processing effect,
single accounting effect, single public mutation, and single settlement batch
invariant. CF-SC-10 adds no event-table migration.

Runtime proof fixtures must use the existing rollback-only harness. No fixture
data is retained by this gate.

## Quality gates

- `pnpm run typecheck` — PASS
- API build — PASS
- `git diff --check` — PASS
- Development resolver installation and positive resolution — PASS
- Unknown-provider fail-closed resolution — PASS

Full payment-shape and concurrency proofs remain the responsibility of the
existing central-finance runtime harness; this change does not create or seed
Transfer Bank/Paylabs fixtures.

## CF-SC-10B execution result — 2026-08-21

The development-only rollback harness now runs through the existing `esbuild`
runner; no `tsx` dependency was installed. The harness also verifies that the
database-owned canonical handoff function is present before any fixture write.

The QRIS full-payment smoke passed end to end:

- `payment_accounting_outbox`: claimed `1`, transitioned to `posted`
- `central_finance_processing`: `pending → processing → posted`
- shared config: project `2`, payment config `2`, tax rule `8`
- COA roles: receiving bank `75594`, revenue `72354`, tax output `49109`, MDR expense `75590`
- MDR/currency: `0.003` / `IDR`
- canonical accounting journal: posted and balanced (`100000.00` debit;
  `90090.09` revenue credit; `9909.91` tax credit)
- settlement batch: `33`, posted, one item
- public mutation: `21`, linked through `canonical_bank_mutation_id`
- canonical mutation identity: `SC-PAY-<fixture_payment_id>` /
  `sport_center:payment:<fixture_payment_id>`
- legacy `bank_mutation_id`: `NULL`
- rollback proof: passed; fixture rows were absent from a separate connection
- existing DEV outbox/processing identities changed: `0`
- production writes: `0`

The targeted processor/boundary/canonical-settlement tests passed (`14/14`),
workspace and API typecheck passed, API build passed, and `git diff --check`
passed. A dedicated `TEST_DATABASE_URL` is now available for suites that
require an isolated runtime database; the CF-SC-10B harness itself continues
to use only the explicitly guarded development Supabase target.

This execution proves the QRIS full-payment path and canonical settlement/public
mutation handoff. It does not claim the larger optional-provider, configuration
corruption, multi-client race, or DP/pelunasan matrix unless those cases are
run separately. No production writes, production migrations, Paylabs calls,
WhatsApp sends, or legacy cleanup were performed.

## Mutation ownership and bridge contract

`public.bank_mutations` is the canonical public mutation owner for the Central
Finance payment handoff. A central settlement creates exactly one deterministic
public evidence row using:

```text
mutation_key = SC-PAY:<payment_id>
canonical_key = sport_center:payment:<payment_id>
source_account = sport_center.payment_settlement_batches:<settlement_batch_id>
```

The `sport_center.bank_mutations` row with
`source = PUBLIC_BANK_MUTATION_BRIDGE` is an approved canonical bridge
representation of that public owner. It is not the retired legacy
booking/accounting producer. Provenance must classify these rows separately:

| Classification | Required result |
|---|---:|
| Public canonical mutation | one per canonical payment |
| Sport Center canonical bridge row | only the verified bridge representation |
| Legacy booking mutation | `0` |
| Other unexpected Sport Center mutation | `0` |

Bridge resolution uses the exact settlement identity carried by
`public.bank_mutations.source_account`, then validates company, date, amount,
posted settlement journal, and owner-approved provider/account configuration.
Company/date/amount are evidence attributes, not uniqueness identities. A
missing or ambiguous exact settlement scope fails closed.

## CF-SC-10C execution result — 2026-08-21

The development-only rollback matrix passed after restoring and verifying the
latest canonical owner routine in the development database. The prior DP
failure was caused by a stale live bridge function that did not yet apply the
exact `source_account` settlement scope; no assertion was weakened.

| Case | Result | Processing | Accounting | Settlement | Public mutation | SC bridge | Legacy |
|---|---|---:|---:|---:|---:|---:|---:|
| QRIS full | PASS | 1 | 1 | 1 | 1 | 1 | 0 |
| QRIS DP | PASS | 1 | 1 | 1 | 1 | 1 | 0 |
| QRIS pelunasan | PASS | 1 | 1 | 1 | 1 | 1 | 0 |
| Group payment | PASS | 1 | 1 | 1 | 1 | 1 | 0 |

Transfer Bank, Paylabs, and unknown provider were each claimed but remained
manual review with zero accounting, settlement, or mutation effects. The
supplemental settlement fallback and savepoint rollback path are retained in
the processor owner and the CF-SC run completed atomically. The harness rolled
back all fixtures and reported zero production writes. Development readiness
was `200`, all 119 startup stages were complete, and the latest bridge function
was verified in the live DEV catalog before the harness ran.

## CF-SC-10D execution result — 2026-08-21

The development-only CF-SC-10D harness passed end to end using the guarded
development Supabase target. The fixture effective date was taken from the
actual processor-effective payment date; settlement evidence used the
configured MDR calculation (`0.003` of gross, rounded to two decimals).

### Fail-closed corruption matrix

| Corruption case | Candidate count | Processor result | Financial effects |
|---|---:|---|---:|
| Duplicate project config | 2 | `manual_review` / `BLOCKED_CONFIG_AMBIGUOUS` | 0 |
| Duplicate payment config | 2 | `manual_review` / `BLOCKED_CONFIG_AMBIGUOUS` | 0 |
| Missing tax mapping | 0 | `manual_review` | 0 |
| Missing `RECEIVING_BANK` | 0 | `manual_review` | 0 |
| Missing `REVENUE` | 0 | `manual_review` | 0 |
| Missing `TAX_OUTPUT` | 0 | `manual_review` | 0 |
| Missing `MDR_EXPENSE` | 0 | `manual_review` | 0 |

Every case used a savepoint and verified that accounting, settlement, public
mutation, and bridge effects returned to zero after rollback. Duplicate
configuration cases also probed the resolver and confirmed ambiguity was
rejected rather than resolved by first-row selection.

### Two-client race and lifecycle cleanup

The same-payment race and the DP + pelunasan race used two independent
PostgreSQL clients with a short launch offset. Both races passed with one
processing owner per payment, one posted accounting journal, one settlement
item/batch, one public mutation, and one canonical bridge per fixture payment.
The second client did not create duplicate claims or duplicate financial
effects. Cleanup captures fixture settlement IDs before deleting items, then
removes only those fixture-owned batches.

The harness compared before/after snapshots of existing development outbox,
processing, accounting, public mutation, and settlement identities. Existing
DEV identities were unchanged, and fixture cleanup returned zero for
processing, outbox, accounting, journal lines, settlement items, settlement
batches, public mutations, bridges, and bookings.

### Certification boundary

CF-SC-10D proves the central QRIS runtime contract, fail-closed configuration
behavior, canonical mutation bridge, concurrency ownership, and rollback
cleanup in development. It does not enable central mode in production, write
or migrate production data, perform cutover, activate Paylabs or WhatsApp, or
remove legacy data. Production remains `SPORT_CENTER_FINANCE_MODE=legacy`.
The development-only corruption and concurrency proof passed end to end after
restoring the live canonical owner routines and correcting the runtime foreign
key to reference `sport_center.bank_mutations(id)` explicitly. The previous
constraint resolved `bank_mutations` to `public.bank_mutations`, while the
owner routine correctly produced a Sport Center canonical ID.

| Proof | Result |
|---|---|
| Duplicate/missing shared-config corruption matrix | PASS; manual review, no new processor effects |
| Same-payment two-client race | PASS; one client posted, the other skipped |
| DP + pelunasan two-client race | PASS; one effect per payment |
| Settlement/public/canonical identity checks | PASS |
| Existing DEV snapshot after cleanup | PASS; unchanged |
| Production writes/migrations/cutover | `0` / `0` / `NO` |

The race harness passes fixture payment IDs explicitly through processing-row
backfill and claim selection, so a targeted proof cannot touch unrelated DEV
outbox rows. Cleanup captures exact settlement batch IDs from fixture items
before removing those items rather than using a broad settlement prefix.

The 10D run verified one processing row, outbox, accounting journal, settlement
item, settlement batch, public mutation, and canonical bridge row per payment
for full payment, DP, pelunasan, and grouped payment, with zero legacy
mutation rows. CF-SC-10C was rerun afterward and passed with the same counts.
No production writes, production migrations, Paylabs calls, WhatsApp sends, or
legacy cleanup were performed.
