# COA Master Governance — Task #5

## Overview

Chart of Accounts (COA) master governance implements a **maker-checker workflow** for all changes to `chart_of_accounts`. No account can be created, updated, activated, deactivated, or archived without a change request that is reviewed and approved by a second authorized user.

---

## Architecture

### Backend (API Server)

| File | Role |
|---|---|
| `artifacts/api-server/src/lib/coa/coaValidation.ts` | Reusable validators: normal-balance inference, parent-category compatibility, postable/header rules, hierarchy validation, posting account validation |
| `artifacts/api-server/src/lib/coa/coaChangeRequestService.ts` | Maker-checker state machine: DRAFT → PENDING_APPROVAL → APPROVED/REJECTED/CANCELLED |
| `artifacts/api-server/src/lib/coaGovernance.ts` | Pure in-memory governance helpers (legacy/type export) |
| `artifacts/api-server/src/lib/coaGovernanceMigration.ts` | Additive DDL migration: governance columns on `chart_of_accounts`, `coa_change_requests`, `coa_versions` |
| `artifacts/api-server/src/routes/coaGovernance.ts` | Express router mounted at `/accounting/coa` |

### Frontend (BizPortal)

| File | Role |
|---|---|
| `artifacts/bizportal/src/pages/accounting/coa-governance.tsx` | 3-tab UI: Daftar COA / Pending Approval / History |
| Route: `/accounting/coa-governance` | Registered in `artifacts/bizportal/src/routes.tsx` |

### Package Exports

`lib/db/package.json` exports:
- `.` → `./src/index.ts`
- `./schema` → `./src/schema/index.ts`
- `./schema/accounting` → `./src/schema/accounting.ts`  ← used by COA governance router

---

## API Endpoints

All endpoints require authentication. Approve/Reject additionally require `admin` role.

| Method | Path | Description |
|---|---|---|
| GET | `/api/accounting/coa` | Full COA list with governance fields |
| GET | `/api/accounting/coa/:id` | Single COA |
| GET | `/api/accounting/coa/:id/history` | Version history |
| GET | `/api/accounting/coa/change-requests` | List change requests (filter by `?status=`) |
| GET | `/api/accounting/coa/change-requests/:id` | Single change request |
| POST | `/api/accounting/coa/change-requests` | Create change request |
| POST | `/api/accounting/coa/change-requests/:id/submit` | Submit for approval |
| POST | `/api/accounting/coa/change-requests/:id/approve` | Approve (admin, not maker) |
| POST | `/api/accounting/coa/change-requests/:id/reject` | Reject (admin, not maker) |
| POST | `/api/accounting/coa/change-requests/:id/cancel` | Cancel (maker or admin) |

---

## Maker-Checker Rules

1. A user creates a change request → status: `DRAFT`
2. Maker submits it → status: `PENDING_APPROVAL`
3. A **different** admin user approves or rejects it
4. **Self-approve is denied** — enforced at backend (`SELF_APPROVE` / `SELF_REVIEW` error codes)
5. On approval: master COA is updated atomically, version incremented, snapshot saved to `coa_versions`
6. UI hints about self-approval are informational only; backend is the authoritative enforcement

---

## Validation Rules

### Normal Balance Defaults (Phase 3)
| Category | Normal Balance |
|---|---|
| ASSET, EXPENSE, OTHER_EXPENSE, CONTRA_LIABILITY, CONTRA_REVENUE | DEBIT |
| LIABILITY, EQUITY, REVENUE, OTHER_INCOME, CONTRA_ASSET, CONTRA_EXPENSE | CREDIT |
| CLEARING | null — must be set explicitly |

### Postable / Header Rules (Phase 4)
- `isHeader=true` + `isPostable=true` → **invalid** (`HEADER_CANNOT_BE_POSTABLE`)
- `isHeader=true` + `isPostable=false` → valid
- `isHeader=false` + `isPostable=true` → valid
- `isHeader=false` + `isPostable=false` → valid (non-postable leaf)

### Hierarchy Validation (Phase 6)
- Parent must exist in same company (or be global/null)
- No self-reference
- No cycle detection
- Parent category must be compatible with child category

### Posting Account Validation (Phase 7 — Journal Safety)
All journal posting paths (`postEntry`, `postEntryWithClient`, `createJournal`) flow through `ledgerGuard.ts` which calls `validateAccountsForPosting`. An account used in a journal line must be:
- EXISTS in database
- Same company as the journal
- Status = ACTIVE
- `isPostable = true`
- `isHeader = false`
- Effective date valid (effectiveFrom ≤ date ≤ effectiveTo, or no date restriction)

---

## Migration (Additive-Only)

`coaGovernanceMigration.ts` uses `ADD COLUMN IF NOT EXISTS` — no DROP, no destructive ALTER.

New tables:
- `coa_change_requests` — change request lifecycle
- `coa_versions` — append-only version snapshots

Key constraints:
- `coa_change_requests(company_id, idempotency_key)` — unique (prevents duplicate requests)
- `coa_versions(coa_id, version)` — unique (append-only guarantee)
- Company-scoped indexes on both tables

---

## 3-Tab Frontend

### Tab 1: Daftar COA
- Lists all COA with governance fields: status, version, category, normal balance, isHeader, isPostable, effectiveFrom/To
- Search by code / name / category
- Filter by status (ACTIVE / DRAFT / INACTIVE / ARCHIVED)

### Tab 2: Pending Approval
- Lists change requests with status filter
- Before/after diff for every field in the snapshot
- Approve/reject buttons (admin only, not shown for self-requests)
- Self-approval labeled "(Anda) — tidak bisa self-approve" in UI
- Backend enforces SELF_APPROVE / SELF_REVIEW denial regardless of UI

### Tab 3: History
- Select any COA from dropdown
- Shows all version snapshots (append-only) with metadata: version, created_by, approved_by, effective dates, changeRequestId
- Expandable JSON snapshot for full detail
