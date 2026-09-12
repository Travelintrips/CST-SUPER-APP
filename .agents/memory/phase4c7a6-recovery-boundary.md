---
name: Phase 4C-7A.6 recovery boundary
description: Development-only recovery behavior for historical Sport Center payment mirrors.
---

The approved trigger-owned replay can resolve company, provider, external bank, internal bank, settlement rule, and derived settlement date into the public mirror without directly updating the historical canonical payment row. Accounting and settlement must remain stopped when their normal handoff is explicitly isolated; a confirmed payment-accounting outbox failure is evidence of that boundary, not permission to retry through a generic post path.

**Why:** The historical payment recovery path is intentionally fail-closed: mirror metadata recovery is safe and idempotent, while bypassing the isolated accounting or settlement pipeline would risk duplicate journals or settlement records. The development runtime can show a failed `payment_confirmed` outbox row while the public mirror remains `unposted`; that state must be reported as blocked until an approved handoff exists.

**How to apply:** Verify the development runtime, approved configuration, trigger/function definitions, and complete pre-state first; invoke only the canonical replay function; verify one mirror and zero manual accounting/settlement/reconciliation mutations; report PARTIAL when the mirror is recovered but downstream pipelines remain isolated, or BLOCKED when the required accounting handoff is explicitly isolated or its outbox is failed.