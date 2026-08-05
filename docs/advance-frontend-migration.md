# Advance Frontend Migration — `talangan.tsx` → Unified Advance API

## Scope

Migrated `artifacts/bizportal/src/pages/expense/talangan.tsx` from the legacy
`/api/cash-advances` endpoints to the Unified Advance API (`/api/advances`),
following the pattern already established by `kasbon.tsx` in the same Sprint 2B
migration wave. No DB migration, schema change, or journal-posting logic was
touched — `artifacts/api-server/src/routes/advances.ts` is the pre-existing,
unmodified backend contract this migration targets.

## Endpoint mapping

| Action | Legacy (`/api/cash-advances`) | Unified (`/api/advances`) |
|---|---|---|
| List | `GET /api/cash-advances?type=talangan` | `GET /api/advances?type=talangan` |
| Detail | `GET /api/cash-advances/:id` | `GET /api/advances/:id` |
| Create | `POST /api/cash-advances` | `POST /api/advances` |
| Approve | *(not previously wired in talangan.tsx UI)* | `PATCH /api/advances/:id/approve` |
| Reject | *(not previously wired in talangan.tsx UI)* | `PATCH /api/advances/:id/reject` |
| Disburse | *(implicit — legacy create posted the journal immediately)* | `PATCH /api/advances/:id/disburse` |
| Repay | `POST /api/cash-advances/:id/repay` | `POST /api/advances/:id/repay` |
| Repayment receipt upload | `POST /api/cash-advances/:id/repayments/:repId/upload-receipt` | `POST /api/advances/:id/repayments/:repId/upload-receipt` |
| Void | *(not available)* | `POST /api/advances/:id/void` |
| Delete | `DELETE /api/cash-advances/:id` | `DELETE /api/advances/:id` |
| OCR preview (create form + repayment receipt) | `POST /api/cash-advances/ocr-preview` | `POST /api/advances/ocr-preview` |

Verified via `grep` that `talangan.tsx` no longer references `/api/cash-advances`
or `/api/employee-kasbon` anywhere.

## Behavioral / state-machine changes introduced

The unified engine enforces an explicit `draft → pending_approval → approved →
disbursed/outstanding → partially_settled → settled` (or `void`/`reversed`)
state machine, server-side, which the legacy `/api/cash-advances` route did not
have in the same form. This required **adding UI that did not previously exist**
in `talangan.tsx`, mirroring `kasbon.tsx`:

- **Approve / Reject panel** — shown when `status === "pending_approval"`.
  Approving does **not** post a journal by itself; it only flips lifecycle
  status to `approved`.
- **Disburse action** — shown when `lifecycleStatus === "approved"`. This is
  the step that actually posts the `DR Piutang Dana Talangan / CR Kas-Bank`
  journal via `AdvanceJournalService.postDisbursementJournal`. Under the
  auto-approve limit, the server disburses immediately on create, so this
  panel only appears for advances that required approval.
- **Void action** — shown when the advance is `active` with a posted journal
  (`entry_id` present) and zero repayments so far. Calls `/void`, which posts
  a reversal journal (`postVoidReversal`) rather than deleting the row.
- **Reject dialog** — optional free-text reason, mirrors kasbon's dialog.

Previously, `talangan.tsx` had **no** approve/reject/disburse/void UI at all —
advances went straight from create to "active" under the legacy engine. Since
`POST /api/advances` now requires explicit approval routing above the
company's advance approval limit, omitting this UI would have made
above-limit dana talangan permanently stuck in `pending_approval` with no way
to move it forward. This is a deliberate, required addition — not scope creep.

## `advance_type` routing decision

The unified create endpoint requires an `advance_type` enum value
(`EMPLOYEE | VENDOR | CUSTOMER | PROJECT | PURCHASE | TRAVEL | OPERATIONAL |
OTHER`). `talangan.tsx`'s recipient combobox can resolve to a vendor, an
employee, or free text. Mapping decision:

- **Vendor selected** → `advance_type: "VENDOR"`, `vendor_id` sent.
- **Employee selected or free-text party name** → `advance_type:
  "OPERATIONAL"`, `user_id` sent when an employee was picked.

