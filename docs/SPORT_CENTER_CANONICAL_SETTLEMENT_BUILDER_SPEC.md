# Phase 4C-7A.7F — Canonical Sport Center Settlement Builder

**Status:** SPECIFICATION ONLY — no implementation  
**Scope:** Define the minimum contract for a future canonical settlement builder.  
**Out of scope:** 4C-8, reconciliation approval, void/reopen, generic `/post`,
bank mutations, Google Sheet ingestion, and manual settlement-row writes.

## 1. Current evidence and ownership boundary

The canonical tables already exist in the `sport_center` schema:

```text
sport_center.sport_payments
sport_center.payment_settlement_configs
sport_center.payment_settlement_items
sport_center.payment_settlement_batches
sport_center.accounting_journals
```

The canonical read-only bank candidate function is:

```text
sport_center.find_settlement_bank_candidates(bigint, integer)
```

It is a finder only. It does not create payment settlement items, batches, or
journals.

The existing checked-in application contains:

- a canonical settlement read adapter;
- canonical settlement approval/link-only logic;
- a generic public QRIS settlement engine;
- a settlement-pattern recognition engine;
- the existing application accounting posting engine.

None of those is the canonical Sport Center payment-settlement builder.
The generic QRIS engine must not be reused for `sport_center.*` settlement
creation, and the settlement-pattern engine is not a posting engine.

The frozen database evidence for a known canonical settlement demonstrates the
target journal shape:

```text
reference: TEST-SETTLEMENT-20260810-001
gross:     100000.00
MDR:          300.00
net:       99700.00

DR 99700.00  Bank Net
DR   300.00  MDR / provider deductions
CR 100000.00 Payment Clearing Gross
```

That row is evidence of the canonical data contract, not permission to copy
its values or manually create another settlement.

### 1.1 Mandatory implementation gates

The builder may not be implemented until all of the following are proven from
the live development schema or from an owner-approved canonical service
contract:

1. The exact bridge from a confirmed canonical payment to its **posted payment
   journal** is identified.
2. The exact owner of `sport_center.accounting_journals` settlement journal
   creation and posting is identified.
3. The exact payment `settlement_status` transition owned by the canonical
   schema is identified.
4. The exact fee/rate columns in `payment_settlement_configs` are identified.
5. The exact uniqueness/index contract for settlement-batch grouping is
   verified.

If any gate is missing, the builder must fail closed and no settlement write
may occur. This document does not create a replacement function or service to
resolve those gates.

## 2. Canonical source and eligibility

The builder operates only on canonical rows from:

```text
sport_center.sport_payments
```

An input payment is eligible only when all conditions hold in the same
transaction:

```text
payment.status = 'confirmed'
payment.company_id IS NOT NULL
payment.provider identity is complete
payment.external bank account identity is complete
payment.expected_settlement_date IS NOT NULL
payment.settlement_rule_version IS NOT NULL
payment.settlement_status = 'unsettled'
owner-approved settlement config matches the payment
payment accounting journal exists and is posted
payment is not already in an active settlement item
```

The payment-to-journal relationship must be resolved through the verified
canonical bridge. The implementation must not infer a journal from:

- a public mirror payment ID;
- a payment number alone;
- a journal with a matching amount;
- an unrelated public `accounting_entries` row;
- a generic journal-reuse lookup.

The payment journal must be locked and revalidated as `posted` before the
settlement item is inserted.

The active-item exclusion is:

```sql
NOT EXISTS (
  SELECT 1
  FROM sport_center.payment_settlement_items item
  WHERE item.payment_id = payment.id
    AND item.item_status = 'active'
)
```

The database unique partial index on active `payment_id` remains authoritative.
The pre-check is advisory only.

## 3. Owner-approved configuration

Configuration is read only from:

```text
sport_center.payment_settlement_configs
```

The selected row must satisfy:

```text
company_id = payment.company_id
provider_code = normalized payment provider
bank_account_id = payment external bank-account identity
is_active = true
source = 'OWNER_APPROVED'
rule_version = payment.settlement_rule_version
effective_from <= payment settlement date
effective_until IS NULL OR payment settlement date < effective_until
```

For the known development configuration, the resolved identity is:

