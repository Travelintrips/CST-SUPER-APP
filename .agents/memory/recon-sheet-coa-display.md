---
name: Recon sheet COA display
description: The bank reconciliation result sheet shows the contra account from the journal, with its COA code and name.
---

The reconciliation result sheet must write both `coa` and `nama_coa` from the contra side of the linked journal, not the bank/cash COA. If a journal has multiple contra lines, preserve all distinct codes and names in the cell.

**Why:** Showing the bank account COA on every row would hide the account classification that the reconciliation result is meant to explain.

**How to apply:** Resolve the linked journal entry through the bank mutation and exclude the configured bank account COA; leave the fields empty when no journal has been approved yet.