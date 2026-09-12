# CF-CP-4A — Customer Portal Product Tax and COA Adoption (Development)

**Status:** `PARTIAL / OWNER_TAX_DECISION_REQUIRED / JASA_REVENUE_AMBIGUOUS`  
**Environment:** Development only  
**Date:** 2026-08-21

## Result

The deterministic parts of CF-CP-4A are implemented and verified:

- Customer Portal project: `customer_portal`
- Canonical company: company `1` / CST
- Company source: `public.sales_documents.company_id`
- Canonical payment: `public.payments.id`
- Canonical event: `public.customer_payment_finance_events`
- Product discriminator contract: nullable `finance_project_tax_mappings.product_scope`
- Event adapter: implemented as a pure, fail-closed translation
- Paylabs, receiving bank, MDR, settlement, and reconciliation: deferred

No placeholder tax or COA mapping was seeded because the runtime evidence does
not prove a unique treatment for each product family.

CF-CP-4B adds the product-scoped COA discriminator and adopts only the
deterministic goods revenue mapping. Paylabs and settlement remain deferred.

## Canonical ownership

The existing Customer Portal payment-link path resolves the company from the
sales document and refuses an ambiguous/null owner. The active project header
is:

| Field | Value |
|---|---|
| project_code | `customer_portal` |
| company_id | `1` |
| config ID | `3` |
| active | yes |
| central accounting | disabled |

The development sales-document fixtures currently have `company_id = NULL`,
so they cannot serve as end-to-end proof of company ownership. This is an
evidence limitation, not a reason to add a `company_id ?? 1` fallback.

## Product families

The canonical catalog discriminator is `products.item_type`, not display-name
matching:

| Product family | Stable discriminator | Catalog evidence |
|---|---|---:|
| goods | `item_type = 'barang'` | 13 active products |
| services | `item_type = 'jasa'` | 7 active products |

Existing sales-line evidence includes:

- `SVC-OCEAN-FREIGHT` with `item_type = barang` in the legacy fixture;
- `SVC-CUSTOMS` and `SVC-HANDLING` with `item_type = jasa`;
- three lines with no linked product, which remain `UNRESOLVED`.

The legacy catalog contains inconsistent naming (for example, a service SKU
with `item_type = barang`). Therefore the machine discriminator is retained,
but product identity must be normalized before a payment can select a tax
mapping.

## Product-scoped tax contract

The existing mapping schema had no product discriminator. An additive
development-only migration now adds:

```text
finance_project_tax_mappings.product_scope TEXT NULL
```

and an index on `(finance_project_config_id, product_scope)` for non-null
scopes. Existing Sport Center mappings remain valid because the field is
nullable. The migration does not insert or alter tax mappings.

### Tax treatment outcome

Company 1 has an active generic sales output rule:

| Rule ID | Name | Rate | Direction | Transaction | Module |
|---:|---|---:|---|---|---|
| 1 | PPN Keluaran 11% | 11% | output | `sales_order` | `sales` |

The available Customer Portal sales-document fixtures have `tax_rate_id =
NULL`, `tax_amount = 0`, and `grand_total = total_amount`. They do not prove
that both product families are taxable, nor do they prove whether tax is
inclusive or exclusive. No company-1 Customer Portal accounting evidence is
available (`sales_invoice`/`sales_payment` usage: zero).

Consequently:

- goods: `OWNER_TAX_DECISION_REQUIRED`;
- services: `OWNER_TAX_DECISION_REQUIRED`;
- no global or product-scoped tax mapping was created;
- Sport Center tax rule `8` was not reused.

This is intentionally a per-product blocker, as required by the owner policy.

## Company 1 COA review

Canonical company-1 candidates found include:

| Role candidate | ID | Code | Name |
|---|---:|---|---|
| RECEIVABLE | 49101 | `1-1030-CST` | Piutang Usaha CST |
| TAX_OUTPUT | 49109 | `2-1020-CST` | PPN Keluaran CST |
| revenue candidate | 49116 | `4-1010-CST` | Pendapatan Jasa Freight CST |
| revenue candidate | 49121 | `4-1015-CST` | Pendapatan Penjualan Barang CST |
| MDR candidate | 75590 | `5-3050-CST` | Biaya MDR & Payment Gateway CST |

CF-CP-4B revenue resolution:

- **goods adopted:** `49121 / 4-1015-CST / Pendapatan Penjualan Barang CST`;
  the account is active, postable, and its canonical name exactly identifies
  goods sales.
