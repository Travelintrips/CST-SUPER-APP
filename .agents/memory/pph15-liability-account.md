---
name: PPh 15 liability account
description: Durable mapping rule for PPh 15 withholding and legacy invoice handling.
---

PPh 15 withholding must use the company-scoped, postable liability COA `2-1102` (for CST: `2-1102-CST`, Hutang PPh Final Pasal 15). The generic `2-1030` account remains a legacy mapping and must not be used as the default for new PPh 15 settlement flows. Treat the COA code as the stable identity; a legacy environment may still have an old display name.

**Why:** Finance evidence identified `2-1102-CST` as the approved dedicated account. Repointing old posted journals or changing an existing invoice requires a separate, explicit correction decision.

**How to apply:** Keep tax master mappings, default account resolvers, and invoice review suggestions aligned to `2-1102`, validating code/type/postability rather than display name alone. Before correcting historical PROD data, verify the live account is active, postable, liability-typed, and owned by the intended company.