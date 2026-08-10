# Phase 4C — Canonical Sport Center Reconciliation Implementation Specification

Status dokumen: policy freeze, implementation specification  
Scope: canonical Sport Center QRIS settlement ke bank mutation  
Source policy: Phase 4B-4 — Final Policy Freeze & Phase 4C Implementation Specification  
Implementation status: **belum diimplementasikan**

> Dokumen ini adalah spesifikasi implementasi. Tidak ada source code, database,
> migration, trigger, function, atau production data yang diubah ketika dokumen
> ini dibuat.

---

## 1. Frozen policy decisions

### 1.1 Source-qualified identity

Canonical Sport Center settlement:

```text
candidate_type   = qris_settlement
candidate_id     = sport_center.payment_settlement_batches.id
candidate_source = sport_center.payment_settlement_batches
```

Legacy QRIS settlement:

```text
candidate_type   = qris_settlement
candidate_id     = public.qris_settlements.id
candidate_source = public.qris_settlements
```

The complete candidate identity is:

```text
(candidate_type, candidate_id, candidate_source)
```

New records MUST NOT use `(candidate_type, candidate_id)` alone.

### 1.2 Historical rows

Rows with `candidate_source IS NULL`:

- remain readable;
- are not automatically backfilled;
- are not destructively migrated;
- are not guessed to be legacy;
- cannot be approved when source resolution is ambiguous.

All new canonical rows MUST contain the canonical source. New legacy QRIS rows
SHOULD explicitly contain the legacy source.

### 1.3 Bank mutation status policy

Canonical approval:

```text
matched -> approved
```

Meaning:

```text
approved = bank mutation has an approved reconciliation link
```

It does not mean that a new accounting journal was created or posted.

Canonical void/reopen:

```text
approved -> unmatched
```

### 1.4 Settlement lifecycle

Approval:

```text
settlement.status = posted
        ->
settlement.status = reconciled
```

and:

```text
bank_mutation_id = mutation.id
reconciled_at = now()
reconciled_by = actor
```

Void/reopen:

```text
reconciled -> posted
bank_mutation_id -> NULL
reconciled_at -> NULL
reconciled_by -> NULL
```

The settlement journal remains `posted` in both operations.

### 1.5 Accounting boundary

Canonical reconciliation is **LINK-ONLY**. It MUST NOT:

- create a payment, revenue, PPN, MDR, or settlement journal;
- approve or post the existing settlement journal;
- reverse the existing settlement journal;
- recalculate gross, MDR, fees, adjustment, or net amount.

### 1.6 Generic posting boundary

```text
CANONICAL_USES_GENERIC_POST = NO
```

Canonical candidates MUST NOT enter:

```text
POST /api/bank-reconciliation/:mutationId/post
```

Legacy and other generic candidates retain their current workflow.

---

## 2. Audited actual schema and namespace boundary

The actual match table used by the current generic API path is:

```text
public.bank_reconciliation_matches
```

Its current match identity is only:

```text
mutation_id
candidate_type
candidate_id
```

The minimum additive schema change is therefore:

```text
candidate_source TEXT NULL
```

It remains nullable because historical rows may have no reliable provenance.
There is no safe complete historical backfill to justify `NOT NULL`.

The canonical source tables are separate:

```text
sport_center.payment_settlement_batches
sport_center.payment_settlement_items
sport_center.sport_payments
sport_center.expected_bank_settlements
sport_center.bank_mutations
```

The legacy source tables are:

```text
public.qris_settlements
public.qris_settlement_items
public.bank_mutations
```

The canonical batch eligibility contract is:

```sql
batch.status = 'posted'
AND batch.bank_mutation_id IS NULL
AND batch.settlement_journal_id IS NOT NULL
AND settlement_journal.status = 'posted'
AND settlement_journal.journal_type = 'settlement'
AND settlement_journal.is_reversal = false
```

The existing source contains public/legacy QRIS adapters, but no canonical
`sport_center.payment_settlement_batches` adapter in the generic matching path.

### 2.1 DDL specification — not to execute in this phase

The first migration should add the nullable column to the actual match table:

```sql
ALTER TABLE public.bank_reconciliation_matches
  ADD COLUMN candidate_source TEXT;
```

The migration MUST:

- be additive;
- preserve all historical rows;
- not infer values for `NULL` rows;
- not copy canonical rows into `public.qris_settlements`;
- not rename or offset IDs.

