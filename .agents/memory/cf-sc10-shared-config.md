---
name: CF-SC-10 shared finance config
description: Development shared finance configuration contract and central-mode ownership boundary.
---

Central Sport Center finance resolves exact active/effective rows from the four
public finance_project_* tables plus canonical masters. The verified dev tuple
is project sport_center/company 1, QRIS/mandiri_direct, tax rule 8, and COAs
75594/72354/49109/75590 for receiving bank/revenue/tax output/MDR expense.

**Why:** The legacy Sport Center tables remain necessary for the existing
settlement owner and mirror/recovery contracts, but must not silently override
complete shared configuration in central mode.

**How to apply:** Keep resolver failures fail-closed; do not seed Transfer Bank
or Paylabs rows, and preserve legacy/shadow behavior outside central mode.