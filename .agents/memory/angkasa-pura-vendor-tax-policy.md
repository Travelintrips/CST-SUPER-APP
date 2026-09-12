---
name: Angkasa Pura vendor tax policy
description: Calculation policy for PT Angkasa Pura Indonesia vendor invoices.
---

For PT Angkasa Pura Indonesia invoices, calculate PPN as 11% of each component DPP. Apply PPh 23 at 15% to concession DPP and PPh 4(2) at 10% to electricity and water DPP. Supplier cash payment is rounded gross invoice minus rounded withholding; withholding remains a tax liability.

**Why:** The invoice explicitly labels the 15% concession withholding as PPh Pasal 23; mapping it to PPh 15 sends the amount to the wrong liability COA. The invoice is gross including PPN, while PPh is withheld from the DPP-based tax object.

**How to apply:** Keep component-level DPP, PPN, gross, withholding type/rate/amount, and payable values visible. Resolve PPh 23 to the company-scoped Pasal 23 liability COA and PPh 4(2) to its dedicated Pasal 4 Ayat 2 liability COA before Finance confirmation. Preserve manual tax review and proof-of-withholding requirements even when the amounts are calculated automatically.