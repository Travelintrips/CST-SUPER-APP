# PPJK Pre-Production Backlog

## BACKLOG-001 — Drizzle Schema Inconsistency: ppjk_audit_logs onDelete

**Priority:** Low  
**Blocking:** No  
**Identified:** 2026-07-21  
**Phase:** Pre-Production Validation

### Finding

`lib/db/src/schema/ppjkOrders.ts:108` declares:
```typescript
ppjkOrderId: integer("ppjk_order_id")
  .notNull()
  .references(() => ppjkOrdersTable.id, { onDelete: "cascade" })
```

The actual production database has **no FK constraint** on `ppjk_audit_logs.ppjk_order_id`.

### Design Intent (Evidence)

`artifacts/api-server/src/routes/ppjk.ts:1283–1286`:
```
// All deletions are logged to ppjk_audit_logs before execution
// so the audit trail is preserved even after the row is gone.
```

The system is designed for **audit retention** after order deletion. The Drizzle `onDelete: "cascade"` annotation contradicts this intent.

### Required Action

Remove `{ onDelete: "cascade" }` from the `ppjkAuditLogsTable` `ppjkOrderId` column reference in `lib/db/src/schema/ppjkOrders.ts`.

```typescript
// CURRENT (incorrect):
.references(() => ppjkOrdersTable.id, { onDelete: "cascade" })

// CORRECT (matches design intent):
.references(() => ppjkOrdersTable.id)
// or remove .references() entirely if no FK is intended
```

**Do NOT apply a new migration.** The DB already has no FK — only the Drizzle schema annotation needs correction. Applying the Drizzle migration would create a CASCADE FK, which would break the retention policy.

### Impact if Left as-is

None to runtime — the DB has no FK, so behavior is unaffected. Risk: a future developer runs `drizzle-kit generate` and applies the generated migration, accidentally adding the CASCADE FK, causing audit logs to be deleted with orders.

---

## BACKLOG-002 — Audit Metadata Enhancement

**Priority:** Low  
**Blocking:** No

Add `role`, `company_id`, `ip_address`, `user_agent` as first-class columns to `ppjk_audit_logs` to complete Phase 9 audit trail requirement (currently only in `ppjk_status_logs` for workflow events).
