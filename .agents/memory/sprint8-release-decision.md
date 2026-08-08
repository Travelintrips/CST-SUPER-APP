---
name: Sprint 8 release decision evidence
description: Legacy regression failures must be separated from the Marketplace AP handoff scope during Sprint 8 release decisions.
---

Sprint 8 release decisions treat legacy shipment, freight, governance, dashboard, payment, seed, and unauthenticated harness failures as release backlog when AP Preparation, Vendor Invoice, 3-Way Match, Ready for AP, Finance Review, and Waiting Payment are unaffected.

**Why:** The shared regression harness reports cross-project failures that can obscure a clean Sprint 8 result; a scoped GO is not a general production-security or full-workspace GO.

**How to apply:** Record each failure with its module and scope, require a NO-GO for any failure in the six Sprint 8 financial-handoff stages, and keep unrelated typecheck/security findings visible as backlog items.