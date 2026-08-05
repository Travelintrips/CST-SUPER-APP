---
name: Vendor Notification Architecture
description: In-app notification split for admin (admin_notifications) vs vendor (vendor_notifications); transaction boundary for vendor approval.
---

## Tables
- `admin_notifications` — SSE-broadcast in-app store for admins; persisted by `notificationStore.saveAndBroadcast()`
- `vendor_notifications` — per-vendor in-app store; persisted by `notificationStore.saveVendorNotification()`; read by `GET /api/portal/vendor/notifications`

Both tables have boot migrations (raw SQL CREATE TABLE IF NOT EXISTS) AND Drizzle schema files.

## Transaction boundary (PATCH /admin/approvals/:id vendor approval)
**In the DB transaction** (db.transaction): onboarding_approvals update, user_profiles update, portal_customers role update, supplier create/update, submission link deactivate+create, vendor_profiles bridge update, vendor_notifications insert.

**Outside the transaction** (fire-and-forget async): WA send, notification_logs write, admin_notifications (NotificationService.notifyVendorApproved).

**Why:** WA sends must never rollback the approval data. Admin/WA logs are non-critical and allowed to silently fail.

## Key function: runVendorApprovedInTx
Signature: `runVendorApprovedInTx(tx: DbLike, customerId, reviewedBy)` — accepts the drizzle transaction object typed as `Pick<typeof db, "select"|"insert"|"update"|"delete"|"execute">`. Called from portal.ts inside `db.transaction()`.

`runVendorApprovedLifecycle()` still exists for standalone use — internally wraps in `db.transaction()` then sends WA outside.

## Submission link expiry
Set to 30 days from NOW() in `generateFreshSubmissionLink()`. The GET /form/:token handler already validates `expiresAt < new Date()`.

## Vendor dashboard tabs
`vendor-dashboard.tsx` uses `activeTab: "dashboard" | "profile" | "catalog" | "notifications"` state with tab bar in the sticky header. Existing content stays under "dashboard" tab. New tabs: Profile (verification status + full vendor_profiles), Catalog (submissions + etalase), Notifications (vendor_notifications with unread badge).
