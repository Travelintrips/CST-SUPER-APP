# Phase 4B-1 — Canonical Sport Center Settlement Contract

Status dokumen: discovery, read-only, contract freeze  
Database evidence: Supabase development, project ref `xssrfshdrtdfupgqwfdw`  
Audit date: 2026-08-10  

> The original discovery snapshot below records the actual database contract
> without introducing a Drizzle model, reconciliation implementation, trigger,
> function, or schema change. The subsequent runtime restoration boundary is
> documented separately below and remains subject to the stated DEV/PROD gate.

## Final verdict

```text
CANONICAL CONTRACT PARTIAL — DO NOT IMPLEMENT
```

The canonical settlement objects and their database functions are present and
internally coherent. Implementation is blocked because the existing public
reconciliation match contracts do not carry a source discriminator. The
canonical and legacy namespaces can therefore both represent:

```text
candidate_type = qris_settlement
candidate_id = 1
```

without an unambiguous source identity.

## Runtime owner-routine restoration boundary

The six database-owned routines required by the canonical settlement runtime
are defined by the checked-in restoration implementation in
`artifacts/api-server/src/modules/sport-center/migration.ts`:

```text
sport_center.resolve_internal_bank_account_id(integer, text)
sport_center.canonical_settlement_group_identity(integer, text, text, date, text)
sport_center.mark_settlement_payments_settled(bigint, text)
sport_center.create_payment_settlement_batch(text, integer, text, text, date, integer[], text)
sport_center.finalize_payment_settlement(bigint, text)
sport_center.find_settlement_bank_candidates(bigint, integer)
```

The restoration runner is additive and verifies these exact identity
signatures after execution. It is DEV-only by design and must be run against
DEV before any separately approved production change:

```text
pnpm db:restore:canonical:dev
```

It does not copy DEV objects to PROD, write to PROD, or resolve the separate
candidate-source and link-only approval blockers below. Production changes
require the separately approved production mechanism and a read-only preflight
showing the expected signatures before that change. The repository does not
perform that production write.

## A. Canonical source

The canonical source is:

```text
sport_center.payment_settlement_batches
sport_center.payment_settlement_items
```

The expected-bank projection is:

```text
sport_center.expected_bank_settlements
```

The canonical payment relationship is:

```text
sport_center.sport_payments.id
  -> sport_center.payment_settlement_items.payment_id
  -> sport_center.payment_settlement_items.settlement_id
  -> sport_center.payment_settlement_batches.id
```

Each item also stores the posted source payment journal:

```text
payment_settlement_items.payment_journal_id
  -> sport_center.accounting_journals.id
```

The legacy aggregate source remains:

```text
public.qris_settlements
public.qris_settlement_items
```

## B. Settlement batch schema

Actual columns in `sport_center.payment_settlement_batches`:

| Column | Type | Nullable | Default / identity |
|---|---|---:|---|
| id | bigint | NO | identity BY DEFAULT |
| settlement_reference | text | NO | — |
| company_id | integer | NO | — |
| provider_code | text | NO | — |
| provider_name | text | YES | — |
| bank_account_id | text | NO | — |
| settlement_date | date | NO | — |
| gross_amount | numeric | NO | `0` |
| mdr_amount | numeric | NO | `0` |
| provider_fee_amount | numeric | NO | `0` |
| tax_withheld_amount | numeric | NO | `0` |
| adjustment_amount | numeric | NO | `0` |
| net_amount | numeric | NO | `0` |
| status | text | NO | `'draft'` |
| calculated_at | timestamptz | YES | — |
| calculated_by | text | YES | — |
| posted_at | timestamptz | YES | — |
| posted_by | text | YES | — |
| reconciled_at | timestamptz | YES | — |
| reconciled_by | text | YES | — |
| reversed_at | timestamptz | YES | — |
| reversed_by | text | YES | — |
| voided_at | timestamptz | YES | — |
| voided_by | text | YES | — |
| settlement_journal_id | integer | YES | — |
| reversal_of_id | bigint | YES | — |
| provider_settlement_reference | text | YES | — |
| provider_batch_id | text | YES | — |
| provider_statement_reference | text | YES | — |
| settlement_rule_version | text | YES | — |
| bank_mutation_id | integer | YES | — |
| source | text | NO | `'SPORT_CENTER'` |
| correlation_id | text | YES | — |
| notes | text | YES | — |
| created_by | text | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | — |
| fee_tax_amount | numeric | NO | `0` |

Actual checks:

