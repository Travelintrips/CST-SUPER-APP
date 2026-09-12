---
name: Sprint 09D verification evidence
description: Runtime evidence boundaries for Marketplace to Accounting handoff verification
---

## Rule
For Sprint 09D verification, build shared workspace declarations before API typecheck, verify the additive handoff schema directly in the development database, and treat global API readiness as a separate gate from the pre-start handoff migration.

**Why:** The handoff schema can be applied successfully while the API's broad startup chain is still running or blocked by unrelated migrations/workers. Typecheck can also report stale workspace declarations until the shared libraries are built.

**How to apply:** Run `pnpm run typecheck:libs` before the API typecheck. Confirm `mkt_accounting_handoffs`, its unique/index constraints, and unchanged accounting tables with read-only queries. Do not create synthetic handoff fixtures in a shared database unless the test explicitly owns cleanup and the scope permits mutation.