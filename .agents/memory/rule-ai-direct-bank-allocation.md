---
name: Rule AI direct bank allocation
description: Rule AI reconciliation candidates classify the bank mutation directly rather than representing a business document with a source journal.
---

Rule AI candidates (`recon_rule`) must bypass business-candidate journal adapters in the journal reuse decision. The approval path still validates the matched rule's company scope and target COA before creating the balanced bank journal, while idempotency is owned by the bank mutation's reconciliation source.

**Why:** Production auto-posts with complete Rule AI mappings were incorrectly blocked as `Candidate type 'recon_rule' not mapped` because the generic reuse engine treated the rule ID as an unmapped business entity.

**How to apply:** Keep `recon_rule` as a direct-allocation path that returns safe-to-create only after the normal approval safeguards; do not invent a lookup against invoice, payment, expense, or other business source tables.