The exact index names and predicates must be checked against the live Supabase
development schema immediately before implementation. The specifications below
are logical requirements, not executed migration names.

---

## 3. Source-aware candidate contract

### 3.1 Internal candidate shape

All candidate objects crossing matching, persistence, approval, audit, API, and
UI boundaries must carry:

```ts
type ReconciliationCandidateSource =
  | "public.qris_settlements"
  | "sport_center.payment_settlement_batches";

interface SourceAwareCandidateIdentity {
  candidateType: string;
  candidateId: number;
  candidateSource: ReconciliationCandidateSource;
}
```

For persisted SQL/API compatibility, the field name is:

```text
candidate_source
```

The canonical source adapter must never return an unqualified
`qris_settlement` candidate.

### 3.2 Historical resolution rule

For a historical row with `candidate_source IS NULL`:

1. read and display the row;
2. do not silently assign a source;
3. attempt resolution only from explicit, deterministic evidence;
4. if both sources are possible or no source is provable, return a controlled
   source-ambiguous error;
5. do not approve or reuse a journal from that row.

Suggested controlled code:

```text
RECONCILIATION_SOURCE_REQUIRED
```

### 3.3 Candidate source must be end-to-end

The following operations must use all three identity fields:

- candidate deduplication;
- approved-match lookup;
- historical matching;
- journal reuse lookup;
- approval;
- void/reopen;
- audit metadata;
- API response;
- UI selection payload;
- Sheet writeback display;
- allocation/manual reconciliation paths where QRIS candidates are accepted.

---

## 4. Exact Phase 4C implementation slices

Each slice is independently reviewable and testable. Do not combine all slices
into one uncontrolled patch.

### 4C-1 — `candidate_source` persistence

**Actual files:**

- `artifacts/api-server/src/routes/bankReconciliation.ts`
- `artifacts/api-server/src/lib/reconciliation/qrisSettlementMigration.ts`
- `artifacts/api-server/src/lib/accountingMigration.ts` only if the actual
  match-table migration ownership is located there during implementation

**Functions/areas:**

- `runBankReconciliationCoreMigration`
- all `INSERT INTO bank_reconciliation_matches` statements
- all `UPDATE bank_reconciliation_matches` statements that create an approved
  identity
- legacy QRIS candidate persistence in the QRIS routes

**Required behavior:**

- add nullable `candidate_source`;
- write `public.qris_settlements` for new legacy QRIS rows;
- write `sport_center.payment_settlement_batches` for new canonical rows;
- preserve `NULL` historical values.

### 4C-2 — Source-aware identity and resolution

**Actual files:**

- `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts`
- `artifacts/api-server/src/lib/reconciliation/erpDocumentMatcher.ts`
- `artifacts/api-server/src/lib/reconciliation/historicalMatchingEngine.ts`
- `artifacts/api-server/src/lib/reconciliation/journalReuseEngine.ts`
- `artifacts/api-server/src/routes/cashBank.ts`
- `artifacts/api-server/src/lib/sheetSyncService.ts`

**Functions/areas:**

- `canonicalCandidateType`
- `fetchCandidates`
- `runUnifiedMatching`
- `fetchAlreadyReconciled` in `erpDocumentMatcher.ts`
- `fetchApprovedHistory`
- `runHistoricalMatching`
- `resolveJournalForEconomicEvent`
- `lookupExistingEntry`
- manual reconciliation upsert in `cashBank.ts`
- approved candidate reads in `sheetSyncService.ts`

**Required behavior:**

- replace two-part candidate keys with source-aware keys for new behavior;
- keep historical NULL rows readable;
- fail closed when source is required but ambiguous;
- do not let a legacy row with the same numeric ID resolve to the canonical
  table or vice versa.

### 4C-3 — Canonical settlement adapter

**New focused module recommended:**

```text
artifacts/api-server/src/lib/reconciliation/canonicalSettlementAdapter.ts
```

**Required functions:**

```ts
findCanonicalSettlementCandidates(...)
getCanonicalSettlementForReconciliation(...)
assertCanonicalSettlementEligibility(...)
```

**Data source:**

- read `sport_center.expected_bank_settlements`, or call the read-only
  `sport_center.find_settlement_bank_candidates(...)`;
- lock/read `sport_center.payment_settlement_batches` during approval;
- join the settlement journal for final eligibility.

