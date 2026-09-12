# OWASP Top 10 Finance Module Audit
**Sprint 4.5 — Enterprise Security & Concurrency Certification**
**Date:** 2026-07-07
**Auditor:** Automated Security Audit (Sprint 4.5)
**Scope:** Finance, Allocation, Advance, Accounting, Cash, Bank modules

---

## Executive Summary

| OWASP Category | Status | Severity |
|---|---|---|
| A01 — Broken Access Control | ⚠️ PARTIAL | HIGH |
| A02 — Cryptographic Failures | ✅ PASS | — |
| A03 — Injection | ⚠️ PARTIAL | HIGH |
| A04 — Insecure Design | ✅ PASS | — |
| A05 — Security Misconfiguration | ⚠️ PARTIAL | MEDIUM |
| A06 — Vulnerable & Outdated Components | ✅ PASS | — |
| A07 — Identification & Authentication Failures | ✅ PASS | — |
| A08 — Software & Data Integrity Failures | ⚠️ PARTIAL | MEDIUM |
| A09 — Security Logging & Monitoring Failures | ⚠️ PARTIAL | MEDIUM |
| A10 — Server-Side Request Forgery | ✅ PASS | — |

**Overall OWASP Posture: PARTIAL PASS** — 6 of 10 categories PASS; 4 require remediation.

---

## A01 — Broken Access Control

### Findings

#### CRITICAL — IDOR in bankReceipts.ts
- **Location:** `artifacts/api-server/src/routes/bankReceipts.ts` — `GET /:id`, `PATCH /:id`, `DELETE /:id`
- **Issue:** Several routes fetch by numeric ID without calling `assertCompanyAccess`. A user with a valid session can access receipts from another company by incrementing the ID.
- **Recommendation:** Add `assertCompanyAccess(receipt.companyId, resolveCompanyId(req), req, res, ...)` after every record fetch, matching the pattern used in `cashAdvances.ts`.

#### HIGH — Administrative Over-Privilege in bankMutationMasters.ts
- **Location:** `artifacts/api-server/src/routes/bankMutationMasters.ts` line 8
- **Issue:** `requireAdmin` guards all routes including COA mapping and tax mapping writes. Admin is a flat role — there is no read-only Auditor exemption for these endpoints.
- **Recommendation:** Allow `requireAdmin` for mutations; expose read endpoints with `requireClerkUser` for Auditor/Controller visibility.

#### MEDIUM — Inconsistent Access Checks in expenses.ts
- **Location:** `artifacts/api-server/src/routes/expenses.ts` lines 445, 536
- **Issue:** `PATCH /:id` and `POST /:id/repost-journal` call `assertCompanyAccess` but do not additionally verify that the record's `created_by` matches the requester when non-admin users submit requests.
- **Recommendation:** For non-admin mutation paths, add ownership check: `if (!isAdmin && expense.createdBy !== req.userId) return 403`.

#### INFO — Positive Findings
- `cashAdvances.ts`: All `/:id` routes correctly call `assertCompanyAccess` after record fetch. ✅
- `expenseApprovals.ts`: Approval routes verify company membership before approval. ✅
- `allocation.ts`: `requireAdmin` at router level; individual operations re-verify company. ✅

---

## A02 — Cryptographic Failures

### Findings

**PASS** — No PII, payment card data, or passwords are stored unencrypted in the finance modules. Session authentication is delegated to the platform's session layer (SESSION_SECRET env var). Bank account numbers are not stored in the audited routes. Receipt files are stored in object storage with opaque keys.

---

## A03 — Injection

### Findings

#### HIGH — sql.raw() with Static but Unvalidated Strings
- **Location:** `artifacts/api-server/src/routes/expenses.ts` lines ~300, 395, 442, 505
- **Location:** `artifacts/api-server/src/routes/bankMutationMasters.ts` lines ~173, 219, 279, 337
- **Location:** `artifacts/api-server/src/routes/bankDisbursements.ts` lines ~408, 469, 528
- **Issue:** Multiple uses of `sql.raw()` and `db.execute(sql\`...\`)` with dynamic content. Drizzle's `sql` tagged template interpolates values as parameterized bindings — this is **safe**. However, `sql.raw(userInput)` or `sql.raw(\`... ${req.body.field} ...\`)` bypasses parameterization entirely.
- **Clarification:** Most findings are `sql\`...\${variable}...\`` (Drizzle parameterized — SAFE). True `sql.raw(userInput)` occurrences are the actual risk.
- **Specific Risk:** `bankMutationMasters.ts` — filter/sort column names constructed from query params without allowlist validation could allow column-name injection in ORDER BY clauses.
- **Recommendation:** Allowlist all sort columns and filter field names. Replace any true `sql.raw(userInput)` with `sql\`${sql.param(value)}\`` or Drizzle ORM methods.

