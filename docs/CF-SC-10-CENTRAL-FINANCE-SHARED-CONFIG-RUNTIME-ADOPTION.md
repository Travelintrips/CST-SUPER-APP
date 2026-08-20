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

## CF-SC-10B execution result — 2026-08-20

The processor orchestration contract passed (`4/4` assertions). The actual
development-only processor smoke also passed its durable-event and accounting
portion:

- `payment_accounting_outbox`: claimed `1`, transitioned to `posted`
- `central_finance_processing`: `pending → processing → posted`
- canonical accounting owner: reached successfully
- journal: balanced (`100000.00` debit; `90090.09` revenue credit; `9909.91` tax credit)
- DEV rollback proof: passed; the `CF-SC-10B` fixture marker count returned to `0`

The full CF-SC-10B gate remains **FAIL / blocked**, not PASS. The observed
processor path did not create a settlement batch or a `public.bank_mutations`
row, so settlement/public-mutation completion is not proven. The processor
currently delegates only to `sport_center.create_payment_accounting_draft`; it
does not directly invoke the settlement owner, consistent with the existing
orchestration contract test. The settlement test suite also requires a
dedicated `TEST_DATABASE_URL` or `STAGING_DATABASE_URL`, which is not configured
and must not silently fall back to the shared DEV database.

No production writes, production migrations, Paylabs calls, WhatsApp sends, or
legacy cleanup were performed. The shared DEV configuration was not modified.