**Required output:**

```text
candidate_type   = qris_settlement
candidate_id     = payment_settlement_batches.id
candidate_source = sport_center.payment_settlement_batches
```

The adapter must be read-only during candidate generation.

### 4C-4 — Payment exclusion

**Actual files:**

- `artifacts/api-server/src/lib/reconciliation/canonicalSettlementAdapter.ts`
- `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts`
- `artifacts/api-server/src/lib/reconciliation/erpDocumentMatcher.ts`
- canonical approval transaction module

**Required predicate:**

An individual `sport_payment` is excluded when it belongs to an active
canonical settlement item whose parent status is `posted` or `reconciled`.

Apply the predicate twice:

1. candidate generation;
2. approval-time revalidation under lock.

UI filtering is not sufficient.

### 4C-5 — Canonical candidate matching

**Actual files:**

- `artifacts/api-server/src/lib/reconciliation/canonicalSettlementAdapter.ts`
- `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts`
- `artifacts/api-server/src/routes/bankReconciliation.ts`

**Functions/areas:**

- `fetchCandidates`
- `scoreUnified`
- `classifyMatch`
- `runUnifiedMatching`
- `/run-matching`

**Required behavior:**

- use canonical `net_amount` for matching;
- enforce date, company, bank account, provider, and incoming-direction checks;
- accept only eligible canonical batches;
- persist the source-qualified candidate;
- keep legacy public QRIS matching unchanged;
- do not treat a canonical batch as a `sport_payment` candidate.

### 4C-6 — Link-only approval

**New focused module recommended:**

```text
artifacts/api-server/src/lib/reconciliation/canonicalSettlementApproval.ts
```

**Required functions:**

```ts
approveCanonicalSettlementLink(...)
assertCanonicalApprovalEligibility(...)
```

**Route integration:**

- `artifacts/api-server/src/routes/bankReconciliation.ts`
- source-aware branch from `POST /:mutationId/approve`, or a dedicated
  canonical approval route that cannot enter generic journal creation

**Atomic contract:**

```text
BEGIN
LOCK bank mutation
LOCK source-aware match
LOCK canonical settlement

verify candidate_source = sport_center.payment_settlement_batches
verify batch.status = posted
verify batch.bank_mutation_id IS NULL
verify settlement journal exists and is posted
verify journal_type = settlement
verify is_reversal = false
verify mutation has no other approved match
verify settlement has no other approved match
verify underlying payments are not independently approved

UPDATE batch:
  status = reconciled
  bank_mutation_id = mutation.id
  reconciled_at = now()
  reconciled_by = actor

UPDATE match:
  status = approved

UPDATE canonical bank mutation:
  status = approved

WRITE reconciliation audit
COMMIT
```

No call to:

- `approveAndCreateJournal`;
- `resolveJournalForEconomicEvent` for journal creation/reuse;
- `postEntryWithClient`;
- generic `/post`.

### 4C-7 — Generic `/post` protection

**Actual files:**

- `artifacts/api-server/src/routes/bankReconciliation.ts`
- `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts`

**Functions/areas:**

- `POST /:mutationId/post`
- `approveAndCreateJournal`

**Required guard:**

Before any journal lookup or promotion, resolve the selected source-aware
match. If:

```text
candidate_source = sport_center.payment_settlement_batches
```

return a controlled conflict:

```text
CANONICAL_SETTLEMENT_ALREADY_ACCOUNTED
```

The guard must be fail-closed. It must not silently fall through to generic
journal reuse.

### 4C-8 — Canonical void/reopen

**New focused module recommended:**

```text
artifacts/api-server/src/lib/reconciliation/canonicalSettlementVoid.ts
```

**Required function:**

```ts
voidCanonicalSettlementLink(...)
```

**Route integration:**

- `artifacts/api-server/src/routes/bankReconciliation.ts`
- do not reuse generic `/:mutationId/void-journal`
- do not create a reversal journal

**Atomic contract:**

```text
BEGIN
LOCK mutation
LOCK canonical settlement
LOCK approved source-aware match

verify candidate_source = sport_center.payment_settlement_batches
verify batch.status = reconciled
verify batch.bank_mutation_id = mutation.id

UPDATE batch:
  status = posted
  bank_mutation_id = NULL
  reconciled_at = NULL
  reconciled_by = NULL

UPDATE match using existing safe void/reopen representation
UPDATE mutation:
  status = unmatched

WRITE audit
COMMIT
```

