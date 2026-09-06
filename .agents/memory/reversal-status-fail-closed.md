---
name: Reversal status fail-closed
description: Production accounting reversal behavior when the reversal entry is created but original-entry metadata cannot be updated
---

Reversal workflows must treat creation of the reversal entry and marking the original entry voided as one required outcome. A reversal entry alone is not enough to authorize downstream deletion or cleanup.

**Why:** The database immutability trigger can reject a posted-to-voided metadata update. The generic reversal helper may still return success after that update failure, leaving a balanced reversal alongside an original entry that is still marked `posted`.

**How to apply:** After every reversal, verify exactly one posted reversal, matching company/source identity, balanced lines, and the original `void_entry_id` plus voided status. If metadata correction is necessary, perform only the narrowly scoped status/link update in an isolated transaction, re-enable protections before commit, and stop all destructive work if verification fails. In PROD, a legacy posted-update trigger may conflict with the ledger trigger's governed `posted → voided` allowance; never leave that protection disabled or bypass financial-field immutability.