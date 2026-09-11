---
name: Candidate payment identity bridge
description: QRIS candidate snapshots can contain public mirror IDs; approval must resolve SCPAY-SC payment numbers before canonical settlement.
---

QRIS approval must resolve each candidate item through its persisted
`SCPAY-SC-{canonical_id}` payment number before querying or settling
`sport_center.sport_payments`. Public mirror IDs are only a compatibility
fallback when the snapshot lacks that payment number; an unresolved bridge must
fail closed.

**Why:** Historical candidate snapshots may predate the canonical source cutover
and can contain mirror IDs whose numeric values point to a different canonical
payment. Treating those numbers as canonical can settle the wrong payment or
produce a net mismatch.

**How to apply:** Preserve the snapshot for audit, resolve the selected raw IDs
to canonical IDs inside the locked approval transaction, then run eligibility,
settlement, and idempotency checks only against the resolved canonical IDs.