The posted settlement journal remains unchanged.

### 4C-9 — UI/API source awareness

**Actual files:**

- `artifacts/api-server/src/routes/bankReconciliation.ts`
- `artifacts/api-server/src/routes/cashBank.ts`
- `artifacts/bizportal/src/pages/accounting/bank-reconciliation.tsx`
- any shared API/type module used by BizPortal

**Required behavior:**

- return `candidate_source` in candidate payloads;
- show canonical vs legacy source in the UI;
- submit source-qualified identity on approval;
- hide generic “Post Accounting” for canonical candidates;
- show canonical lifecycle (`posted`, `reconciled`);
- expose controlled errors for source ambiguity and already-accounted
  canonical settlements.

The Google Sheet ingestion path remains unchanged:

```text
Google Sheet -> bank mutation
```

It must not create settlement records.

### 4C-10 — Duplicate and concurrency protection

**Actual/new files:**

- canonical approval module;
- canonical void module;
- database migration owned by the project’s existing migration mechanism;
- `artifacts/api-server/src/lib/reconciliation/qrisSettlementMigration.ts`
  only for legacy QRIS constraints that are already owned there

**Required database protections:**

1. Preserve one approved match per mutation.
2. Add source-aware candidate identity protection where appropriate:

```text
(mutation_id, candidate_type, candidate_id, candidate_source)
```

3. Protect one canonical settlement per mutation:

```text
UNIQUE (bank_mutation_id)
WHERE bank_mutation_id IS NOT NULL
```

4. Retain the canonical payment active-item uniqueness invariant.
5. Enforce cross-table payment/settlement overlap through transaction locks
   and approval revalidation when an index cannot enforce it.

All approval locks must be acquired in a stable order to avoid deadlocks.
PostgreSQL unique violations remain the final concurrency backstop and must
return a controlled conflict rather than a false success.

### 4C-11 — Regression tests

**Actual test area:**

```text
artifacts/api-server/src/__tests__/
```

**New focused test file recommended:**

```text
artifacts/api-server/src/__tests__/canonical-settlement-reconciliation.test.ts
```

Preserve and rerun:

- `qris-settlement.test.ts`;
- `qris-provider-reconciliation.test.ts`;
- `phase4-erp-document-matching.test.ts`;
- `historical-matching-integration.test.ts`;
- `recon-batch2.test.ts`;
- other invoice, expense, logistic-order, and bank reconciliation tests.

### 4C-12 — Runtime proof

Runtime proof must use the Supabase development database containing the
canonical `sport_center` schema. The empty/unrelated Replit development
database is not sufficient evidence for canonical behavior.

Proof must be read-only for setup inspection, then use isolated fixture
transactions/rows in the approved development environment only. No production
database may be touched.

---

## 5. Database change specification

The following is the required future shape, not an executed migration.

### 5.1 Match table

Add:

```text
public.bank_reconciliation_matches.candidate_source TEXT NULL
```

Compatibility rules:

- historical rows may remain NULL;
- new canonical rows require the canonical source;
- new legacy QRIS rows require the legacy source;
- source omission on a new QRIS row is a validation error.

### 5.2 Approved-match uniqueness

Preserve the existing logical protection:

```sql
UNIQUE (mutation_id)
WHERE status = 'approved'
```

The implementation must verify whether the live index already exists before
creating an equivalent index.

### 5.3 Source-aware candidate duplication

Prevent duplicate active candidate identity using:

```text
(mutation_id, candidate_type, candidate_id, candidate_source)
```

Historical NULL rows must not be rewritten solely to satisfy this new index.
The exact NULL behavior must be selected after live schema inspection.

### 5.4 Canonical settlement-to-mutation uniqueness

Protect:

```text
sport_center.payment_settlement_batches.bank_mutation_id
```

with a unique non-null constraint/index. The approval transaction must still
lock and recheck both rows because uniqueness alone does not validate status,
journal, company, date, amount, or source.

### 5.5 Payment/settlement overlap

The active canonical item invariant remains authoritative:

```text
one active payment -> at most one active canonical settlement item
```

Approval must additionally reject a `sport_payment` candidate when its payment
is present in an active item belonging to a `posted` or `reconciled` batch.

---

## 6. Approval and void API contract

### 6.1 Canonical approval response

Successful approval should return a source-qualified result similar to:

