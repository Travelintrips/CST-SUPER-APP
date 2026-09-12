---
name: Phase 4C-1 runtime bootstrap
description: Runtime and Drizzle migration behavior for source-aware bank reconciliation persistence.
---

The bank reconciliation runtime bootstrap may contain additive schema guarantees but can swallow migration failures inside a broad non-fatal startup chain. A checked-in Drizzle migration and an explicit development-database proof remain necessary before treating a new reconciliation column as live.

**Why:** The source-aware column was present in the runtime code, but the first development read-only proof still found it absent; the exact additive migration then applied cleanly to the verified development project without changing rows.

**How to apply:** For additive reconciliation schema changes, verify the runtime path, run the focused contract tests, apply only the intended migration to the development target, and query `information_schema` plus historical row counts afterward. Build `lib/db` before API typecheck when declaration outputs are stale.