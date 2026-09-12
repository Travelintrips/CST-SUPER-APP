---
name: Customer Portal finance scope
description: Current owner and deferred finance configuration decisions for Customer Portal.
---

Customer Portal is scoped to company ID 1 for the current finance-readiness work. Paylabs settlement/bank configuration and tax rules are intentionally deferred until explicitly brought back into scope.

**Why:** The owner chose to establish tenant ownership first and postpone provider/tax decisions rather than create unapproved finance configuration.

**How to apply:** Preserve company ID 1 through the Customer Portal payment/event path, but keep tax, Paylabs, settlement, and reconciliation fail-closed until their own approved configuration audit is completed.