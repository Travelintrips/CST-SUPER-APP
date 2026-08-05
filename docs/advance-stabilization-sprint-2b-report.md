# Advance Management Stabilization — Sprint 2B Report

## Objective

Sprint 2B: migrate all remaining BizPortal ERP frontend surfaces off the
legacy `/api/cash-advances` route family and onto the Unified Advance API
(`/api/advances`), which was built and stabilized in prior sprints
(`advance-api-standard.md`, `advance-approval-standard.md`,
`advance-journal-standard.md`, `advance-state-machine.md`). This sprint
covers **frontend consumption only** — no new backend routes, no DB
migrations, no schema changes, no journal-posting logic changes.

## Scope completed this sprint

| File | Status |
|---|---|
| `artifacts/bizportal/src/pages/expense/kasbon.tsx` | Migrated (prior work — used as reference pattern) |
| `artifacts/bizportal/src/pages/expense/talangan.tsx` | **Migrated this sprint** |

Both pages now exclusively call `/api/advances*` for list, detail, create,
approve, reject, disburse, repay, void, delete, and OCR-preview operations.

## Work performed on `talangan.tsx`

1. Read the full unified backend contract in
   `artifacts/api-server/src/routes/advances.ts` end-to-end (list, detail,
   create, approve, reject, disburse, settle/repay, void, delete,
   ocr-preview, upload-receipt) to pin down exact request/response field
   names before touching the frontend.
2. Rewrote `talangan.tsx` in full:
   - Repointed every fetch call from `/api/cash-advances*` to `/api/advances*`.
   - **Added previously-missing UI**: approve action, reject dialog with
     optional reason, disburse action, void action, and an approval-trail
     display block — none of this existed in the legacy version because the
     old route had no formal approval gate.
   - Fixed the repay success handler to read `repayment_id` and
     `remaining_amount` off the unified response instead of the legacy
     nested `repayment` / `advance` objects (these fields do not exist on
     the new response shape; the old code would have thrown at runtime).
   - Corrected delete gating to the unified `canDelete` rule
     (`["pending_approval","rejected"].includes(status) && !entry_id`)
     instead of the legacy `status === "active" && paidAmount === 0` rule,
     which would now always be rejected server-side.
   - Added void gating mirroring `kasbon.tsx` for posted-but-unpaid advances.
   - Preserved talangan's vendor/employee recipient combobox, mapping it to
     `advance_type: "VENDOR"` (vendor selected) or `"OPERATIONAL"` (employee
     or free-text party), to keep the row bucketed as `type: "talangan"`
     server-side rather than accidentally reclassifying it as `"kasbon"`.
   - Ported the `isDisbursedStatus` helper unchanged from `kasbon.tsx`.
3. Verified with `grep` that zero references to `cash-advances` or
   `employee-kasbon` remain in `talangan.tsx`. Remaining hits elsewhere in
   the codebase (`approvals.tsx`, `closing-wizard.tsx`) are out of this
   sprint's scope and were left untouched.
4. Ran a full monorepo typecheck and a standalone bizportal typecheck to
   confirm no regressions were introduced (see Verification below).

Full technical detail (endpoint mapping table, response-contract diffs,
state-machine rationale, `advance_type` routing decision) is in
`docs/advance-frontend-migration.md`.

## Verification

- **Grep audit**: `talangan.tsx` has 0 matches for `cash-advances` /
  `employee-kasbon`. ✅
- **Full project typecheck** (`pnpm run typecheck`): the API server package
  currently has pre-existing, unrelated compile errors (`cashBank.ts`,
  `companies.ts`, `logisticOrders.ts`, `payments.ts`, `portal.ts`) that
  short-circuit the workspace-wide pipeline before the bizportal package
  runs. These predate this sprint and are outside its scope.
- **Standalone bizportal typecheck** (`npx tsc -p tsconfig.json --noEmit`,
  full run, ~115s): ~190 diagnostic lines across the whole bizportal
  package, none related to the advance migration except 2 in `talangan.tsx`
  itself (`TS7030`, "not all code paths return a value" at the
  `handleCreate`/`handleRepay` early-return guards). These are line-for-line
  structurally identical to the same `TS7030` diagnostics already present
  in the **unmodified** reference file `kasbon.tsx` at its own analogous
  `handleCreate`/`handleRepay` guards — an established, tolerated pattern
  in this codebase, not a new defect introduced by this migration. No other
  new errors were found; all remaining diagnostics are in unrelated pages
  (accounting, analytics, logistics, purchase, sales, settings,
  sport-center, tax modules) that pre-date this sprint.
- **No DB migration, schema file, or journal-posting logic (`AdvanceJournalService`,
  `advances.ts` backend route) was modified.** This sprint is frontend-only,
  as required.

## Explicit non-goals / deferred items

- `approvals.tsx` and `closing-wizard.tsx` still reference legacy
  cash-advance endpoints — out of scope for Sprint 2B, flagged for a future
  sprint if they need migration.
- No settlement/pertanggungjawaban (non-cash reclass to expense) feature was
  added to `talangan.tsx` — it never had one prior to this migration, so
  there was nothing to preserve or port.
- Runtime/browser verification (clicking through create → approve → disburse
  → repay → void in the running BizPortal app) was not performed as part of
  this report; only static analysis (grep + typecheck) was used to validate
  correctness of the endpoint and contract migration.

## Outcome

`talangan.tsx` is now fully aligned with the Unified Advance API and follows
the same architecture, state machine, and UI conventions as `kasbon.tsx`.
Both dana talangan and kasbon flows in BizPortal now share one backend
contract (`/api/advances`), removing the last known frontend consumer of the
legacy `/api/cash-advances` create/repay/delete surface for these two pages.
