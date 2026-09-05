---
name: Vendor invoice OCR tax evidence
description: Safety boundary for vendor invoice component extraction, withholding tax, payable amounts, and reminders.
---

Vendor invoice OCR must preserve printed component values and PPh evidence across all document pages. A PPh rate without a printed tax amount is not enough to populate the withholding amount or payable-to-vendor value.

**Why:** Deriving a payment amount from a rate can create an incorrect posted liability or WhatsApp payment instruction, especially when the tax base or tax treatment differs from the visible component.

**How to apply:** Store the structured OCR breakdown as supporting evidence, keep accounting totals sourced from the SAP/header totals, and mark the invoice for manual review when PPh amount or payable amount is not explicitly printed.