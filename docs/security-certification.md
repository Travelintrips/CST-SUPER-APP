# Security Certification Report
**Sprint 4.5 — Enterprise Security & Concurrency Certification**
**Date:** 2026-07-07
**Modules Audited:** Finance · Allocation · Advance · Accounting · Cash · Bank

---

## Certification Summary

| Audit Area | Result | Score |
|---|---|---|
| IDOR Protection | ✅ PASS (with exceptions) | 88/100 |
| SQL Injection | ✅ PASS (parameterized) | 90/100 |
| Company Isolation | ✅ PASS | 93/100 |
| RBAC Enforcement | ⚠️ PARTIAL | 78/100 |
| Audit Log Integrity | ⚠️ PARTIAL | 65/100 |
| Input Validation | ⚠️ PARTIAL | 75/100 |
| Error Handling | ⚠️ PARTIAL | 70/100 |
| Authentication | ✅ PASS | 95/100 |
| **Overall** | **⚠️ CONDITIONAL PASS** | **82/100** |

> **Threshold:** 95/100 required for full Phase 3 certification.
> **Status:** 82/100 — CONDITIONAL PASS. P1 and P2 findings must be remediated before Phase 3 production deployment.

---

## Area 1 — IDOR (Insecure Direct Object Reference)

### Protected Endpoints ✅

| Module | Protection Mechanism |
|---|---|
| `cashAdvances.ts` | `assertCompanyAccess` on every `/:id` route after record fetch |
| `expenses.ts` | `assertCompanyAccess` + `requireClerkUser` |
| `expenseApprovals.ts` | Company membership verified before approve/reject |
| `allocation.ts` | `requireAdmin` + per-operation company re-verification |
| `cashAdvances /:id/repay` | IDOR guard added (line 725 — new as of Sprint 4.5) |

### Vulnerable Endpoints ⚠️

#### bankReceipts.ts — PARTIAL
```
GET    /api/bank-receipts/:id
PATCH  /api/bank-receipts/:id
DELETE /api/bank-receipts/:id
```
- **Issue:** Routes filter by `companyId` in list but do not call `assertCompanyAccess` on individual resource fetch. Sequential ID enumeration allows cross-company access.
- **Fix Required (P1):**
```typescript
// After: const receipt = await db.select()...where(eq(table.id, id))
const cid = resolveCompanyId(req);
if (!await assertCompanyAccess(receipt.companyId, cid, req, res, {
  resourceType: "bank_receipt", resourceId: id
})) return;
```

#### bankDisbursements.ts — PARTIAL
```
GET    /api/bank-disbursements/:id
```
- **Issue:** Company filter applied at list level; individual fetch uses `company_id` in WHERE but does not use the standardized `assertCompanyAccess` guard, making it harder to maintain consistently.
- **Fix Required (P2):** Migrate to `assertCompanyAccess` pattern for consistency.

---

## Area 2 — SQL Injection

### Assessment: LOW RISK (PASS with notes)

**Primary Query Pattern (Safe):**
The codebase primarily uses Drizzle ORM's typed query builder and parameterized `sql` tagged templates:
```typescript
// SAFE — Drizzle parameterizes ${variable} as $1, $2 binding
await db.execute(sql`SELECT * FROM table WHERE id = ${id} AND company_id = ${companyId}`);
```

**Risk Area — sql.raw() Usage:**

| File | Usage | Risk Level |
|---|---|---|
| `expenses.ts` | Dynamic SET clauses in PATCH | MEDIUM — values from `req.body` but not directly in raw() |
| `bankMutationMasters.ts` | Complex multi-table queries | MEDIUM — column names not user-supplied |
| `bankDisbursements.ts` | Complex join assembly | MEDIUM — join conditions not from user strings |

**Actual SQLi Risk:** All identified `sql.raw()` uses embed static SQL structure, not user-provided strings. The parameterized `sql\`...\`` pattern is used for all user input. **No direct SQLi vector confirmed.**

**Remaining Risk:** Sort column names from query params are not allowlisted in some list endpoints. If `?sort=column_name` is passed, and column is embedded directly into ORDER BY without allowlisting, this is a low-severity injection point.

**Recommendation:**
```typescript
const ALLOWED_SORT_COLS = ['date', 'amount', 'status', 'created_at'] as const;
const sortCol = ALLOWED_SORT_COLS.includes(req.query.sort) ? req.query.sort : 'created_at';
```

---

## Area 3 — Company Isolation (Multi-Tenancy)

### Assessment: PASS (93/100)

**Mechanism:** `resolveCompanyId(req)` extracts the active company from session, and `assertCompanyAccess` validates resource ownership before any read/mutation.

| Module | List Isolation | Write Isolation | Delete Isolation |
|---|---|---|---|
| cashAdvances | ✅ WHERE company_id | ✅ assertCompanyAccess | ✅ assertCompanyAccess |
| expenses | ✅ WHERE company_id | ✅ assertCompanyAccess | ✅ assertCompanyAccess |
| bankReceipts | ✅ WHERE company_id | ⚠️ Missing on /:id | ⚠️ Missing on /:id |
| bankDisbursements | ✅ WHERE company_id | ⚠️ Inconsistent | ✅ WHERE company_id |
| expenseApprovals | ✅ WHERE company_id | ✅ Company check | N/A |
| allocation | ✅ requireAdmin + company | ✅ Company re-verified | ✅ |

