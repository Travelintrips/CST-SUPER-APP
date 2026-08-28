---
name: QRIS unmatched audit visibility
description: Rules for retaining unmatched QRIS bank evidence without making it approvable.
---

QRIS generation must distinguish **audits persisted** from **candidates eligible for review**. A detected QRIS bank mutation with no canonical payment evidence is retained as an `UNMATCHED` audit, with a nullable estimated settlement date and no payment items.

**Why:** Discarding the analysis result made the UI claim that candidates had been generated while its subsequent refresh showed nothing. Retaining the evidence gives reviewers a durable explanation without inventing financial data.

**How to apply:** Display the unmatched audit and its reason, but never offer approval unless the normal payment membership, settlement-date, and canonical validation guards pass. UI copy must report analyzed/persisted/reviewable quantities separately.

An exact generic bank match is not completion for a QRIS mutation. The reviewer UI must keep it visibly blocked until a reviewable canonical QRIS candidate exists, while showing the retained candidate diagnostics (payment, settlement date, provider, and net amount).

**Why:** The generic matcher can find a Sport Center payment by nominal/reference even when the canonical settlement cohort is missing or outside the H-1 review window. Calling that state “Cocok” hides the actual approval blocker.

**How to apply:** Use a separate QRIS-readiness status and diagnostic display; do not reuse the generic green exact-match summary as proof that a QRIS mutation can be approved.

**Legacy compatibility:** Older installations can enforce one candidate per mutation as either a PostgreSQL constraint or a bare unique index. Remove both forms before preserving superseded audit snapshots; otherwise a regeneration can fail after it has retired the old snapshot.