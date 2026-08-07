---
name: Sprint 7 runtime evidence
description: Runtime proof and regression harness constraints for Marketplace vendor invoice closure.
---

The Marketplace vendor-invoice lifecycle can be validated safely against the development Supabase database with temporary fixtures: happy path, three-way-match failures, idempotent retry, concurrent submit/create, immutable PO/GR/shipment snapshots, activity-log/notification deduplication, and cleanup all passed.

**Why:** The API runtime database is the authoritative target for Sprint 7 evidence; unit tests alone do not prove migration, locking, queue, and cleanup behavior.

**How to apply:** Keep future E2E fixtures development-only, verify the DB target first, wait for `/api/health/ready` to become true, and always query for zero fixture rows after cleanup.

The legacy vendor quote `.mjs` harness imports `artifacts/lib/db/dist/index.js`, while the current `@workspace/db` build emits declaration-only output under `lib/db/dist`; treat direct execution failure as a harness/layout limitation unless the test is migrated to the current Vitest/runtime setup.

**Why:** Re-running after `build:libs` and a temporary path shim still cannot produce the imported JavaScript module, while the Marketplace lifecycle and Vitest regressions pass.

**How to apply:** Do not alter application logic to accommodate this old import; migrate the harness separately before counting that gate as executable.