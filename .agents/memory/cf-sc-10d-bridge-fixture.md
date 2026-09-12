---
name: CF-SC-10D bridge fixture contract
description: Development certification fixtures must let the canonical handoff create its own public mutation.
---

The CF-SC-10D race fixture must not preinsert a public bank mutation for the
same payment key. The canonical handoff owns creation of the public row,
including settlement-scoped source_account, net amount, and matched status;
preinserting an incomplete row makes the bridge fail closed or masks the
canonical owner contract.

**Why:** The bridge requires exact posted settlement evidence and the handoff
must remain the single owner of the public-to-canonical identity.

**How to apply:** For future DEV race proofs, commit payments/outbox rows
before launching clients, but leave public mutation creation to
ensure_canonical_bank_mutation_for_settlement.