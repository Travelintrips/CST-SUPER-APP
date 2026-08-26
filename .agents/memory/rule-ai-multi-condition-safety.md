---
name: Rule AI multi-condition safety
description: Durable contract for configurable bank-rule conditions and ambiguous classification results.
---

Rule AI conditions use structured JSON with AND/OR composition and per-condition negation; legacy single conditions remain a one-item AND list. Priority and specificity determine precedence, but equal-precedence rules with different outputs must return `AMBIGUOUS_RULE_MATCH` rather than choose by creation order or ID.

**Why:** A bank token by itself is only a signal and can represent multiple business contexts; automatic selection in that case risks incorrect COA classification.

**How to apply:** Keep previews read-only and route them through the canonical reconciliation evaluator. Never let this configuration layer create journals, settlements, or mutate posted finance records.