```text
gross_amount >= 0
mdr_amount >= 0
provider_fee_amount >= 0
tax_withheld_amount >= 0
net_amount >= 0
fee_tax_amount >= 0
net_amount =
  gross_amount
  - mdr_amount
  - provider_fee_amount
  - fee_tax_amount
  - tax_withheld_amount
  + adjustment_amount
reversal_of_id IS NULL OR reversal_of_id <> id
```

## C. Settlement item schema

Actual columns in `sport_center.payment_settlement_items`:

| Column | Type | Nullable | Default / identity |
|---|---|---:|---|
| id | bigint | NO | identity BY DEFAULT |
| settlement_id | bigint | NO | — |
| payment_id | integer | NO | — |
| payment_journal_id | integer | NO | — |
| gross_amount | numeric | NO | — |
| item_status | text | NO | `'active'` |
| source_event_id | uuid | YES | — |
| correlation_id | text | YES | — |
| notes | text | YES | — |
| created_by | text | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | — |

Actual checks:

```text
gross_amount > 0
item_status IN ('active', 'reversed', 'voided')
```

Actual foreign keys:

```text
settlement_id
  -> sport_center.payment_settlement_batches.id
  ON DELETE RESTRICT

payment_id
  -> sport_center.sport_payments.id
  ON DELETE RESTRICT

payment_journal_id
  -> sport_center.accounting_journals.id
  ON DELETE RESTRICT
```

Relevant uniqueness:

```text
UNIQUE (settlement_id, payment_id)
UNIQUE (payment_id) WHERE item_status = 'active'
UNIQUE (payment_journal_id) WHERE item_status = 'active'
UNIQUE (source_event_id) WHERE source_event_id IS NOT NULL
UNIQUE (correlation_id) WHERE correlation_id IS NOT NULL
```

Therefore one payment cannot be present in more than one active canonical
settlement. Historical `reversed` or `voided` items are not covered by the
active uniqueness predicates.

## D. Status lifecycle

`payment_settlement_batches.status` is plain `text` with this check:

```text
draft
calculated
posted
reconciled
reversed
voided
```

The expected architecture (`calculated`, `posted`, `reconciled`, `reversed`)
is a **PARTIAL** match: the database also supports `draft` and `voided`.

`sport_center.accounting_journals.status` is plain `text` with:

```text
draft
approved
posted
voided
reversed
```

The canonical finalize function only accepts a `draft` or `approved`
settlement journal, posts it, verifies `posted`, and only then changes the
settlement batch to `posted`.

## E. Expected bank settlement contract

`sport_center.expected_bank_settlements` is a view with this exact output:

```text
settlement_id
settlement_reference
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
expected_bank_amount
settlement_status
settlement_journal_id
bank_mutation_id
settlement_rule_version
posted_at
posted_by
reconciled_at
reconciled_by
bank_link_status
```

Actual view definition:

```sql
SELECT
  id AS settlement_id,
  settlement_reference,
  company_id,
  provider_code,
  provider_name,
  bank_account_id,
  settlement_date,
  gross_amount,
  mdr_amount,
  provider_fee_amount,
  fee_tax_amount,
  tax_withheld_amount,
  adjustment_amount,
  net_amount AS expected_bank_amount,
  status AS settlement_status,
  settlement_journal_id,
  bank_mutation_id,
  settlement_rule_version,
  posted_at,
  posted_by,
  reconciled_at,
  reconciled_by,
  CASE
    WHEN bank_mutation_id IS NULL THEN 'unmatched'
    ELSE 'linked'
  END AS bank_link_status
FROM sport_center.payment_settlement_batches
WHERE status IN ('posted', 'reconciled');
```

## F. Candidate finder contract

Actual function:

```text
sport_center.find_settlement_bank_candidates(bigint, integer)
```

Arguments:

```text
p_settlement_id bigint
p_date_tolerance_days integer DEFAULT 1
```

Return columns:

```text
settlement_id bigint
mutation_id integer
settlement_reference text
settlement_date date
mutation_date date
expected_amount numeric
mutation_amount numeric
amount_difference numeric
allowed_amount_difference numeric
date_difference_days integer
amount_match boolean
date_match boolean
company_match boolean
bank_account_match boolean
provider_match boolean
candidate_eligible boolean
```

Function properties:

```text
STABLE
SECURITY DEFINER
search_path = pg_catalog, sport_center
```

The definition contains no `INSERT`, `UPDATE`, or `DELETE`. It requires the
settlement to be `posted` or `reconciled`, selects incoming bank evidence, and
checks:

```text
transaction date within ± p_date_tolerance_days
direction is NULL, credit, in, incoming, or cr
amount difference <= max(fixed tolerance, percentage tolerance)
company matches, unless bank company_id is NULL
bank account matches, unless bank_account_id is NULL
provider matches, unless provider_name is NULL
```

