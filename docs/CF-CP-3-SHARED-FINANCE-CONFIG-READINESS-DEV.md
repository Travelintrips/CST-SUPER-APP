# CF-CP-3 — Customer Portal Shared Finance Config Readiness (Development)

Status: **BLOCKED for CF-CP-4**. This document records a read-only audit of the
development Supabase runtime. No configuration was created or modified.

Audit date: 2026-08-21 (Asia/Jakarta)

## Scope and safety boundary

CF-CP-3 is a discovery/readiness audit only. The audit did not:

- insert, update, or delete business/configuration rows;
- execute DDL or repair migrations;
- create a finance configuration or fabricate a fallback;
- call Paylabs, settle payments, reconcile bank mutations, or run the Central
  Finance processor;
- access or write the production business database.

The attached CF-SC-12B production-foundation certification was treated as
out-of-scope evidence. Its Sport Center production claims do not certify
Customer Portal development readiness and were not used as a source for
Customer Portal configuration.

## Runtime target

- Database: Supabase **development** runtime, resolved through the development
  secret bundle.
- Customer Portal payment boundary: installed and additive from CF-CP-2.
- `customer_payment_finance_events`: present; row count `0`.
- `payments`: present; row count `0` (`paid=0`, `pending=0`).
- `sales_documents`: `4` rows, all `confirmed`.
- Companies present: CST (`1`), WGS (`2`), DVS (`3`), and ERA (`4`).

## 1. Shared project configuration

The shared configuration header exists:

| ID | project_code | company_id | active | version |
|---:|---|---:|---|---:|
| 2 | `sport_center` | 1 | yes | 1 |
| 3 | `customer_portal` | 1 | yes | 1 |

The Customer Portal header is therefore not missing. It resolves to company
`1` (CST), but this does not by itself make the project finance-ready.

### Customer Portal child configuration

| Contract | Customer Portal rows |
|---|---:|
| Payment configuration | 0 |
| Tax mapping | 0 |
| COA mapping | 0 |

The only discovered payment configuration, tax mapping, and four COA role
mappings belong to `sport_center`, not `customer_portal`.

## 2. Payment, receiving bank, fee, and settlement discovery

No Customer Portal payment config identifies:

- payment method or provider;
- receiving bank account;
- currency;
- MDR or fixed provider fee;
- fee tax treatment;
- settlement delay;
- settlement tolerance;
- effective period.

The development runtime does contain company bank-account fixtures:

| company_id | total | active | default | IDs |
|---:|---:|---:|---:|---|
| 1 | 5 | 5 | 1 | 1, 2, 3, 4, 17 |
| 2 | 4 | 4 | 1 | 5, 6, 7, 8 |
| 3 | 4 | 4 | 1 | 9, 10, 11, 12 |
| 4 | 4 | 4 | 1 | 13, 14, 15, 16 |

These are generic company bank-account rows, not a Customer Portal receiving
bank decision. They must not be selected heuristically in CF-CP-4.

Paylabs non-secret configuration discovery:

- one row exists in `paylabs_configurations`;
- `sandbox_mode = true`;
- `sandbox_merchant_id = 010728`;
- `prod_merchant_id = 010613`;
- `store_id` is empty.

This proves only that the development Paylabs configuration record exists and
is sandbox-oriented. It does not establish the Customer Portal merchant/store
owner, receiving account, fee schedule, settlement delay, or tolerance. Secret
key values were not read or copied into this report.

## 3. Tax discovery

Active tax rules exist for sales, purchase, expense, logistics, and Sport
Center-related transaction types. A generic sales rule is not sufficient
evidence for Customer Portal ownership or transaction semantics.

Because `finance_project_tax_mappings` has zero Customer Portal rows, the
Customer Portal tax rule is **UNRESOLVED**. CF-CP-4 must identify the
authoritative sales transaction type and company-owned output tax rule before
creating a mapping.

## 4. COA discovery

The active chart of accounts contains company-specific bank, receivable,
revenue, tax, and fee-looking accounts, including company 1 accounts. These
are candidates only. No Customer Portal mapping currently binds any of them to
a shared-finance role.

