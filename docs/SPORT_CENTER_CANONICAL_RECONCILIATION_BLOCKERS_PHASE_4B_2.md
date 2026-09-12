# Phase 4B-2 — Final Canonical Reconciliation Blocker Audit

Status dokumen: discovery, read-only, contract freeze  
Database evidence: Supabase development, project ref `xssrfshdrtdfupgqwfdw`  
Audit date: 2026-08-10  
Source instruction: `attached_assets/Pasted--PHASE-4B-2-RESOLVE-FINAL-CANONICAL-RECONCILIATION-BLOC_1786384713728.txt`

> This report records the result of the Phase 4B-2 read-only audit. It does
> not create a migration, alter a table, execute a write function, change a
> reconciliation route, or modify production.

## Final verdict

```text
FINAL CONTRACT PARTIAL — DO NOT IMPLEMENT
```

The canonical-versus-legacy identity contract can be frozen as a proposed
minimum extension, but the canonical `sport_center.bank_mutations` lifecycle
does not have a verified reconciliation state-transition contract. The
canonical link-only approval and its inverse therefore remain blocked.

---

## 1. Audit target and namespace boundary

The audit confirmed that two different reconciliation namespaces exist:

```text
Generic / legacy application path:
  public.bank_mutations
  public.bank_reconciliation_matches
  public.qris_settlements

Canonical Sport Center path:
  sport_center.bank_mutations
  sport_center.bank_reconciliation_matches
  sport_center.payment_settlement_batches
  sport_center.payment_settlement_items
```

The application source generally uses unqualified table names and therefore
resolves the generic `public` path. The canonical settlement functions are
explicitly schema-qualified and use `sport_center`.

This distinction is material: a discriminator added only to one namespace
would not automatically make the other namespace safe.

---

## 2. Blocker 1 — candidate identity collision

### 2.1 Actual match schema

`public.bank_reconciliation_matches` contains:

```text
id
mutation_id
candidate_type
candidate_id
match_score
match_reason
amount_match
date_match
name_match
order_id_match
proof_match
status
created_at
customer_name
order_ref
```

The table has no:

```text
candidate_source
source_schema
source_table
source_type
metadata
match_metadata
details
raw_payload
```

Its only candidate identity is therefore:

```text
candidate_type + candidate_id
```

`public.bank_allocation_matches` has the same unqualified candidate identity
shape. `sport_center.bank_reconciliation_matches` also has only
`candidate_type + candidate_id`; its `candidate_type` is the
`sport_center.recon_candidate_type` enum, not a source discriminator.

The `raw_payload`, `source_schema`, `source_table`, and `source_id` fields
found on bank mutation rows are provenance fields for the mutation. They are
not fields on the reconciliation match identity and cannot resolve a
candidate collision by themselves.

### 2.2 Repository consumer audit

The following consumers were traced:

| Area | Source | Current assumption / risk |
|---|---|---|
| Candidate persistence and auto-selection | `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts` | Inserts and updates matches using only `candidate_type` and `candidate_id`. |
| Legacy ERP candidate discovery | `artifacts/api-server/src/lib/reconciliation/erpDocumentMatcher.ts` | Maps `qris_settlements` to `qris_settlement`; deduplicates with a two-part key. |
| Historical matching | `artifacts/api-server/src/lib/reconciliation/historicalMatchingEngine.ts` | Reads approved history and groups by candidate type/id only. |
| Journal reuse | `artifacts/api-server/src/lib/reconciliation/journalReuseEngine.ts` | Resolves `qris_settlement` to `accounting_entries.source_id` without a source namespace. |
| Generic approval, posting, and unapproval | `artifacts/api-server/src/routes/bankReconciliation.ts` | Reads the match row, approves it, creates/reuses a generic journal, posts, or unapproves using the two-part identity. |
| Generic allocation matching | `artifacts/api-server/src/routes/bankAllocationMatching.ts` | Uses `(bank_mutation_id, candidate_type, candidate_id)` as the candidate key. |
| Cash-bank reconciliation alias | `artifacts/api-server/src/routes/cashBank.ts` | Upserts generic matches without a source discriminator. |
| Sheet synchronization | `artifacts/api-server/src/lib/sheetSyncService.ts` | Detects approved candidates by candidate type/id. |
| API/UI contract | `artifacts/bizportal/src/pages/accounting/bank-reconciliation.tsx` | Candidate type/id are the displayed and submitted identity. |
| Legacy QRIS migration and service | `artifacts/api-server/src/lib/reconciliation/qrisSettlementMigration.ts`, `qrisCandidateService.ts`, `qrisSettlement.ts` | Operates on `public.qris_settlements`. |
| Tests | `artifacts/api-server/src/__tests__/qris-settlement.test.ts`, `phase4-erp-document-matching.test.ts`, `historical-matching-integration.test.ts` | Exercise the legacy candidate contract. |