```text
company:  1
provider: mandiri_direct
bank:     1640006707220
rule:     PROD-MANDIRI-SC-20260810-v1
window:   T+1 business day
MDR:      0.003
fee:      0
fee tax:  0
```

These values are configuration evidence, not recovery constants. The builder
must read the effective configuration row for each payment group. It must not
derive MDR, fees, or net amounts from a bank mutation.

The implementation must identify the exact live configuration columns for:

```text
MDR rate or MDR amount rule
provider fee amount/rate
fee-tax amount/rate
adjustment policy
```

If those columns cannot be resolved unambiguously, return a controlled
configuration error and roll back.

## 4. Grouping key

Eligible payments are grouped only by this complete key:

```text
company_id
provider identity
external bank account
expected_settlement_date
settlement_rule_version
```

Provider identity includes the normalized provider code and the provider
identity required by the canonical schema. A provider name alone is not a
stable grouping key.

Payments with different values in any grouping dimension must never share a
batch. In particular, the builder must not mix:

- different companies;
- different providers;
- different external bank accounts;
- different settlement dates;
- different owner-approved rule versions.

The settlement reference and correlation identity must be deterministic from
the complete grouping key. It must not depend on process time, row order, or a
random value.

## 5. Batch calculation

For each locked group:

```text
gross_amount =
  SUM(payment.amount for eligible payments in the group)

mdr_amount =
  owner-approved MDR calculation for the group

provider_fee_amount =
  owner-approved provider-fee calculation for the group

fee_tax_amount =
  owner-approved fee-tax calculation for the group

tax_withheld_amount =
  owner-approved withholding calculation, otherwise 0

adjustment_amount =
  explicit approved adjustment only, otherwise 0

net_amount =
  gross_amount
  - mdr_amount
  - provider_fee_amount
  - fee_tax_amount
  - tax_withheld_amount
  + adjustment_amount
```

All amounts are rounded using the canonical database/accounting precision
before constraint validation. The result must satisfy the existing batch
checks:

```text
all component amounts >= 0
net_amount >= 0
net_amount equals the formula above
```

The builder must never use:

```text
bank mutation amount
bank mutation MDR/deduction
observed bank credit
generic QRIS candidate amount
hardcoded recovery values
```

## 6. Settlement item contract

For every eligible payment in a group, insert exactly one active item with:

```text
settlement_id
payment_id
payment_journal_id
gross_amount = payment.amount
item_status = 'active'
source_event_id when supplied by the canonical event contract
correlation_id = deterministic builder correlation
created_by
```

The item must satisfy the existing constraints:

```text
gross_amount > 0
item_status IN ('active', 'reversed', 'voided')
payment_id references sport_center.sport_payments
payment_journal_id references sport_center.accounting_journals
settlement_id references payment_settlement_batches
```

The active uniqueness invariants are:

```text
UNIQUE (payment_id) WHERE item_status = 'active'
UNIQUE (payment_journal_id) WHERE item_status = 'active'
UNIQUE (source_event_id) WHERE source_event_id IS NOT NULL
UNIQUE (correlation_id) WHERE correlation_id IS NOT NULL
```

The builder must treat a unique violation as a concurrency/idempotency
decision, not as success. It must re-read the locked canonical state and
return either the already-built result or a controlled conflict.

## 7. Batch lifecycle

The builder owns only the accounting settlement lifecycle:

```text
draft
  -> calculated
  -> posted
```

It must not set a batch to `reconciled`, attach a bank mutation, or invoke
reconciliation approval.

Required batch fields:

```text
company_id
provider_code
provider_name
bank_account_id
settlement_date
gross_amount
mdr_amount
provider_fee_amount
fee_tax_amount
tax_withheld_amount
adjustment_amount
net_amount
settlement_rule_version
source = 'SPORT_CENTER'
correlation_id
bank_mutation_id = NULL
```

`bank_mutation_id` must remain `NULL` for the entire builder transaction.

The batch may not be marked `posted` until a valid posted settlement journal
exists and points back to the same batch.

## 8. Settlement journal contract

The settlement journal must be created in the canonical
`sport_center.accounting_journals` owner system, not in the public generic
QRIS tables and not through generic bank reconciliation posting.

Required journal properties:

```text
journal_type = 'settlement'
is_reversal = false
status = 'posted' after successful builder completion
settlement_batch_id = batch.id
gross_amount = batch.gross_amount
```

