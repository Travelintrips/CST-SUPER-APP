---
name: Validator empty-string semantics
description: Rule for configuration validators where an explicit empty value intentionally disables a feature.
---

When a configuration variable uses an explicit empty string to disable behavior, preserve the distinction between `undefined` (not configured) and `""`/whitespace (intentionally disabled). Evaluate presence first, then trim and validate the value.

**Why:** Coalescing an absent value to `""` or using a truthiness check incorrectly converts an intentional opt-out into a missing prerequisite and changes the release verdict.

**How to apply:** For read-only preflight checks, use an explicit `value === undefined` branch for BLOCKED, a trimmed-empty branch for the documented PASS/disabled state, and separate invalid-value branches. Keep counters and exit semantics unchanged.