```json
{
  "ok": true,
  "candidate_type": "qris_settlement",
  "candidate_id": 1,
  "candidate_source": "sport_center.payment_settlement_batches",
  "mutation_id": 123,
  "settlement_status": "reconciled",
  "bank_mutation_status": "approved",
  "journal_created": false
}
```

### 6.2 Generic post rejection

When a canonical candidate reaches generic `/post`:

```text
HTTP 409
code = CANONICAL_SETTLEMENT_ALREADY_ACCOUNTED
```

The response must state that the settlement is already accounted and that
approval is link-only.

### 6.3 Source ambiguity

For a historical or tampered candidate without sufficient source identity:

```text
HTTP 409 or 422
code = RECONCILIATION_SOURCE_REQUIRED
```

The operation must have no financial or link side effect.

### 6.4 Canonical void response

Successful void should expose:

```json
{
  "ok": true,
  "candidate_source": "sport_center.payment_settlement_batches",
  "settlement_status": "posted",
  "bank_mutation_status": "unmatched",
  "bank_mutation_id": null,
  "journal_reversed": false
}
```

---

## 7. Required test matrix

### 7.1 Exact settlement candidate

Fixture:

```text
gross = 100000
MDR = 300
net = 99700
mutation = 99700
direction = IN
settlement.status = posted
journal.status = posted
```

Expected:

```text
canonical candidate generated
candidate_type = qris_settlement
candidate_source = sport_center.payment_settlement_batches
```

### 7.2 Candidate collision

Fixtures:

```text
public.qris_settlements.id = 1
sport_center.payment_settlement_batches.id = 1
```

Expected:

```text
legacy resolves to public.qris_settlements
canonical resolves to sport_center.payment_settlement_batches
no cross-source overwrite
```

### 7.3 Historical NULL source

Expected:

```text
row remains readable
no automatic backfill
ambiguous approval rejected safely
no journal or link mutation
```

### 7.4 Eligibility rejection

Reject canonical candidates when any condition fails:

- batch status is not `posted`;
- `bank_mutation_id` is not NULL;
- settlement journal is absent;
- journal is not `posted`;
- journal type is not `settlement`;
- journal is a reversal;
- amount/date/company/account/provider checks fail.

### 7.5 Payment exclusion

An underlying payment in an active `posted` or `reconciled` canonical batch:

```text
must not appear as an individual sport_payment candidate
```

The same condition must be rejected again at approval time.

### 7.6 Double approval

Same canonical settlement against a second mutation:

```text
reject
settlement remains linked to first mutation
no second approved match
no journal created
```

### 7.7 Mutation reuse

Same mutation against a second canonical settlement:

```text
reject
mutation remains linked to first settlement
```

### 7.8 Concurrent approval

Run two approvals concurrently for the same settlement or mutation:

```text
exactly one commits
one loses by lock/unique guard
losing request returns controlled conflict
no partial settlement link
```

### 7.9 Accounting protection

Before/after canonical approval:

```text
accounting journal count before = N
accounting journal count after  = N
```

The existing settlement journal remains posted and unchanged.

### 7.10 Generic `/post` protection

Submit canonical candidate to generic `/post`:

```text
request rejected
code = CANONICAL_SETTLEMENT_ALREADY_ACCOUNTED
journal count unchanged
mutation and settlement unchanged
```

### 7.11 Canonical void

Expected:

```text
settlement reconciled -> posted
bank_mutation_id -> NULL
mutation approved -> unmatched
settlement journal remains posted
no reversal journal
```

### 7.12 Legacy regression

Verify that legacy public QRIS:

- remains discoverable;
- persists `candidate_source = public.qris_settlements` for new rows;
- continues through its existing generic workflow;
- does not resolve to canonical tables.

### 7.13 Other reconciliation regression

Verify unchanged behavior for:

- invoice;
- expense;
- logistic order;
- accounting payment;
- tenant invoice;
- manual bank matching;
- Sheet import/writeback.

---

## 8. Runtime verification plan

### 8.1 Preflight

Before implementation tests:

1. Confirm API build/typecheck.
2. Confirm exactly one active QRIS candidate approval route exists in
   `bankReconciliation.ts`; commented historical fragments must not be active.
3. Inspect live Supabase development schema:
   - exact match table;
   - existing columns;
   - existing indexes;
   - existing constraints;
   - canonical table/function definitions.
