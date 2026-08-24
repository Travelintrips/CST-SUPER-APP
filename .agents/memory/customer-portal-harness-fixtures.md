---
name: Customer Portal harness fixtures
description: Runtime customer lifecycle proofs need company membership and a narrowly enabled reset-token capture.
---

Customer Portal lifecycle fixtures that create sales orders must create exactly one active `portal_company_members` row per test customer; the service intentionally fails closed without an unambiguous company scope. Password-reset runtime proofs use the loopback-only capture endpoint only when the development safe-mode harness flag is enabled.

**Why:** The production contract rejects customer actions without an active company membership, and exposing reset artifacts outside the explicit DEV harness would weaken the authentication boundary.

**How to apply:** Build membership setup and cleanup into reversible DEV harnesses, pass the capture flag only to the isolated harness process/workflow, and never enable it in production.