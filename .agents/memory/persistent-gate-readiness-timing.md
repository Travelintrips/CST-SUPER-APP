---
name: Persistent gate readiness timing
description: Readiness observability when startup migration stages are skipped by persistent markers
---

Initialize the startup migration start timestamp before entering the persistent gate, not inside the gated stage callback. A completed pre-start marker can bypass that callback during restart, and readiness would otherwise report `ready=true` with null start and elapsed timing fields.

**Why:** The first steady-state restart skipped the pre-start stage successfully but exposed null migration timing metadata, weakening the existing readiness observability contract.

**How to apply:** Keep migration timing independent from stage execution. Record process-level start/completion around the serial chain; stage-level execution metrics may legitimately be empty when every registered stage is skipped.