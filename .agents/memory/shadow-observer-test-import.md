---
name: Shadow observer test import boundary
description: Keep the Sport Center shadow observer's finance resolver import lazy for DB-independent boundary tests.
---

The shadow observer must not eagerly import the DB-backed finance resolver. Load it only after the observer has claimed a real shadow event.

**Why:** API Vitest boundary tests intentionally run without TEST_DATABASE_URL; eager resolver initialization makes a safe no-op test fail before any observer logic runs.

**How to apply:** Preserve the type-only resolver import and dynamic runtime import inside event processing. Do not add a live DB dependency to mode or zero-effect contract tests.