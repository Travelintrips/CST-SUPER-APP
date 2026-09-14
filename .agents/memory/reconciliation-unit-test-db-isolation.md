---
name: Reconciliation unit-test DB isolation
description: How to test the bank approval engine without a live isolated database.
---

Regression tests that import the unified matching engine must mock the database module, Drizzle SQL helper, accounting poster, logger, and failed-job capture. The engine's imported DB client validates the test connection string before any test runs, so a pure unit test cannot rely on the default test setup.

**Why:** the isolated regression database is intentionally fail-closed and may not be provisioned in every workspace, while the approval path can still be exercised with a transaction-shaped mock that returns fixture rows and records SQL.

**How to apply:** mock `@workspace/db` with a `transaction` callback, return deterministic rows from `tx.execute`, and assert the posted journal lines, account-resolution SQL, and absence of a match insert when candidate type and ID are null. Use a real isolated database only for schema/trigger behavior.