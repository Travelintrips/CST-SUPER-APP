---
name: PROD COA resolution
description: Durable evidence rules for resolving production receiving-bank and MDR expense COAs.
---

An exact production bank identity may already be linked and postable while still
failing the canonical contract because `company_id` is NULL. Treat that as an
ownership defect only when the exact bank identity, active/postable flags,
parent, and company-scoped sibling structure all agree; do not replace it with
a header account.

**Why:** The receiving-bank account can be semantically correct while an
orphaned/non-company-scoped ownership field makes shared configuration fail
closed. Broad schema promotion is not a substitute for resolving that business
identity.

**How to apply:** Audit the live PROD catalog in a read-only transaction first.
For MDR, require a collision-free code plus a deterministic expense parent and
postable sibling convention. Apply only guarded COA metadata/additive changes,
never payment history, then verify roles read-only before considering the
separate shared-foundation migration.