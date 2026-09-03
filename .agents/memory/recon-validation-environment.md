---
name: Recon validation environment
description: Workspace setup and dev-database prerequisites for reconciliation validation.
---

For reconciliation validation, restore workspace dependencies with the frozen pnpm lockfile, then build shared TypeScript declarations before running the API typecheck. The QRIS/ERP contract tests are independent of the full dev schema, but the broader isolation tests require `accounting_entries` and `expense_rules` to exist in the development database.

**Why:** A clean workspace may have no `node_modules`, and the API typecheck otherwise reports declaration-output errors. The isolation assertions fail when the development database is missing baseline tables, even when the matcher changes are correct.

**How to apply:** Run dependency restore, shared-library typecheck, API typecheck, and target QRIS/ERP tests first. When the isolated test URL is stored in GCP, invoke the official development Secret Manager loader before Vitest; a direct shell may appear unconfigured. If a full offline restore is blocked by an unrelated missing codegen tarball, restore the directly required workspace package links from the local store without changing the lockfile. Treat missing baseline tables as a dev-schema prerequisite rather than as a QRIS/ERP regression.