The current source does not contain a canonical
`sport_center.payment_settlement_batches` adapter in the generic matching
path.

### 2.3 Minimum safe discriminator

No reliable existing match-level discriminator was found. The minimum safe
extension is:

```text
candidate_source TEXT
```

Frozen values:

```text
candidate_type   = qris_settlement
candidate_id     = <legacy settlement id>
candidate_source = public.qris_settlements
```

```text
candidate_type   = qris_settlement
candidate_id     = <canonical settlement id>
candidate_source = sport_center.payment_settlement_batches
```

The complete identity is:

```text
candidate_type + candidate_id + candidate_source
```

Candidate resolution, matching deduplication, approval, posting, void,
historical matching, journal reuse, audit metadata, API response, and UI
payloads must use all three fields.

The following solutions are explicitly rejected:

```text
negative IDs
ID offsets
encoding schema into candidate_id
copying canonical settlements into public.qris_settlements
renumbering canonical IDs
renaming the canonical table
```

**Blocker 1 result:** the identity contract is resolved at the design level,
but the required schema/API implementation has not been made in this
read-only phase.

---

## 3. Blocker 2 — bank mutation lifecycle ownership

### 3.1 Actual canonical bank mutation schema

`sport_center.bank_mutations.status` is the user-defined enum:

```text
sport_center.bank_mutation_status
```

Allowed values observed from the runtime enum:

```text
unmatched
matched
duplicate_need_review
approved
rejected
auto_matched
need_review
```

The canonical table also contains:

```text
matched_payment_id integer NULL
matched_order_id integer NULL
accounting_posted boolean NOT NULL DEFAULT false
journal_id text NULL
approved_by text NULL
approved_at timestamptz NULL
source text NULL
source_schema text NULL
source_table text NULL
source_id text NULL
provenance jsonb NULL
```

The table has a primary key and status/date indexes, but no status transition
trigger or check constraint that defines canonical settlement reconciliation
ownership. The observed development rows were `auto_matched`; no
canonical settlement link was present during this audit.

Important absence:

```text
no reconciled value in bank_mutation_status
no posted value in bank_mutation_status
no settlement-specific mutation status
no canonical mutation-to-settlement audit state
```

### 3.2 Generic application state flow

The generic `public` flow in the repository is different from the canonical
CST enum:

| Step | `public.bank_mutations.status` | `public.bank_reconciliation_matches.status` | Journal |
|---|---|---|---|
| Imported | `unmatched` | none | none |
| Matching | `matched` | `candidate`, then selected `approved` for auto-match | none |
| Approval | `approved` | `approved` | draft or reused existing entry |
| Posting | `posted` | `approved` | journal becomes `posted` |
| Unapprove | `matched` | selected match reset/deleted by route behavior | draft journal is handled by generic path |
| Generic void | `void` | existing generic row remains part of generic flow | reversal journal is created; original is voided |

The generic route contains references to
`approved_pending_posting`, `posted`, and `void`, but those are text values
on the public application table. They are not values in the canonical
`sport_center.bank_mutation_status` enum.

