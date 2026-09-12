---
name: Gateway source integrity
description: Startup guard for accidental duplication of the root gateway module.
---

The root gateway module must contain one complete module block and one set of top-level imports. If the source is accidentally repeated, Node fails with duplicate import/const declarations before port 5000 binds.

**Why:** A synchronized source snapshot contained the same gateway module repeated 16 times. API and both portal services could be healthy while the user-facing gateway remained unavailable.

**How to apply:** After a source reset or gateway edit, run `node --check gateway.mjs` and confirm the module has a single `node:http` import before diagnosing downstream preview failures.