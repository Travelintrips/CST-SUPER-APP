---
name: Canonical settlement legacy FK repair
description: Safe handling of invalid historical canonical-bank-mutation links during startup contract installation.
---

When installing the canonical settlement foreign key, clear only links whose target no longer exists, then rebuild only posted settlements with exactly one active payment through the canonical owner routine. A historical batch without enough evidence remains unlinked for governed follow-up; it must never receive an invented bank mutation.

**Why:** A stale legacy integer link can make PostgreSQL reject the new FK and leave the whole API readiness gate permanently in `starting`, even though the affected batch is not safely reconstructable.

**How to apply:** Keep the migration versioned so prior completion markers do not skip the repair. Treat an unsuccessful legacy reconstruction as a warning after the invalid link is removed, while preserving posted journals and enforcing the FK for all future writes.