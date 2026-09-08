---
name: Auto-post block evidence
description: Durable rule for explaining and safely retrying rule-driven bank reconciliation auto-post failures
---

Any rule-driven auto-post attempt that does not complete must persist a structured audit reason and error code, and the mutation list must expose the latest reason. Historical manual-review rows without evidence remain manual until an explicit, scoped rerun evaluates them.

**Why:** A valid rule and postable COA do not prove that journal safeguards, period locks, or duplicate protections allowed posting. Without persisted failure evidence, the UI turns a specific accounting control into an opaque “Review Manual” state.

**How to apply:** Record the rule, target COA, confidence, reason, and code at the auto-post boundary. Prefer the persisted mutation reason, then the latest blocking audit, and only then a legacy “reason not recorded” fallback. Never silently retry or mutate production historical rows.