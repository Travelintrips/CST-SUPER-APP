---
name: Featured Product real E2E UAT findings
description: Bugs and gotchas found while running a real (no-mock) end-to-end UAT of the Featured Product marketplace feature against the dev Supabase DB.
---

## Dev-login vendor status mismatch — FIXED
`portalAuthService.ts` `devLogin()` used to set `user_profiles.status = "approved"`, but `requireActiveVendor`
(`supabaseAuth.ts`) only allows `status === "active"` (the value the real approval path sets). This 403'd every
vendor-role dev-login test. Fixed by changing `devLogin()` to write `"active"` instead — safe because `"approved"`
was a dead value nothing else checked, and the dev-login route already 404s in production
(`REPLIT_DEPLOYMENT==="1"`), so the change is dev-only by construction. Verified: fresh vendor dev-login now returns
`onboarding/status.status === "active"` immediately, no manual DB patch needed.
**Why it matters:** if a similar dev-only auth shortcut is added elsewhere, check it against the *current* real
status enum values (grep the approval service), not assumed/legacy ones.

## resolveVendorSupplierId linkage for dev-login testing
`resolveVendorSupplierId(customerId)` (`portalVendorProfileService.ts`) links a portal_customers row to a real
`suppliers` row by matching `contactEmail` (case-insensitive) OR normalized `phone` — nothing else. To drive a real
E2E test as a specific existing vendor without touching that vendor's real data, update the throwaway
`dev-vendor@dev.local` row's `phone` to match the target supplier's phone (don't touch `email`, since `devLogin()`
looks up the row by the fixed `dev-${role}@dev.local` email on every call).

## Stale is_featured rows with no expiry — FIXED via repair utility
Found vendor_catalog_items rows with `is_featured=true` but `featured_until` NULL and no matching
`mkt_featured_product_requests` row — `expireFeaturedProducts()` never touches these (it only expires rows tied to
an `active`-status request whose `approvedEndAt` passed), so they'd stay "featured" forever. Fixed by adding a
standalone read-only-scan + guarded-repair utility (admin-only, dry-run vs execute, one audit-log row per repair,
never deletes) rather than patching the expiry worker itself — keeps "detect/fix data corruption" separate from
"expire valid bookings", which are different concerns with different trust levels.
**Why it matters:** for any "flag + expiry" feature, a corrupt-flag-with-no-backing-record case needs its own admin
repair tool, not a broadened expiry query — broadening expiry logic to also catch corruption risks accidentally
expiring a legitimately-mid-flight item.
**How to apply:** if new corrupt-state categories show up (e.g. flag true + expiry in the past + no worker run yet),
extend the scan's reason enum rather than writing a one-off SQL fix.

## Unrelated pre-existing bug noticed during regression pass
`GET /api/portal/marketplace/stats` swallows its query error and returns all-zero stats (see `[marketplace/stats]
query failed — returning zeros` in api-server logs). Query joins `vendor_performance.vendor_grade` — likely a
schema/column drift. Not caused by and unrelated to the Featured Product feature; flagged for separate follow-up.