4. Confirm the API is pointed at the development database.
5. Confirm no production database or production workflow is used.

### 8.2 Fixture proof

Use an isolated company and deterministic fixtures:

```text
canonical batch:
  gross_amount = 100000
  mdr_amount = 300
  net_amount = 99700
  status = posted
  settlement journal = posted settlement journal
  bank_mutation_id = NULL

bank mutation:
  direction = IN
  amount = 99700
  matching company/account/provider/date
```

Create a collision fixture with the same numeric ID in the public legacy
namespace only if the database sequence/fixture setup safely permits it.
Otherwise use mocked/read adapter fixtures that prove source identity without
altering unrelated records.

### 8.3 Proof assertions

Record before/after values for:

- settlement status;
- settlement bank mutation link;
- reconciliation match status/source;
- bank mutation status;
- settlement journal status and ID;
- accounting journal count;
- audit rows;
- underlying payment candidate visibility.

### 8.4 Concurrency proof

Run concurrent approval and concurrent void/reopen requests against isolated
fixtures. Confirm that lock ordering and unique constraints produce exactly one
winner and no partial commit.

### 8.5 Cleanup

Use transaction rollback or guarded fixture cleanup. Posted accounting entries
must never be deleted as cleanup. If a test creates posted entries, isolate
the test company/period and preserve the audit trail.

---

## 9. Implementation sequence

The approved sequence is:

```text
4C-1 candidate_source persistence
  ->
4C-2 source-aware identity/resolution
  ->
4C-3 canonical settlement adapter
  ->
4C-4 payment exclusion
  ->
4C-5 canonical candidate matching
  ->
4C-6 link-only approval
  ->
4C-7 generic /post protection
  ->
4C-8 canonical void/reopen
  ->
4C-9 UI/API source awareness
  ->
4C-10 duplicate/concurrency protection
  ->
4C-11 regression tests
  ->
4C-12 runtime proof
```

Recommended checkpoints:

1. After 4C-1 to validate schema and legacy compatibility.
2. After 4C-3 to validate read-only canonical candidate generation.
3. After 4C-6 to validate link-only approval with journal count unchanged.
4. After 4C-8 to validate the accounting-safe inverse.
5. After 4C-12 before any publish/deployment consideration.

No slice may enable canonical final reconciliation before source identity,
eligibility, locking, and journal-count tests pass.

---

## 10. Rollback strategy

### 10.1 Before runtime data writes

Rollback source changes through the normal checkpoint/revert mechanism. The
nullable `candidate_source` column is additive and historical NULL rows remain
valid.

### 10.2 After schema migration

Do not drop `candidate_source` automatically. First stop new source-aware
writes, preserve the column/data, and investigate any rows written by the new
path. A destructive rollback is not permitted without explicit review because
it can remove provenance needed to distinguish canonical and legacy IDs.

### 10.3 After canonical link approvals

Use the canonical void/reopen transaction to restore:

```text
settlement.status = posted
bank_mutation_id = NULL
bank mutation.status = unmatched
```

Do not delete settlement rows or reverse the settlement journal as a rollback
mechanism.

### 10.4 If generic path regression occurs

Disable only canonical candidate exposure/approval through a feature gate or
route guard. Keep legacy public QRIS and other reconciliation types available.
Do not globally disable:

```text
public.qris_settlements
public.qris_settlement_items
qrisCandidateEngine
legacy QRIS reconciliation
```

### 10.5 Deployment boundary

Do not publish until:

- source-aware collision tests pass;
- canonical approval proves zero new journals;
- generic `/post` rejects canonical candidates;
- void/reopen preserves the posted settlement journal;
- legacy and non-QRIS regressions pass;
- runtime proof has been recorded against Supabase development.

---

## 11. Final readiness decision

The business policy is fully frozen:

```text
CANONICAL_APPROVAL_BANK_MUTATION_STATUS = approved
CANONICAL_VOID_BANK_MUTATION_STATUS = unmatched
CANONICAL_USES_GENERIC_POST = NO
```

The technical implementation specification is complete and identifies the
actual repository boundaries and required runtime proof.

```text
POLICY FROZEN — READY FOR PHASE 4C-1
```

---

## Change confirmation

```text
Source implementation changes: 0
Database changes: 0
Reconciliation changes: 0
Triggers changed: 0
Functions changed: 0
Migrations created: 0
Production touched: 0
```