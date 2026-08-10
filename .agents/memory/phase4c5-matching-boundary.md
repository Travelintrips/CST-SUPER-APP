---
name: Phase 4C-5 canonical settlement matching boundary
description: Source-aware canonical Sport Center settlement matching and approval safety rules.
---

Canonical Sport Center settlements enter reconciliation only through the verified
`expected_bank_settlements` adapter, using authoritative `net_amount` and a
posted settlement journal. Their persisted identity must include the canonical
source, and matching must leave them in reviewable candidate state.

**Why:** Reusing the legacy QRIS reader or generic auto-approval path can
misidentify same-number settlements and create an accounting side effect before
the dedicated canonical approval phase.

**How to apply:** Keep legacy `public.qris_settlements` paths unchanged; enforce
company, bank-account, provider, and settlement-date evidence when structured
data exists; never recompute MDR; and treat missing canonical runtime schema/data
as unavailable proof rather than a reason to fabricate fixtures.