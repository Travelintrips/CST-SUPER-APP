---
name: Vendor invoice reclassification net boundary
description: Posted Vendor Invoice COA corrections must reclassify only the net expense/GRIR debit, leaving PPN and AP lines unchanged.
---

The governed correction for a posted Vendor Invoice must match Finance-confirmed invoice-line subtotals to the original net debit portion. It must not require the subtotal total to equal every debit in the journal, because PPN input is a separate debit and AP is the gross credit.

**Why:** Gross invoice journals commonly contain both net COA debits and a PPN debit; treating all debits as the COA target rejects valid corrections or risks moving tax balances.

**How to apply:** When mapping a posted invoice correction, prove the target subtotal total against a debit subset and post a balanced target-COA/old-COA reclassification. Preserve tax, payable, and the original posted entry.