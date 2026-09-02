---
name: Rule AI tax classification
description: UX and accounting contract for tax handling in bank reconciliation rules.
---

The Rule AI action COA is the primary transaction account: expense flows use expense COAs and income flows use revenue COAs. PPN Masukan/Keluaran must remain a separate tax component, not the rule's primary COA. Tax treatment should be shown as an automatic, read-only result of transaction direction and OCR context; low-confidence or inconsistent OCR must remain review-only. OCR-to-journal auto-posting requires high confidence plus a persisted-header balance check; journal errors must leave the invoice draft.

**Why:** Using a tax asset as the main COA hides the underlying expense and makes the journal classification misleading. Manual tax dropdowns also invite users to classify input/output VAT incorrectly.

**How to apply:** Keep Rule AI account selection constrained by action flow. For routine expense allocation show automatic PPN Masukan; for income allocation show automatic PPN Keluaran. Preserve manual override only in a dedicated exception/review flow. For OCR, use the stored DPP/PPN/total header values for the posting gate; never derive DPP from total minus tax to hide a mismatch.