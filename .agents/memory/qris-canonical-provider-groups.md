---
name: QRIS canonical provider groups
description: Compatible bank-provider aliases may match evidence but remain separate settlement groups.
---

Provider aliases such as a GPN bank label and a Mandiri payment label may be compatible for matching evidence, but payments with different canonical provider identities must be approved as separate partial-settlement groups.

**Why:** The canonical settlement owner groups by exact company, provider, bank account, settlement date, and rule version. Combining compatible aliases in one builder call fails group validation and can leave reviewers repeatedly retrying a valid-looking batch.

**How to apply:** Detect mixed canonical groups before invoking the builder, preserve only the source payment's exact group in the UI selection, and process any remaining group in a later partial approval. Never silently drop or relabel a selected payment.