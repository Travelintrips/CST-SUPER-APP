---
name: QRIS unmatched audit visibility
description: Rules for retaining unmatched QRIS bank evidence without making it approvable.
---

QRIS generation must distinguish **audits persisted** from **candidates eligible for review**. A detected QRIS bank mutation with no canonical payment evidence is retained as an `UNMATCHED` audit, with a nullable estimated settlement date and no payment items.

**Why:** Discarding the analysis result made the UI claim that candidates had been generated while its subsequent refresh showed nothing. Retaining the evidence gives reviewers a durable explanation without inventing financial data.

**How to apply:** Display the unmatched audit and its reason, but never offer approval unless the normal payment membership, settlement-date, and canonical validation guards pass. UI copy must report analyzed/persisted/reviewable quantities separately.

**Legacy compatibility:** Older installations can enforce one candidate per mutation as either a PostgreSQL constraint or a bare unique index. Remove both forms before preserving superseded audit snapshots; otherwise a regeneration can fail after it has retired the old snapshot.