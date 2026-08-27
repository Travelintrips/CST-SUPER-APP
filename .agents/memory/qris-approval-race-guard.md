---
name: QRIS approval race guard
description: Invariant and error contract for concurrent QRIS settlement batch approval
---

QRIS settlement approval must lock all referenced Sport Center payments in a stable ascending-ID order before checking prior settlement, then insert settlement items under the database unique invariant on `sport_payment_id`. The pre-check alone is not sufficient under concurrent admin approvals.

**Why:** Two overlapping batch approvals can both observe no existing settlement before either transaction inserts its item. The database constraint is the authoritative winner selector; the losing approval must roll back and return HTTP 409 with an informative double-settlement error.

**How to apply:** Keep `uq_qris_settlement_items_payment` active in the runtime migration and map PostgreSQL `23505` for that constraint to `QRIS_PAYMENT_ALREADY_SETTLED`/409. Do not use `ON CONFLICT DO NOTHING`, because silently dropping an item would leave an apparently approved but incomplete settlement.

Before editing this flow, verify that `bankReconciliation.ts` contains exactly one QRIS approval route and no orphaned raw SQL block; merged snapshots may contain concatenated historical implementations that fail the parser before runtime behavior can be tested.

**Why:** A duplicated route fragment and an unclosed SQL template can make the whole API fail to build, masking the actual settlement implementation.

**How to apply:** Run the API build and search for duplicate `/qris-candidates/*/approve` declarations before restarting the application workflow.

Admin users without a default company must have the UI send the candidate's
validated `company_id` in the approval request; the backend should continue
resolving and checking that explicit context rather than guessing a tenant.

**Why:** The approval endpoint intentionally fails closed for unassigned admins.
Omitting the candidate company from the UI turns a valid tenant-scoped approval
into `Company context is required`, while deriving it server-side without an
explicit request would weaken the isolation boundary.

**How to apply:** Carry `company_id` from the QRIS candidate/mutation into both
approval button paths, validate it as a positive integer in the UI, and keep
the backend company filter and payment-company checks authoritative.

When the payment lock query includes a `LEFT JOIN LATERAL`, target the lock
explicitly at the non-nullable payment relation (`FOR SHARE OF sp`) instead of
using an unqualified `FOR SHARE`.

**Why:** PostgreSQL rejects an unqualified row lock when it would also apply to
the nullable side of an outer join, turning a valid QRIS approval into a 500.

**How to apply:** Lock the canonical payment rows only; read journal-provider
fallback data through the lateral join without trying to lock its nullable
side.

Candidate regeneration must also condition every provisional snapshot update
on a non-final status. If an update affects zero rows, stop and do not insert
a replacement snapshot.

**Why:** A reviewer can finalize a snapshot between regeneration's initial
read and its write. An unconditional refresh would reopen its audit state, and
a failed supersede followed by an insert would create a parallel candidate.

**How to apply:** Treat the status predicate and one-row result as the
authoritative concurrent-finalization guard for both evidence-changing and
evidence-preserving refreshes.