#### MEDIUM — Dynamic Table/Schema Selection
- **Location:** `artifacts/api-server/src/routes/bankDisbursements.ts` — complex join queries
- **Issue:** Some queries build JOIN clauses dynamically based on `type` or `category` fields. These are not direct user-input strings, but the pattern is risky if input validation regresses.
- **Recommendation:** Add explicit string allowlists for any value inserted into structural SQL positions.

#### INFO — Positive Findings
- No `eval()` with SQL detected anywhere. ✅
- Primary CRUD in `cashAdvances.ts` uses Drizzle ORM typed queries. ✅
- `assertCompanyAccess` always uses parameterized company_id binding. ✅

---

## A04 — Insecure Design

### Findings

**PASS** — The architecture follows defense-in-depth: session auth → role middleware → company isolation → resource ownership. Dual-write patterns and idempotency keys are present in marketplace routes. Journal immutability is enforced via DB triggers (`ae_immutability`). No business logic bypass paths identified.

---

## A05 — Security Misconfiguration

### Findings

#### MEDIUM — Verbose Error Messages Leaking Internal Details
- **Location:** All audited files — catch blocks return `e.message` directly
- **Issue:** Database errors, column names, and internal constraint names may be exposed to the client via `res.status(500).json({ message: e.message })`.
- **Example:** A unique constraint violation exposes table/column names in the error message.
- **Recommendation:** Wrap all catch blocks with a sanitizer: log the full error server-side, return only a generic `"Terjadi kesalahan internal."` message to the client. Add a production error filter middleware.

#### LOW — Missing Rate Limiting on Finance Mutation Endpoints
- **Issue:** No rate limiting observed on `POST /api/cash-advances`, `POST /api/expenses`, or approval endpoints. A compromised session could loop-submit large numbers of records.
- **Recommendation:** Add express-rate-limit middleware on mutation endpoints (e.g., 30 req/min per session).

---

## A06 — Vulnerable & Outdated Components

### Findings

**PASS** — No obviously outdated packages identified in the finance module's direct dependencies. `multer`, `drizzle-orm`, and `express` are present in recent versions. Recommend running `pnpm audit` periodically in CI.

---

## A07 — Identification & Authentication Failures

### Findings

**PASS** — All finance routes are behind at minimum `requireAdmin` or `requireClerkUser`. No endpoints are publicly accessible. Session validation is enforced at the platform level. No JWT secret hardcoding found in audited files.

---

## A08 — Software & Data Integrity Failures

### Findings

#### MEDIUM — Audit Log Integrity (No Hash Chain)
- **Location:** `artifacts/api-server/src/lib/auditLog.ts`
- **Issue:** `erp_audit_logs` rows can be `UPDATE`d or `DELETE`d via direct DB access. No hash chain or append-only enforcement. "Fire-and-forget" pattern means audit writes can silently fail.
- **Recommendation:** See `docs/security-certification.md` § Audit Log Hardening.

#### INFO — Positive Findings
- DB-level journal immutability triggers (`ae_insert_guard`, `ae_immutability`) protect `accounting_entries` from post-post modification. ✅
- `financial_outbox_events` provides event-driven integrity check. ✅

---

## A09 — Security Logging & Monitoring Failures

### Findings

#### MEDIUM — Incomplete Audit Coverage
- **Issue:** `auditFromReq` is called on most mutations but is fire-and-forget. Failed writes produce no alert. Several read operations (list, detail) are not logged — making data exfiltration harder to detect.
- **Recommendation:** Make audit writes synchronous on critical paths (approve, void, delete). Add structured alerting for repeated 403/401 responses from the same session.

#### LOW — No Anomaly Detection
- **Issue:** No monitoring on unusual patterns (e.g., same user approving 50 advances in 1 minute, or accessing 100 different company IDs in one session).
- **Recommendation:** Add a lightweight anomaly counter in the audit log; alert when thresholds are crossed.

---

## A10 — Server-Side Request Forgery

### Findings

**PASS** — No user-controlled URLs are fetched server-side in the finance modules. The OpenAI receipt OCR sends image data (not a URL) to the API. Object storage uploads use a fixed key template, not user-supplied URLs. No webhook endpoints in the audited routes.

---

## Remediation Priority

| Priority | Finding | Effort |
|---|---|---|
| P1 | A01 — IDOR in bankReceipts /:id routes | Low (add assertCompanyAccess calls) |
| P2 | A03 — sql.raw() allowlist for sort/filter columns | Low (add validation function) |
| P3 | A05 — Sanitize error messages in production | Low (add error filter middleware) |
| P4 | A08/A09 — Audit log tamper protection | Medium (add DB trigger + sync writes on critical paths) |
| P5 | A05 — Rate limiting on mutation endpoints | Low (add express-rate-limit) |

---

*Generated: Sprint 4.5 Security Certification — 2026-07-07*