The generic flow also creates or reuses accounting entries during approval.
That behavior is forbidden for canonical settlement reconciliation because the
canonical settlement journal already exists and is posted.

### 3.3 Canonical settlement lifecycle evidence

The canonical settlement batch allows:

```text
draft
calculated
posted
reconciled
reversed
voided
```

The runtime canonical functions prove:

```text
find_settlement_bank_candidates:
  STABLE
  SECURITY DEFINER
  read-only
  accepts settlement status posted or reconciled
  checks date, incoming direction, amount, company, bank account, provider

finalize_payment_settlement:
  verifies the settlement journal is posted
  then changes the settlement batch to posted
```

The canonical batch has:

```text
FOREIGN KEY (bank_mutation_id)
  REFERENCES sport_center.bank_mutations(id)
  ON DELETE RESTRICT
```

and an index on `bank_mutation_id`, but no unique partial index or unique
constraint on that column.

The canonical batch observed in development was:

```text
id:                 1
status:             posted
settlement_journal_id: 10
bank_mutation_id:   NULL
gross_amount:       100000.00
mdr_amount:         300.00
net_amount:         99700.00
```

### 3.4 Approval and `/post` decision

The safe canonical accounting decision is:

```text
Option A — approval is final reconciliation

approve
  -> link bank mutation
  -> settlement posted -> reconciled
  -> no generic /post
  -> zero new journals
```

Reason:

```text
canonical settlement journal is already posted
canonical finder only accepts posted/reconciled settlements
generic approval would create or reuse the wrong accounting journal path
canonical settlement reconciliation is a link operation, not accounting posting
```

Therefore canonical settlement must not use generic:

```text
POST /bank-reconciliation/:id/post
```

The existing generic `/post` route is bound to the public mutation and
generic journal state machine. It cannot be reused for canonical settlement
link-only approval without a separate source-aware adapter and guard.

### 3.5 Bank mutation status ownership result

The enum contains `matched`, which is the only existing CST value that
semantically describes a successful reconciliation link. However, the audit
could not verify an existing CST transition that says:

```text
canonical link approval: <prior status> -> matched
canonical link void: matched -> <prior status>
```

No repository path owns this canonical transition, and the runtime schema has
no trigger or function that defines it. Choosing `matched` on approval and
`unmatched` on void would be a new policy, not a verified existing CST
contract. Choosing `approved` would incorrectly conflate canonical link
approval with the generic accounting approval state.

**Blocker 2 result:** unresolved. Status ownership must be explicitly approved
as a CST business contract before implementation.

---

## 4. Proposed canonical link-only contract

This is the minimum safe transaction shape, not an implementation:

```text
BEGIN

lock sport_center.bank_mutations row
lock sport_center.payment_settlement_batches row

verify:
  settlement.status = posted
  settlement.settlement_journal_id IS NOT NULL
  settlement journal.status = posted
  settlement journal.type = settlement
  settlement journal.is_reversal = false
  settlement.bank_mutation_id IS NULL
  mutation is not linked to another active canonical settlement
  candidate identity includes candidate_source
  amount/date/company/bank-account/provider checks still pass

link:
  settlement.bank_mutation_id = mutation.id
  settlement.status = reconciled
  settlement.reconciled_at = now()
  settlement.reconciled_by = actor

write source-aware match/audit record
update bank_mutation using the separately approved CST status policy

COMMIT
```

The operation must not:

```text
create a journal
approve a settlement journal
post a settlement journal
recalculate MDR
recalculate revenue
reverse the settlement journal
```

### Void

The accounting-safe inverse remains:

```text
settlement:       reconciled -> posted
bank_mutation_id: mutation.id -> NULL
settlement journal: remains posted
```

The bank mutation status after void is blocked until its pre-state and
ownership policy are frozen. The implementation must preserve or explicitly
restore the approved prior CST state; it must not blindly use the generic
`void` status because that status does not exist in the canonical enum.

---

## 5. Duplicate invariant audit

