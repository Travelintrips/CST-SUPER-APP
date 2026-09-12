---
name: DEV/PROD PPh master boundary
description: Distinguishes withholding tax templates from company-scoped PPh COA options and OCR evidence.
---

The production accounting tax master can contain active PPh templates even when production lacks the specific postable PPh liability COA rows present in development. A tax template pointing to a generic payable account does not create or expose named PPh accounts in the invoice COA selector.

**Why:** The invoice OCR screen reads postable company-scoped COA accounts for line selection, while its displayed PPh amount comes from invoice evidence. These are separate from the accounting tax settings page.

**How to apply:** Compare `accounting_taxes` and `chart_of_accounts` independently for the active company before changing OCR logic. If templates exist but named PPh options do not, use the governed COA migration path; do not manually insert rows or infer PPh from PPN.