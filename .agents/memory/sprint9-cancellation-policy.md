---
name: Sprint 9 cancellation policy
description: Approved cancellation boundary for Marketplace payment workflow.
---

Cancellation is allowed only before Treasury starts payment execution. Once execution begins, AP cancellation is forbidden. Failed payments follow BD-09-006; successful payments are corrected only through the BD-09-010 reversal/refund workflow. Cancellation requires authorization, validated reason, idempotency, and a complete audit trail, and cannot directly change amount, vendor, bank account, allocation, or business-payment identity.

**Why:** The Product Owner approved this boundary to prevent AP cancellation from diverging from provider execution and accounting state.

**How to apply:** Enforce the execution-start cut-off server-side and keep post-execution correction separate from AP cancellation.