---
name: Marketplace Notification Queue
description: Phase 2E.1 reliable WA notification queue for marketplace events — critical design decisions and pitfalls
---

## Architecture

Table: `mkt_notification_queue` (migration 0021)
Service: `marketplaceNotificationQueueService.ts`
Worker: `marketplaceNotificationWorker.ts` — registered at 160s via startupOrchestrator, internal delay 10s

## Critical Design Decisions

### 1. Retry pipeline — fetch 'failed' rows too
`fetchPendingNotifications` MUST query `status IN ('pending', 'retrying', 'failed')`.
If only `pending` and `retrying` are fetched, failed rows are never retried.
**Why:** markFailed writes `status = 'failed'` (not `'retrying'`) for non-exhausted attempts.

### 2. No phone number → immediate exhausted
When `recipient_phone` is null, call `markFailed(id, msg, maxAttempts - 1, maxAttempts)`.
This forces `nextAttempt = maxAttempts` → `isExhausted = true`.
Do NOT call with `attemptCount` (0) — that sets status=failed, not exhausted.
**Why:** Phone-less entries will never succeed; retrying them wastes cycles.

### 3. startupOrchestrator + internal delay = double stagger
`registerWorker("mkt-notification-queue", startFn, 160_000)` already delays startFn by 160s.
Internal `setTimeout(INITIAL_DELAY)` inside startFn adds MORE delay.
Set internal delay small (10s) — just enough for DB to settle after startFn fires.
**Why:** 160s + 160s = 320s before first notification check — unacceptably slow.

### 4. mkt_notification_queued activity log
Must be fired inside `enqueueNotification()` after successful INSERT (not in the worker).
All 5 activity types: queued, sending/retrying (implicit), sent, failed, exhausted.

## Events handled
- `mkt_vendor_invitation_notification` — vendor invited to submit quote (was: payload prepared, never sent)
- `mkt_vendor_winner_notification` — vendor won (was: fire-and-forget WA in vendorSelectionService)
- `mkt_vendor_rejected_notification` — vendor rejected (was: silent fire-and-forget WA)

## Silent catch fix
`marketplaceRfqService.ts` line 268: `initApprovalFlow(...).catch(() => {})` → now logs error + fires `mkt_approval_init_failed` activity. RFQ create still succeeds (non-fatal).

## In-app notifications preserved
`vendorSelectionService.ts` still calls `saveVendorNotification()` for winner + rejected — these populate the vendor portal notification panel. WA moves to queue; in-app stays fire-and-forget.
