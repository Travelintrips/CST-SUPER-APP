---
name: Sprint 09E runtime proof
description: Evidence boundary and startup-readiness behavior for Marketplace reconciliation-link verification
---

## Rule
Sprint 09E contract/schema verification is separate from runtime proof. The existing runtime harness proves Sprint 09D accounting handoff, but does not prove the Sprint 09E reconciliation-link endpoint; do not claim Sprint 09E complete without an approved runtime harness.

**Why:** The API can be fully functional while `/api/health/ready` remains false during the sequential serial-sequence startup scan. A successful handoff proof also does not establish create/reuse/conflict/immutability and bank-reconciliation boundary behavior for the new link.

**How to apply:** Wait for readiness to become true before runtime writes. Use the existing development-only handoff harness for Sprint 09D, and treat Sprint 09E as partial/no-go until a dedicated approved proof covers the reconciliation-link endpoint with cleanup and boundary assertions.

## Runtime harness constraint
The development admin session does not carry company context automatically; runtime calls that use `resolveCompanyId` must explicitly target the fixture company with the supported `companyId` query parameter.

**Why:** The official endpoint fails closed when an admin request has no assigned company and no explicit context. Omitting this context makes the harness fail before the reconciliation-link flow starts, even though the API and database are healthy.

**How to apply:** Keep the client payload reference-only and send `?companyId=<fixture company>` on development verification requests; never add amount, currency, vendor, company, or reference fields to the request body.