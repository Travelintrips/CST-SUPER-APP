---
name: Vendor invoice OCR tax evidence
description: Safety boundary for vendor invoice component extraction, withholding tax, payable amounts, and reminders.
---

Vendor invoice OCR must preserve printed component values and PPh evidence across all document pages. For PDFs with a text layer, pair extracted text with rendered page images because table column order can be flattened. A PPh rate without a printed tax amount is not enough to populate the withholding amount or payable-to-vendor value.

**Why:** Deriving a payment amount from a rate can create an incorrect posted liability or WhatsApp payment instruction, especially when the tax base or tax treatment differs from the visible component.

**How to apply:** Store the structured OCR breakdown as supporting evidence, use visual page layout to associate table columns, keep accounting totals sourced from the SAP/header totals, and mark the invoice for manual review when PPh amount or payable amount is not explicitly printed. If page rendering is unavailable, retain a controlled text-only fallback and flag uncertain table associations.