Required conceptual lines:

```text
DR Bank Net                         batch.net_amount
DR MDR / provider deductions       batch.mdr_amount
DR provider fees                   batch.provider_fee_amount
DR fee tax                         batch.fee_tax_amount
DR tax withheld receivable         batch.tax_withheld_amount, when applicable
DR/CR approved adjustment          batch.adjustment_amount, when applicable
CR Payment Clearing Gross          batch.gross_amount
```

The canonical journal owner must balance the lines and enforce its own COA
mapping. The builder must not insert raw journal lines into a second accounting
model.

The existing public application posting engine inserts public
`accounting_entries` in a draft-first flow and its public journal type contract
does not by itself establish ownership of the canonical
`sport_center.accounting_journals` settlement journal. Therefore an
implementation must use a verified canonical Sport Center journal service or
database function. If no such owner contract is found, implementation is
blocked.

## 9. Exact transaction sequence

The future builder must run as one database transaction:

```text
BEGIN

1. Resolve the canonical event/payment identity.
2. Lock eligible canonical payments in ascending payment_id order.
3. Re-read payment metadata, status, settlement status, and grouping fields.
4. Resolve and lock the single owner-approved config for each group.
5. Resolve and lock each payment's canonical posted payment journal.
6. Revalidate the active-settlement-item exclusion.
7. Acquire the deterministic group lock / batch identity lock.
8. Re-read an existing deterministic batch, if any.
9. If an existing posted batch and item set exactly match the group:
     return idempotent success without new writes.
10. If an existing batch is partial, draft, or calculated:
     lock it and resume only if all invariant checks pass.
11. Otherwise create one draft batch.
12. Insert exactly one active item per eligible payment.
13. Recalculate gross, deductions, adjustment, and net from locked sources.
14. Mark the batch calculated.
15. Create or reuse exactly one canonical settlement journal.
16. Post the settlement journal through its verified owner.
17. Re-read and verify the journal is posted, balanced, non-reversal,
    settlement-typed, and linked to this batch.
18. Mark the batch posted.
19. Apply the verified canonical payment settlement-status transition.
20. Verify bank_mutation_id remains NULL.
21. COMMIT
```

Any failure rolls back the complete transaction. A builder must not catch a
write failure and report success.

## 10. Idempotency and concurrency

Idempotency is based on canonical identity, not on a timestamp:

```text
source payment identity
event identity, when present
complete grouping key
deterministic batch correlation_id
```

Two concurrent runs for the same payment set must produce:

```text
one active item per payment
one batch for the complete grouping key
one settlement journal for that batch
one posted batch
```

Required locking order:

```text
1. canonical payments, ascending payment_id
2. owner-approved config rows
3. deterministic group/batch identity
4. existing batch, when present
5. payment journals, ascending journal ID
```

The implementation must verify these protections in the live schema before
coding:

```text
active payment_id uniqueness
active payment_journal_id uniqueness
source_event_id uniqueness
item correlation_id uniqueness
batch correlation/group uniqueness
journal-to-batch uniqueness
```

If a batch-group uniqueness constraint is absent, the implementation requires
an additive schema change or an equivalent proven database advisory-lock
contract. A pre-check without a unique/concurrency backstop is insufficient.

## 11. Payment settlement-status transition

The current canonical payment table exposes a text
`settlement_status` with a default of `unsettled`. The builder must not guess
the post-build value from the public QRIS implementation.

Before implementation, prove from the live canonical schema/function/service
contract the exact transition owned by the Sport Center system:

```text
unsettled -> <verified successfully-settled state>
```

The implementation must then:

1. lock the payment;
2. revalidate the old value is `unsettled`;
3. apply only the verified transition;
4. verify the resulting value before commit.

If the owner contract does not define this transition, the builder must return
`CANONICAL_PAYMENT_SETTLEMENT_STATE_UNRESOLVED` and roll back. It must not
invent `settled`, `posted`, or another status.

## 12. Recovery and error codes

A failed run must be retryable:

- no partial posted batch without a valid posted journal;
- no item remains active unless it belongs to a valid resumable batch;
- no payment is marked successfully settled before the batch and journal are
  valid;
