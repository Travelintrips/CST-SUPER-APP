---
name: writeMethodGovernanceGuard exemption for allocation routes
description: Why allocation routes must not use writeMethodGovernanceGuard and what to use instead
---

`writeMethodGovernanceGuard` calls `requireOpenPeriod` which requires `req.body.date` (literal key).
Allocation routes use `allocation_date` in body, and action endpoints (submit/approve/reject/reverse) send no date at all.
Result: all POST/PATCH → 422 `PERIOD_DATE_REQUIRED`.

**Fix:** Register allocation router in `routes/index.ts` without `writeMethodGovernanceGuard`:
```typescript
router.use("/allocation", financeAuditMiddleware, makeRbacGuard("invoice"), allocationRouter);
```

**Why it's safe:**
1. `allocationRouter` has `requireAdmin` guard at top (more restrictive than `requireFinanceWriteRole`)
2. Period lock is checked inside `_postEntryCore` (accounting.ts) when journal is actually created
3. Action endpoints (submit/approve/reject) don't create journal entries so period lock is irrelevant

**How to apply:** Never add `writeMethodGovernanceGuard` back to the allocation route without also fixing the date field mapping.
