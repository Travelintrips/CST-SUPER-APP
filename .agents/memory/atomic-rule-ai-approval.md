---
name: Atomic Rule AI approval
description: The manual COA picker teaches Rule AI while creating the current draft journal.
---

Manual COA selection is a single business operation: persist or update the Rule AI row, synchronize its `recon_rules` runtime mirror, and create the draft journal through the same transaction client. Use a stable idempotency key for a retry of the same selection and serialize the logical Rule AI identity before upsert.

**Why:** Saving Rule AI through a separate request could activate a rule while journal creation failed, leaving runtime matching and reviewer state inconsistent.

**How to apply:** Extend the approval transaction with the Rule AI payload; do not reintroduce a fire-and-forget or pre-approval Rule AI write. Keep the existing journal governance and post-commit cache invalidation intact.