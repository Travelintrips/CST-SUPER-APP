# Final GO Checklist

**Version:** RC-2.2  
**Last Updated:** 2026-07-24  
**Verdict:** ⛔ NO-GO

> GO may only be declared when **every item** in this checklist is checked by a human.
> Do not auto-check any item. Each checkbox requires a human action and verifiable evidence.
> No credential values may appear in this file.
>
> Reference: `docs/release/release-evidence-matrix.md` for evidence requirements per item.

---

## Section 1 — Automated Gate Results

Each item must be confirmed by running the corresponding script and observing exit 0.

- [ ] **Static PASS** — `pnpm run audit:customer-static` → exit 0
  - Evidence: build log confirming 917 tests PASS, 0 TypeScript errors, 4 packages built
- [ ] **Runtime PASS** — `pnpm run audit:customer-runtime` → exit 0
  - Evidence: health log confirming DB connected, workers running
- [ ] **Secret Availability PASS** — `pnpm run audit:secrets` → exit 0; MISSING: 0; INVALID: 0
  - Evidence: secrets audit JSON output
- [ ] **Secret Rotation PASS** — `pnpm run audit:secret-rotation` → exit 0
  - Evidence: `docs/security/secret-rotation-status.json` — all 19 credentials `rotated=true`, `oldCredentialRevoked=true`, `verified=true`, `verifiedByOwner=true`
- [ ] **Dedicated Staging Available** — `TEST_DATABASE_URL` injected; staging is NOT prod or shared dev
  - Evidence: `psql $TEST_DATABASE_URL -c "SELECT current_database()"` output confirming staging project name
- [ ] **HTTP E2E PASS** — `pnpm run audit:customer-http-e2e` → exit 0 on dedicated staging
  - Evidence: E2E JSON report confirming all 16 business scenarios PASS
- [ ] **Tenant Isolation PASS** — verified inside HTTP E2E output
  - Evidence: E2E sub-report confirming cross-tenant isolation
- [ ] **Security PASS** — verified inside HTTP E2E output
  - Evidence: E2E sub-report confirming auth 401, RBAC, token expiry, rate-limit
- [ ] **Accounting PASS** — verified inside HTTP E2E output
  - Evidence: E2E sub-report confirming journal immutability, period lock, balanced entries
- [ ] **SSE PASS** — verified inside HTTP E2E output
  - Evidence: E2E sub-report confirming SSE event received within timeout
- [ ] **Cleanup PASS** — post-run cleanup validation inside HTTP E2E
  - Evidence: E2E cleanup log confirming all `RUNTIME_TEST_RUN_ID`-tagged records deleted
- [ ] **Production Gate PASS** — `pnpm run audit:customer-production` → exit 0
  - Evidence: `summary.json` showing `"production": "GO"`, no blocker reasons

---

## Section 2 — Infrastructure & Operations

Each item must be confirmed by a human with access to the relevant dashboard or system.

- [ ] **Backup Verified**
  - Supabase production backup timestamp < 24 hours
  - Backup downloaded and spot-checked
  - Restore tested on staging environment — passed
  - Backup stored offsite (encrypted)
  - Backup verification timestamp: _______________

- [ ] **Rollback Tested on Staging**
  - Application rolled back to previous version on staging
  - Health checks passed after rollback
  - Database rollback procedure confirmed with account owner
  - Secret rollback procedure confirmed — previous credential values accessible

- [ ] **Monitoring Enabled**
  - Uptime monitor active for `/api/health` (60-second interval)
  - Alert channel confirmed — on-call contact designated
  - Supabase dashboard metrics visible
  - Error monitoring configured (Sentry or log aggregator)

- [ ] **Production Secrets Verified** — all production secrets in Replit Deploy → Secrets panel
  - `SUPABASE_DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
  - `SESSION_SECRET`, `PORTAL_JWT_SECRET`, `DRIVER_JWT_SECRET`, `CASHIER_TOKEN_SECRET`
  - `FONNTE_TOKEN`, `WATI_API_TOKEN`, `SMTP_PASS`
  - `PAYLABS_PRIVATE_KEY`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`
  - No placeholder values

- [ ] **Payment Integration Verified** (without real production transactions)
  - Paylabs: health/verification endpoint returns 200 with production key
  - Sandbox callback tested and signature validated
  - If Paylabs provides no verification endpoint: owner-approved alternative procedure completed

- [ ] **Deployment Window Approved**
  - Deployment time slot agreed with account owner
  - Team notified of deployment schedule
  - On-call engineer available for 2 hours post-deployment

---

## Section 3 — Sign-Off

> All four sign-offs must be obtained before deployment proceeds.
> Sign-offs are individual — one person may not sign multiple roles.

| Role | Full Name | Date (YYYY-MM-DD) | Signature / Confirmation |
|---|---|---|---|
| **Account Owner** | | | |
| **Technical Lead** | | | |
| **Release Lead** | | | |
| **Security Owner** | | | |

**Deployment may not proceed until all items in Sections 1, 2, and 3 are complete.**

---

## Final Verdict

```
Status: ☐ GO  /  ☐ NO-GO

Declared by: ___________________________
Date/Time:   ___________________________
```

> GO may only be declared — and this field checked — after every checkbox above is confirmed.
> The verdict must match the output of `pnpm run audit:customer-production` (`summary.json`).
> Verdict remains NO-GO until rotasi secret selesai, dedicated staging tersedia,
> dan seluruh HTTP E2E beserta gate operasional benar-benar lulus.
