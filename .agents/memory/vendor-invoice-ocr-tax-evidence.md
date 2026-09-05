---
name: Vendor invoice OCR tax evidence
description: Safety boundary for vendor invoice component extraction, withholding tax, payable amounts, and reminders.
---

Vendor invoice OCR must preserve printed component values and PPh evidence across all document pages. For PDFs with a text layer, pair extracted text with rendered page images because table column order can be flattened. A PPh rate plus an unambiguous component DPP/NET and GROSS may produce a clearly labeled calculated estimate for withholding and payable-to-vendor; a rate without a reliable base must remain null.

**Why:** Deriving a payment amount from a rate can create an incorrect posted liability or WhatsApp payment instruction, especially when the tax base or tax treatment differs from the visible component. Explicit printed amounts remain stronger evidence than a calculation, and the calculation must not be mistaken for an official withholding certificate.

**How to apply:** Store the structured OCR breakdown as supporting evidence, use visual page layout to associate table columns, calculate per component from NET/DPP × printed rate and GROSS − calculated PPh only when all inputs are clear, and keep tax review required before posting or treating the result as an official proof-of-withholding. If page rendering is unavailable, retain a controlled text-only fallback and flag uncertain table associations.