---
name: Bank matching direction semantics
description: Direction filtering for accounting payment candidates and QRIS-specific Sport Center candidates.
---

The unified bank matcher must treat operational inbound types such as `transfer` and `bank_transfer` as valid money-in candidates, while excluding only clear opposite-direction payment/vendor types. Sport Center candidates must be gated by actual QRIS evidence on the bank mutation.

**Why:** A strict `payment_type = inbound` filter hid valid same-day bank-transfer candidates, while an ungated Sport Center source could misclassify ordinary transfers as QRIS.

**How to apply:** Keep direction predicates consistent between unified AI matching and ERP document matching; run a transfer regression case whenever payment-type or QRIS-source filtering changes.