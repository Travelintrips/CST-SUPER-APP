---
name: Canonical correlation root parity
description: The canonical settlement root contract must stay identical across application normalization, SQL views, triggers, routines, and read projections.
---

The canonical settlement root contract is fail-closed: exactly one valid numeric `:supp:NN` suffix may be removed; repeated or malformed supplemental markers resolve to NULL and cannot be approved.

**Why:** A mismatch between TypeScript and SQL normalization can make a late-arrival batch appear deduplicated in one path while still creating a second active match through another path.

**How to apply:** When changing canonical correlation parsing, update the shared helper, every SQL projection/trigger/routine, and the mutation detail query together; keep malformed historical rows visible only as audit evidence.