Required roles remain unresolved for Customer Portal:

- `RECEIVING_BANK`
- `REVENUE`
- `TAX_OUTPUT`
- `MDR_EXPENSE`

No role may be inferred from account name, company default, or the Sport Center
mapping. The Sport Center config is a separate contract and must not be reused.

## 5. Canonical company and document identity

The CF-CP-2 payment schema carries `payments.company_id`, and the existing
runtime migration path backfills it from the authoritative parent
(`sales_documents.company_id` or the applicable logistic parent). The
Customer Portal project header currently points to company 1, but there are no
payment rows to prove an end-to-end payment/document company match.

The four available sales-document fixtures are all `confirmed`; there is no
paid/unpaid payment fixture set in `payments`, and no persisted
`payment_confirmed` event. CF-CP-4 therefore still needs explicit fixtures or a
non-writing proof path for:

- one unpaid document;
- one paid document;
- company/document/payment identity alignment;
- Paylabs-shaped provider metadata;
- partial payment;
- refund or reversal representation.

Fixtures must not be created as part of this audit.

## 6. Accounting and processor compatibility

No direct Paylabs/payment accounting rows were found in `accounting_entries`
using the runtime source/module/table fields. The discovered
`accounting_entries` schema uses `source` as an enum-like field; nonexistent
columns such as `journal_type` must not be assumed in future audits.

The table `sport_center.central_finance_processing` exists and contains `19`
rows. This is Sport Center processing state, not Customer Portal processing
state. It was not read as a Customer Portal event source and no processor was
run.

The CF-CP-2 event table has the required durable event identity fields:

- `source_project`;
- `source_payment_id`;
- `event_type`;
- `correlation_id`;
- company/customer/document/order snapshots;
- amount, currency, method, provider, provider reference;
- paid/confirmed timestamps and schema version.

However, the event table has no rows and no downstream Customer Portal
consumer contract was proven. The event is therefore compatible with the
CF-CP-2 durable boundary, but Central Finance consumption is **ADAPTER_REQUIRED**
until CF-CP-4 defines and validates the adapter/processor handoff. This audit
does not authorize enabling central processing.

## Readiness decision

### Overall

**CF-CP-3 = BLOCKED / NOT READY FOR CF-CP-4 EXECUTION**

### Blocking findings

1. Customer Portal has no payment configuration.
2. Customer Portal has no tax mapping.
3. Customer Portal has no COA role mappings.
4. Receiving bank, provider ownership, fee/MDR, settlement delay, and
   tolerance are unresolved.
5. Tax and COA candidates exist but are not canonically bound to Customer
   Portal; selecting them would create false configuration.
6. Development has no `payments` or `payment_confirmed` fixture rows for
   runtime identity proof.
7. Central Finance consumption requires an adapter contract; the Sport Center
   processor table is not a Customer Portal substitute.

### Non-blocking observations

- The active `customer_portal` project header exists and points to company 1.
- The CF-CP-2 durable event table and uniqueness contract are installed.
- Paylabs development configuration is sandbox-mode, but its non-secret
  ownership/settlement contract is incomplete.
- Generic company bank accounts and active COA/tax candidates exist.

## Required CF-CP-4 inputs

Before any configuration write or central handoff implementation, obtain and
review:

1. authoritative Customer Portal company/document ownership;
2. payment method and provider contract, including merchant/store ownership;
3. receiving bank account and its linked COA;
4. currency, MDR, fixed fee, fee-tax policy, settlement delay, and tolerances;
5. canonical sales tax rule and transaction type;
6. canonical `REVENUE`, `TAX_OUTPUT`, and `MDR_EXPENSE` COA identities;
7. adapter contract from `customer_payment_finance_events` to the approved
   Central Finance intake;
8. a read-only or isolated fixture proof covering unpaid, paid, Paylabs-shaped,
   partial, and refund/reversal states.

Until these inputs are approved, retain the CF-CP-2 development shadow
boundary. Do not create placeholder config, do not enable central processing,
and do not perform settlement or reconciliation.