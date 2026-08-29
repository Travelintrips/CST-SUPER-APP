---
name: QRIS payment-led detection
description: Candidate detection when the payment method identifies QRIS but the bank mutation lacks provider text.
---

The QRIS candidate engine may use `payment_method=QRIS` as the primary classifier when the bank mutation has generic text or no provider label. It must still require a matching paid payment in the same company, bank account, and H+1 settlement cohort, and must retain amount/MDR and settlement-conflict guards.

**Why:** Bank descriptions are often generic even when the credit settles a QRIS payment, but treating every inbound bank row as QRIS creates false candidates.

**How to apply:** Use bank-side provider data for rule enrichment and provider-specific auto-match eligibility, not as a filter that hides a dimensionally matching payment. Preserve provider mismatches as `REVIEW`, keep unknown providers non-automatic, and allow missing derived settlement metadata to remain reviewable rather than silently dropping the candidate.