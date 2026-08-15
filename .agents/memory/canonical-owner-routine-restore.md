---
name: Canonical owner routine restoration
description: Operational boundary for restoring and proving Sport Center settlement owner routines.
---

Canonical Sport Center settlement routines are runtime-managed Supabase objects. A
checked-in migration is not evidence that the live database has the routines.
Restoration must run against DEV only, verify the exact `pg_proc` identity
signatures afterward, and use the read-only DEV/PROD catalog preflight before
any separately approved production change.

**Why:** The application source can contain all owner functions while both live
catalogs still report them missing. The canonical builder, finalizer, candidate
evidence, and approval paths then remain unproven even though TypeScript and
unit tests pass.

**How to apply:** Use the official Secret Manager loader for Supabase
credentials. If the shell cannot see the bootstrap credential, do not work
around the loader or copy DEV objects to PROD; report the live proof as blocked
until the managed credential is available.

The environment-specific bundles can supply the DEV and PROD database targets
without exposing direct URLs in the shell. The canonical preflight reports the
six routines as structural PASS in both environments, but exits with status 2
while its separately documented reconciliation contract gates remain BLOCKED.

**Why:** A routine catalog proof and implementation readiness are distinct
claims; treating the preflight's overall exit code as routine absence would
misclassify a successful live catalog check.

**How to apply:** Run the preflight through `load-secrets.mjs`, record the
individual routine results, and report the contract-gate blockers separately.