---
name: Intercompany COA self-healing
description: Durable rule for structural COA accounts used by intercompany advance posting.
---

The accounting seed's completeness fast-path can legitimately skip a database that already has the old COA set, leaving newly introduced structural accounts absent for existing companies. Intercompany posting must therefore idempotently ensure the `1-1099` receivable and `2-2098` payable accounts exist and are active at the point of use; category-specific expense mappings should remain strict.

**Why:** Existing advances can outlive the seed version that created them, and repayment must not depend on a full reseed or on the advance having been created after the COA templates were added.

**How to apply:** When adding a new structural COA required by a posting path, keep the seed for normal provisioning but also add a narrow, type-checked, idempotent ensure step in the shared resolver/service before journal creation.