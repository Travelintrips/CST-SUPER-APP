---
name: Vendor payable child posting
description: Accounting boundary for resolving the AP account used by Vendor Invoice journals.
---

Vendor Invoice journals must credit the company-scoped, postable Hutang Pemasok/Vendor child account. A configured Hutang Usaha account may represent the hierarchy parent and must not automatically receive direct postings.

**Why:** Direct posting to the parent leaves the supplier-payable child empty in Trial Balance even though total liabilities remain balanced, obscuring vendor balances.

**How to apply:** Accept the configured AP account directly only when it is itself the explicit vendor-payable posting account. Otherwise resolve exactly one postable vendor-payable child beneath it and fail closed on missing or ambiguous matches. Correct already-posted parent balances through governed balanced reclassification, never by mutating ledger lines.