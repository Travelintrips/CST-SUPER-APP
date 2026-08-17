---
name: Persistent gate failure safety
description: Failure propagation and compatibility-marker locking rules for persistent startup migration gates
---

Persistent startup stages must reject on any failure that means the stage did not fully succeed. Catching an error and returning normally causes the outer gate to persist `completed`, so the next restart skips unfinished work.

**Why:** A serial gate can only distinguish success from failure through the callback promise. A swallowed DDL, seed, or backfill error is indistinguishable from a successful stage and creates unsafe persistent state.

**How to apply:** Keep intentional non-critical work outside the gated chain, or rethrow errors from gated callbacks. If legacy code writes its own marker while running inside the runner, propagate lock ownership through async context so the helper does not try to acquire the same session advisory lock again.