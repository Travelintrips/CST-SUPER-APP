---
name: Historical settlement repair boundary
description: Safety boundary for linking an already-posted legacy QRIS settlement to its bank mutation.
---

Historical repair may override only the payment-date H-1 rule. It must independently revalidate exact settlement-date/net evidence, company and account identity, posted settlement journal ownership, confirmed QRIS payment status, and payment-derived gross/MDR/net before creating the match and link in one transaction. Every posted, journal-backed, unlinked canonical batch must enter this recovery path from the UI rather than generic approval.

**Why:** A posted legacy batch can legitimately contain a same-day payment, but using a generic manual override would also suppress cross-company, invalid payment, or amount failures and could authorize the wrong settlement.

**How to apply:** Normalize payment dates only for a second core-evidence calculation, then require the actual-date validation to fail solely with the non-H-1 reason. All match creation, locks, link updates, and audit writes must share one transaction. A retry may complete a partial same-mutation link when the batch is still posted; links to another mutation remain blocked. Treat a stale “ready” snapshot as recovery-eligible only when the live candidate still has posted journal ownership and no bank-mutation link.