- **jasa remains ambiguous:** active candidates include freight `49116`, air
  freight `49118`, customs `49120`, handling `73051`, and document service
  `73052`. No Customer Portal sales posting proves one account.
- `finance_project_coa_mappings.product_scope` was added additively; the
  idempotent `customer_portal / goods / REVENUE` mapping points to `49121`.

The following are not adopted as Customer Portal mappings:

- no Customer Portal sales journal proves the revenue account;
- the two product families may require different revenue accounts;
- `TAX_OUTPUT` is only required after a product is proven taxable;
- `RECEIVABLE` depends on whether the Customer Portal flow posts an invoice
  before payment;
- `MDR_EXPENSE` is a deferred provider role.

No new COA account was created. The shared `TAX_OUTPUT` candidate remains
`49109 / 2-1020-CST / PPN Keluaran CST`; it will be reused if either product
family is approved as taxable. `RECEIVABLE` is `NOT_REQUIRED` for this phase:
there are no Customer Portal sales invoice/payment accounting entries and the
current flow has no proven receivable posting.

## Paylabs and bank boundary

Paylabs payment configuration remains deferred by owner decision. No
Customer Portal payment config, receiving-bank mapping, MDR, fee, settlement
delay, tolerance, or settlement batch was created. The existing development
Paylabs record is sandbox-oriented, but does not prove shared-finance ownership.

## Event adapter

`customer_payment_finance_events` contains the CF-CP-2 durable event identity
and snapshot fields. The new adapter translates that event to a normalized
Customer Portal intake DTO after validating:

- source project;
- event type;
- payment ID;
- company ID;
- positive amount;
- currency;
- correlation ID;
- timestamps.

The adapter performs no database write and does not post accounting, create
settlements, reconcile, or call Paylabs. The current shared processor consumes
Sport Center outbox/payment structures, so Customer Portal remains
`ADAPTER_REQUIRED`; central processing is not enabled.

## Fixture matrix

| Scenario | Current evidence | Outcome |
|---|---|---|
| unpaid document | 4 confirmed documents, payment status unpaid | no `payment_confirmed` processing |
| paid payment | `payments` rows = 0 | blocked until isolated fixture exists |
| goods product | catalog + one legacy line | tax decision required |
| services product | catalog + two legacy lines | tax decision required |
| partial payment | no payment rows | identity contract covered by CF-CP-2; runtime proof pending |
| refund/reversal | no Customer Portal event rows | classified fail-closed/not implemented |
| Paylabs-shaped payment | no payment rows; Paylabs sandbox config exists | deferred, fail-closed |

Synthetic fixtures, if later needed, must be rollback-only and must not create
settlement, bank mutation, reconciliation, or production effects.

## Verification and writes

Implemented development-only schema write:

- add nullable `product_scope` column if absent;
- add product-scope index if absent.

No mapping, tax rule, COA, payment, event, accounting, settlement, or
reconciliation row was written by this phase.

Quality gates:

- workspace typecheck: PASS;
- API typecheck: PASS;
- API build: PASS;
- CF-CP-2 tests: previously `4/4 PASS`;
- new product-tax/adapter tests: `8/8 PASS` across product-tax and payment-boundary suites;
- `git diff --check`: PASS.

Production writes and cutover: `0` / `NO`.

## Final classification

```text
CF-CP-4A = PARTIAL
PROJECT CONFIG = 3
CANONICAL COMPANY = 1
COMPANY SOURCE = public.sales_documents.company_id
PRODUCT TYPE A = barang / catalog product family
PRODUCT TYPE B = jasa / catalog service family
PRODUCT TAX DISCRIMINATOR = products.item_type -> product_scope contract
PRODUCT A TAX = OWNER_TAX_DECISION_REQUIRED
PRODUCT B TAX = OWNER_TAX_DECISION_REQUIRED
REVENUE COA = UNPROVEN / multiple product candidates
TAX_OUTPUT COA = deferred until taxable product scope is approved
RECEIVABLE COA = UNPROVEN
RECEIVING_BANK = DEFERRED_PAYLABS
MDR_EXPENSE = DEFERRED_PAYLABS
PAYLABS PAYMENT CONFIG = DEFERRED
EVENT ADAPTER = IMPLEMENTED, side-effect free
CONFIG FAIL-CLOSED = PASS
PROD WRITES = 0
PROD CUTOVER = NO
READY FOR CF-CP-4B = NO
```

Remaining owner decision: tax treatment for each product family, followed by
approval of product-scoped revenue/COA mappings and runtime fixtures.