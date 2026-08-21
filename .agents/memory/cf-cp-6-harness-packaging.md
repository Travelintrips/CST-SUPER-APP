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