---
name: Customer Portal harness fixtures
description: Runtime customer lifecycle proofs need company membership and a narrowly enabled reset-token capture.
---

Customer Portal lifecycle fixtures that create sales orders must create exactly one active `portal_company_members` row per test customer; the service intentionally fails closed without an unambiguous company scope. Password-reset runtime proofs use the loopback-only capture endpoint only when the development safe-mode harness flag is enabled.

**Why:** The production contract rejects customer actions without an active company membership, and exposing reset artifacts outside the explicit DEV harness would weaken the authentication boundary.

**How to apply:** Build membership setup and cleanup into reversible DEV harnesses, pass the capture flag only to the isolated harness process/workflow, and never enable it in production.

Fixture identity allocation must synchronize both payment and sales-document sequences against legacy reference surfaces before creating rows, then run namespace-aware collision checks. Payment IDs must be checked against payment-owned sources; document IDs against invoice-owned sources.

**Why:** DEV can retain valid legacy journals, settlement items, and processing rows after their source fixtures are removed. Syncing only the base table sequence causes long retry loops or false collisions when payment and document IDs happen to share a number.

**How to apply:** Keep the allocation guard DEV-only and fail closed on any pre-existing identity. Advance sequences monotonically from the relevant legacy reference maxima; never delete those legacy rows as part of fixture cleanup.