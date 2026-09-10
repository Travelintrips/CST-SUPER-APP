---
name: Vendor product approval boundary
description: Every vendor-originated marketplace product must enter review before publication.
---

All vendor-originated catalog paths, including products carried in the initial vendor invitation, must create a `pending_review` catalog item with `is_published=false` and an admin-reviewable submission. Only the admin approval transition may publish it.

**Why:** The direct vendor dashboard path already enforced this contract, but the legacy invitation-approval path could publish the vendor's initial product list immediately.

**How to apply:** When adding or changing vendor onboarding/catalog paths, verify both the public visibility flags and the notification/approval queue linkage; do not treat vendor onboarding approval as product approval.