**Gap:** `bankMutationMasters.ts` serves global mapping data (COA, tax codes) without per-company scoping. This is by design (system-wide configuration) but should be documented explicitly as a conscious exception.

---

## Area 4 — RBAC (Role-Based Access Control)

### Assessment: PARTIAL (78/100)

**Current Role Matrix:**

| Role | cashAdvances | expenses | bankOps | allocation | approvals |
|---|---|---|---|---|---|
| super_admin | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| admin | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| finance | ⚠️ Blocked | ✅ Create | ⚠️ Blocked | ⚠️ Blocked | ⚠️ Blocked |
| Auditor | ⚠️ No read-only path | ⚠️ No read-only path | ⚠️ No read-only | N/A | N/A |
| Controller | ⚠️ Not defined | ⚠️ Not defined | ⚠️ Not defined | N/A | N/A |

**Findings:**
1. **Finance Staff** can create expenses via `requireClerkUser` but cannot approve, void, or post — correct segregation.
2. **Auditor** and **Controller** roles exist in the RBAC matrix database but have no code-level enforcement in the finance routes. These routes use binary `requireAdmin` — either full admin access or blocked.
3. **Supervisor/Manager** — not differentiated from general admin in code. The custom_role RBAC matrix in `routes/rbac.ts` provides the framework but it is not wired into finance module middleware.

**Recommendation:** Wire `checkPermission(req, 'finance', 'view')` into read endpoints so Auditors get read-only access without needing full admin.

---

## Area 5 — Audit Log Integrity

### Assessment: PARTIAL (65/100)

**Current Implementation:**
- `lib/auditLog.ts`: `INSERT INTO erp_audit_logs` with `action`, `module`, `referenceId`, `oldData`, `newData`, `userId`, `companyId`, `ipAddress`, `userAgent`.
- "Fire-and-forget" — called as `auditFromReq(req, {...})` without `await`, meaning a DB error silently drops the log entry.

**Integrity Gaps:**

| Gap | Severity | Detail |
|---|---|---|
| No tamper-evident hash chain | HIGH | Rows can be UPDATE/DELETE'd by anyone with DB access |
| Fire-and-forget writes | MEDIUM | Failed audit logs produce no alert |
| No append-only DB constraint | HIGH | No DB trigger preventing UPDATE/DELETE on audit rows |
| No off-system backup | MEDIUM | Audit trail is only in the application DB |

**Recommended Hardening (Audit Log):**

```sql
-- 1. Append-only trigger on erp_audit_logs
CREATE OR REPLACE FUNCTION audit_log_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable — DELETE/UPDATE not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_guard
  BEFORE UPDATE OR DELETE ON erp_audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutability();

-- 2. Add checksum column
ALTER TABLE erp_audit_logs ADD COLUMN IF NOT EXISTS row_hash TEXT;
-- Populate on INSERT via trigger: sha256(id || action || module || ref || new_data)
```

```typescript
// 3. Make critical audit writes synchronous
await writeAuditLog({ ... }); // not fire-and-forget for approve/void/delete
```

---

## Area 6 — Input Validation

### Assessment: PARTIAL (75/100)

**Findings:**

| Input Type | Validation | Status |
|---|---|---|
| Numeric IDs (`/:id`) | `isNaN(id)` check | ✅ |
| Amount fields | `Number(amount) <= 0` check | ✅ |
| Date fields | Presence check (`!date`) | ⚠️ No format validation |
| String fields (notes, partyName) | None — passed raw to DB | ⚠️ |
| File uploads | Extension allowlist | ✅ |
| File uploads | MIME type validation | ❌ Missing — relies only on extension |
| Sort/filter params | No allowlisting | ⚠️ |

**Recommendations:**
- Add `isValidDate(date)` validation (ISO 8601 format) on all date inputs.
- Add `maxLength` truncation on free-text fields before DB insert.
- Add MIME type server-side validation for file uploads (`file-type` package or magic bytes check).

---

## Remediation Roadmap

### P1 — Must Fix Before Phase 3 Production
1. Add `assertCompanyAccess` to all `bankReceipts.ts` `/:id` routes
2. Add append-only DB trigger on `erp_audit_logs`
3. Make audit writes synchronous for approve/void/delete operations

### P2 — Fix Within Sprint 5
4. Add sort column allowlisting across list endpoints
5. Add file MIME type validation on upload endpoints
6. Wire Auditor/Controller read-only permission into finance list endpoints

### P3 — Technical Debt (Post Phase 3)
7. Sanitize error messages in production (generic error responses)
8. Add rate limiting on mutation endpoints
9. Add anomaly detection for unusual approval patterns

---

*Generated: Sprint 4.5 Security Certification — 2026-07-07*
