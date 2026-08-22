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

The targeted PROD runner must commit its own additive DDL before invoking the
bundled owner routine, because the owner uses a separate Drizzle connection.
Otherwise the owner can self-block on locks held by the runner's uncommitted
transaction. PROD snapshots may also retain an empty legacy
`sport_center.coa_accounts` table while the verified canonical identity lives in
`public.chart_of_accounts`; the owner repair must accept that exact public
identity without creating a legacy duplicate.

**Why:** PostgreSQL transactions and pooled application connections are
session-scoped; an outer runner transaction cannot safely wrap a routine that
opens another connection. Historical PROD schema variants also make legacy
table presence insufficient evidence of the canonical COA.

**How to apply:** Keep additive DDL and owner installation in separate phases,
then seed/prove shared configuration in a new transaction. Resolve the public
COA only by exact ID, code, name, company, active, postable, and non-header
checks.

The environment-specific bundles can supply the DEV and PROD database targets
without exposing direct URLs in the shell. The canonical preflight reports the
six routines as structural PASS in both environments, but exits with status 2
while its separately documented reconciliation contract gates remain BLOCKED.

**Why:** A routine catalog proof and implementation readiness are distinct
claims; treating the preflight's overall exit code as routine absence would
misclassify a successful live catalog check.

**How to apply:** Run the preflight through `load-secrets.mjs`, record the
individual routine results, and report the contract-gate blockers separately.

The posted-settlement immutability trigger must recognize the owner recovery
context explicitly. Recovery is allowed only as a transaction-local,
fail-closed `posted -> reconciled` transition that changes the bank-derived
net, adjustment, and bank link; ordinary updates and all other financial
fields remain blocked.

**Why:** A restored recovery function can still fail at the live UPDATE because
the existing immutability trigger correctly rejects posted financial changes.

**How to apply:** Keep the recovery capability marker transaction-local, set it
only immediately before the guarded owner UPDATE, and preserve the trigger's
normal protections outside that narrow path.

The reconciliation UI must treat an approved canonical settlement match as a
completed state even when an older QRIS audit snapshot remains
`candidate_review/MATCHED`. Once all snapshot payments are already linked, the
empty available-payment list is evidence of completion, not a request to run
matching again.

**Why:** Canonical owner recovery writes the authoritative match and settlement
state without mutating legacy QRIS candidate snapshots.

**How to apply:** Derive UI action eligibility from the canonical approved
match and bank mutation status; show a completed/reconciled explanation instead
of an empty-candidate prompt.