---
name: Source-aware matching idempotency
description: The persistence and runtime-proof boundary for source-qualified bank reconciliation candidates.
---

Active bank reconciliation candidates must be unique on `(mutation_id, candidate_type, candidate_id, candidate_source)`. A nullable source remains a distinct historical state and must never be guessed as the legacy source.

**Why:** Numeric candidate IDs can collide across legacy QRIS and canonical Sport Center settlement tables, while repeated matching runs can otherwise append duplicate active rows. Approved or historical evidence must not be deleted merely to create a unique index.

**How to apply:** Enforce the source-qualified identity with a partial unique index for active `candidate`/`approved` rows. On rerun, upsert the exact identity and mark stale active source-aware candidates `superseded`; retain superseded rows as history. Validate both active counts and rerun stability against the runtime database.

For the legacy nullable-source identity index, a guarded cleanup may keep the
earliest approved row (or earliest row when none is approved) and mark only
duplicate candidate rows `superseded`; fail closed when a group contains more
than one approved row.

**Why:** Production can contain repeated legacy candidate rows from historical
matching runs, and deleting them would destroy reconciliation evidence.

**How to apply:** Run the guarded cleanup before creating the partial unique
index, verify active uniqueness afterward, and preserve all superseded rows.