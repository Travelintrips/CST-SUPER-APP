---
name: Source-aware matching idempotency
description: The persistence and runtime-proof boundary for source-qualified bank reconciliation candidates.
---

Active bank reconciliation candidates must be unique on `(mutation_id, candidate_type, candidate_id, candidate_source)`. A nullable source remains a distinct historical state and must never be guessed as the legacy source.

**Why:** Numeric candidate IDs can collide across legacy QRIS and canonical Sport Center settlement tables, while repeated matching runs can otherwise append duplicate active rows. Approved or historical evidence must not be deleted merely to create a unique index.

**How to apply:** Enforce the source-qualified identity with a partial unique index for active `candidate`/`approved` rows. On rerun, upsert the exact identity and mark stale active source-aware candidates `superseded`; retain superseded rows as history. Validate both active counts and rerun stability against the runtime database.

For enqueue tables with more than one uniqueness invariant, use conflict-safe
idempotency that covers every unique constraint (or an equivalent
insert-if-absent strategy); targeting only the business-key constraint is not
enough for concurrent callers.

**Why:** A concurrent enqueue can race on a separate correlation identifier
unique key even when the source-qualified business key has `ON CONFLICT DO
NOTHING`, turning a harmless duplicate into a runtime error.

**How to apply:** Prefer an unqualified `ON CONFLICT DO NOTHING` when the
insert is intentionally idempotent and no conflict-specific update is needed.

For the legacy nullable-source identity index, a guarded cleanup may keep the
earliest approved row (or earliest row when none is approved) and mark only
duplicate candidate rows `superseded`; fail closed when a group contains more
than one approved row.

**Why:** Production can contain repeated legacy candidate rows from historical
matching runs, and deleting them would destroy reconciliation evidence.

**How to apply:** Run the guarded cleanup before creating the partial unique
index, verify active uniqueness afterward, and preserve all superseded rows.