| Invariant | Existing protection | Missing protection / required guard |
|---|---|---|
| One canonical settlement has at most one bank mutation | Scalar `payment_settlement_batches.bank_mutation_id` | Application row lock and `IS NULL` recheck are still required. |
| One bank mutation has at most one canonical settlement | Foreign key plus non-unique index only | Missing unique partial protection on `bank_mutation_id`; transaction lock and a database uniqueness guard are required in Phase 4C. |
| One mutation has at most one approved generic match | `public.brm_approved_mutation_unique` on `mutation_id WHERE status='approved'` | Applies only to public generic matches, not canonical Sport Center matches. |
| One mutation has at most one canonical approved/reconciled match | No unique canonical match index; only candidate, mutation, and status indexes | Missing DB-level invariant and source-aware transaction guard. |
| Payment inside posted/reconciled settlement is not an active individual candidate | Active settlement-item uniqueness and settlement-item status predicates | Canonical adapter must apply the predicate before exposing individual payment candidates. |

Required transaction guards:

```text
lock mutation
lock settlement
lock source-aware match row
recheck both link columns under lock
recheck settlement journal status
recheck duplicate active canonical link
recheck payment exclusion
```

---

## 6. Minimum change matrix for Phase 4C

No changes below were made in Phase 4B-2.

| Area | Minimum required change | Reason |
|---|---|---|
| DATABASE | Add `candidate_source` (or an equivalent fully-qualified source identity) to the match persistence contract; add a uniqueness protection for active canonical settlement links; add any required audit fields only after ownership is approved. | Prevent ID collision and concurrent double-linking. |
| API | Add canonical candidate response fields and source-aware approval/void endpoints or a source-aware branch that cannot enter generic journal posting. | Keep canonical operations separate from legacy accounting behavior. |
| MATCHING | Add a read-only adapter for `sport_center.expected_bank_settlements` / `find_settlement_bank_candidates`; carry `candidate_source` end-to-end. | Canonical settlement is not a legacy `public.qris_settlements` row. |
| APPROVAL | Implement lock/recheck/link-only approval; freeze the bank mutation status policy first. | Approval must reconcile without creating a journal. |
| POSTING | Do not invoke generic `/post` for canonical candidates; document and enforce zero new journals. | Canonical journal is already posted. |
| VOID | Implement `reconciled -> posted` and unlink; preserve the posted settlement journal; restore the approved mutation pre-state according to the frozen CST policy. | Avoid generic journal reversal and ambiguous mutation state. |
| UI | Display source-qualified candidate identity and canonical lifecycle; do not offer generic “Post Accounting” for canonical candidates. | Prevent an operator from selecting the wrong source or action. |
| TYPES | Extend API/Zod/TypeScript candidate types with `candidate_source` and canonical lifecycle fields. | Make source omission a type-level/API contract failure. |
| TESTS | Add collision, concurrent approval, canonical link-only, no-new-journal, void, and payment-exclusion tests against development runtime. | Prove the new cross-namespace invariants. |

---

## 7. Final contract matrix

| Contract | Result |
|---|---|
| Candidate discriminator | VERIFIED as the minimum contract extension: `candidate_source` |
| Canonical candidate identity | VERIFIED as `(qris_settlement, id, sport_center.payment_settlement_batches)` |
| Legacy candidate identity | VERIFIED as `(qris_settlement, id, public.qris_settlements)` |
| Bank mutation approval status | BLOCKED — no verified CST transition owner |
| Canonical `/post` behavior | VERIFIED — skip generic `/post`; approval is link-only |
| Void mutation status | BLOCKED — depends on unresolved pre-state/status ownership |
| Settlement status transition | VERIFIED — `posted -> reconciled`, inverse `reconciled -> posted` |
| Duplicate invariant | PARTIAL — application locks are defined conceptually; canonical DB uniqueness is missing |

Because unresolved rows remain, the contract is not ready for Phase 4C.

---

## Change confirmation

```text
Source changes: 0
Database changes: 0
Reconciliation changes: 0
Triggers changed: 0
Functions changed: 0
Migrations created: 0
Production touched: 0
```

STOP.