`EMPLOYEE` was deliberately **not** used for the employee-recipient case: the
server's `approvalCategoryForType` maps `advance_type === "EMPLOYEE"` to the
`"kasbon"` approval-limit bucket and everything else to `"talangan"`. Also,
the row's legacy `type` column is set from the same rule at insert time
(`type: advance_type === "EMPLOYEE" ? "kasbon" : "talangan"`), which is what
the list query's `?type=talangan` filter depends on. Using `EMPLOYEE` would
have silently reclassified employee-linked dana talangan as kasbon and hidden
them from this page's list. This matches the boot migration's own historical
heuristic (`talangan + vendor_id → VENDOR`, `talangan otherwise →
OPERATIONAL`).

## Response contract fixes

The legacy `/repay` response and the unified `/repay` response have different
shapes. The **pre-migration** `talangan.tsx` code (still targeting the legacy
route) read `d.repayment.advanceId`, `d.repayment.id`, `d.repayment.amount`,
and `d.advance` — none of which exist on the unified response:

```json
{
  "success": true,
  "remaining_amount": 4500000,
  "lifecycle_status": "partially_settled",
  "entry_id": 812,
  "repayment_id": 41
}
```

Fixed to use `d.repayment_id` (for the follow-up per-repayment receipt
upload), `d.remaining_amount` (for the outstanding-balance toast), and the
submitted `amount` from the mutation's own request variables (since the
unified response does not echo back the repayment amount).

## Delete / Void gating fix

Pre-migration delete gate: `status === "active" && paidAmount === 0`. Under
the unified engine's `canDelete(status, entryId)` guard, a hard `DELETE` is
**only** permitted for `draft | pending_approval | rejected | cancelled`
status **and** no `entry_id` — an `active` advance always has a posted
journal by definition, so the old gate would have called an endpoint that now
always rejects with `POSTED_JOURNAL_BLOCKED`.

Fixed gating (mirrors `kasbon.tsx`):

- **Delete** button shown only when `["pending_approval", "rejected"].includes(status)` and no `entry_id`.
- **Void** button shown when `status === "active"`, an `entry_id` exists, and `paid_amount === 0`.
- Informational banner shown when `status === "partial"` (repayments already
  exist — must be resolved via further repayment, not void).

## `isDisbursedStatus` helper

Ported unchanged from `kasbon.tsx`. Gates the repayment form: checks
`lifecycleStatus` in `[disbursed, outstanding, partially_settled]`, falling
back to the legacy `active`/`partial` status for rows created before this
migration (which may lack `lifecycleStatus` populated).

## Known gaps / deliberately out of scope

- **No settlement/pertanggungjawaban feature added.** `talangan.tsx` never
  had a settle-to-expense (non-cash reclass) feature before this migration,
  unlike `kasbon.tsx` which had one and had to formally disable it (see
  `kasbon.tsx`'s own Known Gap notice). Since talangan had no equivalent
  feature to begin with, no gap notice was needed here — this is a
  non-change, not a removal.
- **OCR raw data on advance detail** is not currently projected by
  `GET /api/advances/:id` (same gap noted in kasbon's migration) — the
  create-form and repayment-form OCR flows are unaffected since they call the
  standalone `/api/advances/ocr-preview` endpoint directly, not the detail
  endpoint.
- Receipt viewing links assume `/api/storage/download?key=...` remains the
  correct object-storage download route (unchanged by this migration).

## Verification performed

- `grep -n "cash-advances\|employee-kasbon" artifacts/bizportal/src/pages/expense/talangan.tsx` → no matches.
- Full monorepo `pnpm run typecheck` run. `talangan.tsx` produces exactly 2
  `TS7030` ("not all code paths return a value") diagnostics, at the two
  early-return guard clauses in `handleCreate`/`handleRepay`
  (`return toast({...})`). These are structurally identical, line-for-line
  equivalent patterns to the same pre-existing `TS7030` diagnostics already
  present in the unmodified reference file `kasbon.tsx` (its own
  `handleCreate`/`handleRepay`) — not a new class of error introduced by this
  migration. All other typecheck errors surfaced by the full run are in
  unrelated files (`cashBank.ts`, `logisticOrders.ts`, `profitability.tsx`,
  `vendor-detail.tsx`, etc.) and pre-date this change.