The function is safe for a read-only candidate lookup. The other three
canonical functions are `VOLATILE SECURITY DEFINER` and write data; they were
not executed during discovery.

## G. Journal contract

The batch-to-journal relationship is:

```text
payment_settlement_batches.settlement_journal_id
  -> accounting_journals.id
```

The inverse foreign key also exists:

```text
accounting_journals.settlement_batch_id
  -> payment_settlement_batches.id
```

Both are `ON DELETE RESTRICT`.

The existing settlement journal evidence was:

```text
journal id: 10
journal_type: settlement
status: posted
settlement_batch_id: 1
gross_amount: 100000.00
is_reversal: false
approved_at: 2026-08-10T17:34:03.809Z
posted_at: 2026-08-10T17:34:03.809Z
```

Its actual lines were:

```text
DR 99700.00  Net settlement TEST-SETTLEMENT-20260810-001
DR   300.00  MDR TEST-SETTLEMENT-20260810-001
CR 100000.00  Clear Payment Clearing TEST-SETTLEMENT-20260810-001
```

This is the expected conceptual settlement entry:

```text
DR Bank Net
DR MDR / provider deductions
CR Payment Clearing Gross
```

The canonical draft function additionally emits conditional debit lines for
provider fee, provider-fee tax, tax withheld receivable, and adjustment
handling.

## H. Bank mutation contract

Actual table: `sport_center.bank_mutations`.

Relevant columns:

```text
id integer
transaction_date text
amount numeric
credit_amount numeric
debit_amount numeric
direction text
company_id integer NULL
bank_account_id text NULL
provider_name text NULL
provider_order_id text NULL
status sport_center.bank_mutation_status
mutation_key text
description text
raw_payload jsonb NULL
matched_payment_id integer NULL
matched_order_id integer NULL
accounting_posted boolean DEFAULT false
journal_id text NULL
approved_by text NULL
approved_at timestamptz NULL
source text NULL
source_schema text NULL
source_table text NULL
source_id text NULL
provenance jsonb NULL
```

Actual `bank_mutation_status` values:

```text
unmatched
matched
duplicate_need_review
approved
rejected
auto_matched
need_review
```

The canonical finder treats incoming values (`credit`, `in`, `incoming`,
`cr`) as settlement candidates. The database contains no canonical
settlement-specific bank mutation status.

Bank mutation ownership is therefore **BLOCKED for implementation freeze**:
the database contract does not establish whether link-only settlement
approval must leave this status unchanged or move it to an existing matched
status. Existing CST code has separate matching/approval paths and must not be
silently reused for the canonical link-only operation.

## I. Candidate identity / discriminator

Legacy public reconciliation contracts use:

```text
candidate_type
candidate_id
```

The existing public tables have no `candidate_source`, `source_schema`,
`source_type`, `metadata`, or `match_metadata` discriminator:

```text
public.bank_reconciliation_matches
  candidate_type text
  candidate_id integer

public.bank_allocation_matches
  candidate_type text
  candidate_id integer
```

The canonical batch does have source-like fields (`source`,
`source_schema` on its journal, and `source = 'SPORT_CENTER'`), but those fields
are not carried into the public match identity.

The current CST source uses `candidate_type = 'qris_settlement'` for
`public.qris_settlements`. Reusing that type for
`sport_center.payment_settlement_batches` is ambiguous.

Minimum required contract extension before Phase 4C:

```text
candidate_source = 'public.qris_settlements'
candidate_source = 'sport_center.payment_settlement_batches'
```

or an equivalent fully-qualified source identity. This document does not
implement that extension.

## J. Payment exclusion predicate

The canonical database-level active-payment invariant is:

```sql
NOT EXISTS (
  SELECT 1
  FROM sport_center.payment_settlement_items si
  WHERE si.payment_id = sp.id
    AND si.item_status = 'active'
)
```

The active item must also link to a canonical parent:

```sql
NOT EXISTS (
  SELECT 1
  FROM sport_center.payment_settlement_items si
  JOIN sport_center.payment_settlement_batches sb
    ON sb.id = si.settlement_id
  WHERE si.payment_id = sp.id
    AND si.item_status = 'active'
    AND sb.status IN ('posted', 'reconciled')
)
```

The first predicate is the stronger actual creation invariant because the
unique partial index blocks an active item regardless of parent status.

## K. Reconciliation eligibility predicate

Based on the actual view and candidate finder:

```sql
sb.status IN ('posted', 'reconciled')
AND sb.settlement_journal_id IS NOT NULL
AND sj.status = 'posted'
AND sb.bank_mutation_id IS NULL
```

