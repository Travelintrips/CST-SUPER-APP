---
name: Production candidate-only rerun
description: Safety boundary for production matching reruns that must not approve or create journals.
---

When a production rerun explicitly forbids approval and journal creation, require a candidate-only operational path that persists scored candidates as reviewable evidence without invoking the general matching orchestrator.

**Why:** The general matcher can promote high-scoring candidates automatically. A one-off runtime harness may also fail to load the production module graph reliably; bypassing that failure with hand-copied matching logic would risk semantic drift.

**How to apply:** Prove the production binding and target records read-only first. Use only a tested candidate-only entry point. If none is available, fail closed and leave mutation, match, audit, approval, and journal state unchanged.