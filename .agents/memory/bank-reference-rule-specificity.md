---
name: Bank reference rule specificity
description: Manual bank COA references must not route every transaction from one bank to an expense account.
---

Manual Referensi COA rules must include business-specific evidence such as beneficiary, bank reference, account, or an explicitly confirmed transaction type; a bank identifier alone is not enough to select an expense COA.

**Why:** A production rule matching only `BMRIIDJA` with full confidence and stop-processing routed a transfer to a cash custodian into Beban Bunga & Administrasi Bank.

**How to apply:** Audit active `recon_rules` for provider or bank-prefix-only conditions before allowing auto-post, and require the target COA to reflect the transaction's economic substance rather than the bank used.