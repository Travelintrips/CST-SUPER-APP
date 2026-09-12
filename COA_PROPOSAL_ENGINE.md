# COA Proposal Engine — Task #7

## Arsitektur

### Pure Engines (Stateless, No DB Access)

| Engine | File | Phase |
|---|---|---|
| Gap Detector | `coaGapDetector.ts` | 2 |
| Proposal Recommendation | `coaProposalEngine.ts` | 6–7 |
| Code Suggester | `coaCodeSuggester.ts` | 8 |
| Parent Suggester | `coaParentSuggester.ts` | 9 |
| Impact Analysis | `coaProposalImpact.ts` | 10 |
| Duplicate Detector | `coaProposalDuplicate.ts` | 11 |

### Service Layer

| Service | File | Phase |
|---|---|---|
| Create Proposal | `coaProposalService.ts` | 12 |
| Submit/Review/Approve/Reject/Cancel | `coaProposalService.ts` | 13 |
| Implement (via Task #5) | `coaProposalService.ts` | 14 |

### DB Schema

| Table | File |
|---|---|
| `coa_proposals` | `lib/db/src/schema/coaProposals.ts` |
| `coa_proposal_versions` | `lib/db/src/schema/coaProposals.ts` |
| `coa_proposal_audit` | `lib/db/src/schema/coaProposals.ts` |

### API Routes

Mounted at `/api/accounting/coa-proposals` — file: `artifacts/api-server/src/routes/coaProposals.ts`

### UI

| Page | Route | File |
|---|---|---|
| List | `/accounting/coa-proposals` | `coa-proposals.tsx` |
| Detail | `/accounting/coa-proposals/:id` | `coa-proposal-detail.tsx` |

## Gap Detection Logic

1. Explicit Task #6 error code (SPECIFIC_COA_REQUIRED, etc.) → gap detected
2. No candidates → NO_SPECIFIC_ACCOUNT
3. All candidates inactive → INACTIVE_ACCOUNT_ONLY
4. All active but non-postable → NON_POSTABLE_ACCOUNT_ONLY
5. Multiple postable + COA_MAPPING_AMBIGUOUS → AMBIGUOUS_MAPPING
6. No history + mapping error → NO_SPECIFIC_ACCOUNT
7. Suitable postable exists → no gap

## Accounting Policy Rules

| Intent Pattern | Category | Normal Balance | Statement |
|---|---|---|---|
| PPh 21/23/26 | LIABILITY | CREDIT | BALANCE_SHEET |
| PPN Masukan | ASSET | DEBIT | BALANCE_SHEET |
| PPN Keluaran | LIABILITY | CREDIT | BALANCE_SHEET |
| Bea Materai | EXPENSE | DEBIT | PROFIT_AND_LOSS |
| Denda Pajak | OTHER_EXPENSE | DEBIT | PROFIT_AND_LOSS |
| Bank Fee | EXPENSE | DEBIT | PROFIT_AND_LOSS |
| Interest Income | OTHER_INCOME | CREDIT | PROFIT_AND_LOSS |
| Customer Payment | ASSET (AR/Clearing) | DEBIT | BALANCE_SHEET |
| Vendor Payment | LIABILITY (AP/Clearing) | CREDIT | BALANCE_SHEET |
| Internal Transfer | CLEARING | DEBIT | BALANCE_SHEET |

## Code Suggestion Algorithm

1. Find siblings under same parent (same company)
2. Extract dominant prefix pattern
3. Detect gap size (sequential vs spaced)
4. Suggest max+gapSize, avoid collisions
5. Returns `manualEditRequired=true` if pattern unclear

## Idempotency

- `idempotency_key` unique per company_id (DB constraint)
- `request_fingerprint` = deterministic hash of (companyId + intent + description + name + category)
- Duplicate check returns existing proposal ID instead of creating new

## Implementation Flow (Phase 14)

```
1. Lock proposal row
2. Verify status = APPROVED
3. Verify not already IMPLEMENTED
4. Revalidate code uniqueness against chart_of_accounts
5. Revalidate parent/hierarchy via Task #5 validateCoaHierarchy()
6. Revalidate postable rules
7. Call Task #5 createChangeRequest() — action = CREATE
8. Mark proposal IMPLEMENTED
9. Insert COA_IMPLEMENTED audit event
10. Insert LEARNING_FEEDBACK_CREATED (no auto-scoring)
11. Insert RULE_RECOMMENDATION_CREATED (requiresHumanApproval = true, autoApplied = false)
```

Note: Task #5 change request still requires its own separate checker approval.
The COA master becomes ACTIVE only after Task #5 checker approves.
