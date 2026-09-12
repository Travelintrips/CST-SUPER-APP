---
name: Vendor Mini Form — Feature Set
description: Architecture decisions and non-obvious gotchas for the VMF system (13-feature batch)
---

## Feature summary
Full-featured vendor mini form system with: order-based & rate-collection modes, anti-duplicate/resubmit control, IP/UA capture, WA summary to admin (ranked list for order-based), markup calculator, lock-after-approve, activity log, price versioning, "minta revisi" flow.

## Key tables
- `vendor_mini_form_links`: + `max_submissions`, `resubmit_allowed`, `admin_notes`
- `vendor_mini_form_submissions`: + `submitted_ip/ua`, `revision_count`, `admin_notes`, `locked`, `unlock_reason`
- `customer_approvals`: + `submission_id`, `vendor_cost`, `markup_pct/nominal`, `ppn_pct/nominal`, `profit_margin_pct`, `admin_notes`, `locked`
- `vendor_price_history`: price versioning per submission
- `vmf_activity_log`: general audit trail

## Critical flow decisions

**Anti-duplicate**: POST /:token checks existing submission. If `locked=true` → 409 locked. If `resubmit_allowed=false` → 409. If `resubmit_allowed=true` → update existing (increment revision_count), save price history, reset resubmit_allowed to false.

**Why:** Vendors can only re-submit when admin explicitly enables resubmission via POST /admin/submissions/:id/request-revision. This prevents unsolicited re-submissions.

**Lock on approve**: When customer approves via POST /customer-approval/:token, set `locked=true` on selected submission(s). Subsequent vendor re-submissions to locked submissions are rejected.

**WA Summary for order-based**: When any vendor submits on order-based link, admin gets ranked list of ALL existing submissions for that link (not just the new one). This gives real-time comparison view in WhatsApp.

**Markup calculator UI**: CreateApprovalDialog auto-computes: markupNominal from markupPct (or vice versa), then baseBeforeTax = cost + markup, ppnNominal = base * ppn/100, sellingPrice = base + ppn. profitMarginPct = (sellingPrice - cost) / sellingPrice * 100. All fields stored in customer_approvals.

## Route: request-revision
POST /admin/submissions/:id/request-revision:
1. Set submission.responseStatus = "revision_requested"
2. Set link.resubmit_allowed = true (allows vendor to re-submit)
3. Optionally send WA to vendor with form link
4. Log activity

**Why:** resubmit_allowed acts as a one-shot permission. After vendor re-submits, it auto-resets to false.
