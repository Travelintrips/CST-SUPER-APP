---
name: CF-CP-6 harness packaging
description: Workspace-safe bundling rules for Customer Portal runtime proofs.
---

CF-CP-6 runtime proofs must emit and execute their generated bundle inside the
API workspace. Bundle workspace TypeScript packages, but keep `pg` and pino
runtime packages external so Node resolves their workspace installations and
worker behavior normally.

**Why:** A bundle emitted under `/tmp` could not resolve workspace `pg`; leaving
workspace packages external then caused Node to load `@workspace/db` source
`.ts`, while bundling pino caused an ESM dynamic-require failure.

**How to apply:** Put the one-off harness under `artifacts/api-server/scripts`,
bundle with workspace packages included and `pg`/logger runtimes external, and
always remove the generated bundle on both success and failure.

The goods proof must track both accounting effects: the `sales_invoice` entry
and the settlement adapter's `sales_payment` entry. Cleanup must transition
harness-created posted entries to draft with cancellation metadata before
deleting lines, then remove both entries.

**Why:** The DEV immutability triggers reject direct deletion of posted journal
lines, and an untracked settlement journal made the before/after accounting
snapshot drift even when all business rows were removed.

**How to apply:** Capture `settlement_journal_id` from the settlement batch in
the fixture state and clean it using the same exact-ID guarded cancellation
path as the sales entry.