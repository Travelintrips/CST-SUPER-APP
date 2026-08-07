---
name: Activity log runtime schema
description: Marketplace activity log columns can be absent in the Supabase development runtime even when the Drizzle schema and application logger expect them.
---

The development runtime database must be checked against the application schema before running marketplace E2E evidence. `activity_logs` may lack the marketplace foreign-key columns while `activityLog.ts` inserts them, causing E2E setup and cleanup to fail before Vendor PO lifecycle assertions run.

**Why:** The application and runtime schema can drift across environments; declaring Sprint 4 complete from unit tests alone would hide a missing runtime audit trail.

**How to apply:** Before Vendor PO runtime evidence, verify the runtime columns used by `logActivity()` and ensure fixture cleanup does not assume columns that are absent. Treat a mismatch as a separate schema/test follow-up, not as an in-scope Sprint 4 behavior fix.