where:

```sql
sj.id = sb.settlement_journal_id
AND sj.journal_type = 'settlement'
AND sj.is_reversal = false
```

The `posted`-journal requirement is enforced by `finalize_payment_settlement`
before it sets the batch to `posted`, and by `find_settlement_bank_candidates`
through its settlement status gate. However, the view itself filters only the
batch status and does not join or revalidate journal status. Eligibility must
therefore retain the explicit journal join above.

Additional candidate requirements are the finder’s date, direction, amount,
company, bank-account, and provider checks in section F.

## L. Link-only approval contract

The future Phase 4C transaction should be:

```text
BEGIN
lock bank mutation
lock canonical settlement batch
revalidate section K eligibility
verify mutation is not already linked
verify settlement is not already linked
link payment_settlement_batches.bank_mutation_id = bank_mutations.id
set status posted -> reconciled
set reconciled_at and reconciled_by
write the existing reconciliation audit/match record
do not create a journal
COMMIT
```

This is a proposed freeze contract, not an implementation. The database
currently has no proven canonical audit/match discriminator for the final
write, so this section remains **BLOCKED** until section I is resolved.

## M. Void contract

The inverse operation should be:

```text
reconciled -> posted
bank_mutation_id -> NULL
```

The settlement journal remains:

```text
posted -> posted
```

The operation must not:

```text
delete the settlement
reverse the settlement journal
change gross_amount
change mdr_amount
change net_amount
```

The existing database has no canonical settlement reconciliation audit
contract that proves how a link-only void is recorded. Existing public and
Sport Center match tables are separate, and their status ownership differs.
Therefore the void contract is **BLOCKED** pending the same discriminator and
audit ownership decision as section L.

## N. Legacy boundary

Legacy:

```text
public.qris_settlements
public.qris_settlement_items
candidate_type = 'qris_settlement'
```

Canonical:

```text
sport_center.payment_settlement_batches
sport_center.payment_settlement_items
```

The canonical source must not be represented by the legacy public table or by
the same unqualified `(candidate_type, candidate_id)` pair.

The existing CST source has explicit legacy queries and writes for
`public.qris_settlements`. It does not contain a canonical
`sport_center.payment_settlement_batches` adapter.

## O. CST source adaptation requirements

The repository currently has no Drizzle table definition or source adapter
for the canonical `sport_center` settlement objects. It does have:

```text
artifacts/api-server/src/lib/reconciliation/erpDocumentMatcher.ts
artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts
artifacts/api-server/src/routes/bankReconciliation.ts
```

Those paths currently understand the public/legacy QRIS contract. The
minimum-change option is:

1. Add a read-only raw-SQL adapter for the canonical view and candidate
   function, rather than creating a duplicate settlement model.
2. Add a fully-qualified candidate source to the internal response and
   persistence contract before exposing canonical candidates.
3. Keep journal creation out of bank reconciliation; canonical settlement
   journal creation remains owned by the database settlement functions.
4. Add Zod/TypeScript response types only after the source discriminator and
   bank mutation ownership are frozen.

No implementation was made in this phase.

## Required final matrix

| Contract | Status |
|---|---|
| Settlement batch | VERIFIED |
| Settlement items | VERIFIED |
| Expected settlement view | VERIFIED |
| Candidate finder | VERIFIED |
| Settlement journal relationship | VERIFIED |
| Journal lifecycle | VERIFIED |
| Bank mutation schema | VERIFIED |
| Bank mutation status ownership | BLOCKED |
| Candidate discriminator | BLOCKED |
| Payment exclusion predicate | VERIFIED |
| Eligibility predicate | PARTIAL |
| Link-only approval | BLOCKED |
| Void contract | BLOCKED |

## Existing evidence summary

At audit time, development contained one canonical settlement:

```text
settlement id: 1
reference: TEST-SETTLEMENT-20260810-001
company: 1
provider: mandiri_direct
bank account: 1640006707220
date: 2026-08-11
gross: 100000.00
MDR: 300.00
net: 99700.00
status: posted
settlement_journal_id: 10
bank_mutation_id: NULL
```

The corresponding item was `id = 1`, with gross amount `100000.00`.
The corresponding settlement journal was posted and balanced as documented in
section G. No rows existed in the legacy `public.qris_settlements`,
`public.qris_settlement_items`, or `public.bank_reconciliation_matches`
tables at audit time.

## Change confirmation

```text
Source implementation changes: 0
Database changes: 0
Reconciliation changes: 0
Trigger changes: 0
Function changes: 0
Migration changes: 0
```