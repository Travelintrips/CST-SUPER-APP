---
name: Vitest source contract paths
description: Path-resolution rule for BizPortal tests that inspect source files as text.
---

Source-reading regression tests in the BizPortal suite must resolve files from the Vitest working directory rather than from `import.meta.url`.

**Why:** In this project's Vitest execution mode, `import.meta.url` is unavailable and template-based URL resolution silently points to an `undefined` path, causing every source contract assertion to fail before it checks the intended behavior.

**How to apply:** Resolve source paths from `process.cwd()` plus the BizPortal `src` directory, and run the targeted test with shell fail-fast enabled before relying on a later build result.