- no bank mutation or reconciliation row is changed;
- a retry must reuse the deterministic identity and existing valid rows.

Minimum controlled errors:

```text
CANONICAL_PAYMENT_NOT_ELIGIBLE
CANONICAL_PAYMENT_JOURNAL_NOT_POSTED
CANONICAL_PAYMENT_JOURNAL_BRIDGE_UNRESOLVED
CANONICAL_SETTLEMENT_CONFIG_UNRESOLVED
CANONICAL_SETTLEMENT_CONFIG_AMBIGUOUS
CANONICAL_SETTLEMENT_GROUP_INVALID
CANONICAL_SETTLEMENT_ITEM_ALREADY_ACTIVE
CANONICAL_SETTLEMENT_BATCH_CONFLICT
CANONICAL_SETTLEMENT_JOURNAL_OWNER_UNRESOLVED
CANONICAL_SETTLEMENT_JOURNAL_NOT_POSTED
CANONICAL_SETTLEMENT_JOURNAL_NOT_BALANCED
CANONICAL_PAYMENT_SETTLEMENT_STATE_UNRESOLVED
CANONICAL_SETTLEMENT_IDEMPOTENCY_CONFLICT
CANONICAL_SETTLEMENT_CONCURRENCY_CONFLICT
```

## 13. Explicitly forbidden operations

The builder must never:

```text
insert into public.qris_settlements
insert into public.qris_settlement_items
use generic /api/bank-reconciliation/:mutationId/post
create a reconciliation match
change sport_center.bank_mutations
set bank_mutation_id
approve a canonical bank link
reconcile a settlement
void or reopen a settlement
create a reversal
manually force payment 22
manually force SC-0001
hardcode payment 22 amounts or configuration values
```

## 14. Proposed implementation surface

Only after the mandatory implementation gates are proven:

```text
artifacts/api-server/src/lib/reconciliation/
  canonicalSettlementBuilder.ts
```

Proposed contract:

```ts
export interface CanonicalSettlementBuildOptions {
  sourcePaymentId?: number;
  sourceEventId?: string;
  actor: string;
}

export interface CanonicalSettlementBuildResult {
  ok: true;
  idempotent: boolean;
  batchIds: number[];
  itemIds: number[];
  journalIds: number[];
}

export async function buildCanonicalSportCenterSettlements(
  options: CanonicalSettlementBuildOptions,
): Promise<CanonicalSettlementBuildResult>;
```

This is a proposal for the future application boundary only. It is not an
implementation, and it must call only the verified canonical journal owner.

## 15. Required test matrix

Focused tests must prove:

1. confirmed payment with posted payment journal is eligible;
2. unconfirmed payment is rejected;
3. incomplete metadata is rejected;
4. non-owner-approved or ambiguous config is rejected;
5. non-posted payment journal is rejected;
6. unsettled payment already in an active item is rejected/idempotently
   recognized;
7. different grouping keys create separate batches;
8. same grouping key reuses one batch;
9. gross equals the sum of eligible payment gross values;
10. MDR and fees come from owner-approved config, not bank evidence;
11. net satisfies the canonical formula;
12. one item is created per eligible payment;
13. item payment journal ID is the verified posted payment journal;
14. settlement journal has the required type, link, balance, and lines;
15. batch cannot become posted before the journal is posted;
16. bank mutation remains untouched and `bank_mutation_id` remains `NULL`;
17. payment status uses the verified canonical transition;
18. repeated execution is idempotent;
19. concurrent execution yields one batch, one journal, and one active item
    per payment;
20. journal failure rolls back batch, items, and payment-state changes;
21. partial resumable state is either safely resumed or rejected with no false
    success;
22. unrelated `SC-0001` remains unchanged;
23. no generic QRIS or `/post` path is called.

Runtime proof must use isolated development fixtures only. Payment 22 and
`SC-0001` are observation/protection references, not write targets for this
spec-only phase.

## 16. Implementation readiness verdict

The minimum builder behavior is now specified, but implementation remains
blocked until the following live contracts are proven:

```text
canonical payment -> posted payment journal bridge
canonical settlement journal creation/posting owner
payment settlement_status success transition
exact owner-approved fee/rate columns
batch grouping uniqueness backstop
```

No builder, function, migration, table, worker, or settlement row is created
by this specification.