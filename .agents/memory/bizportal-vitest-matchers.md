---
name: BizPortal Vitest matcher setup
description: UI tests run without a global jest-dom setup.
---

Use Vitest's built-in assertions in BizPortal UI tests unless a test explicitly installs the jest-dom matchers.

**Why:** The shared Vitest configuration selects jsdom but does not register a setup file, so `toBeInTheDocument` fails at runtime even though the DOM renders correctly.

**How to apply:** Prefer `toBeTruthy`, `toBeNull`, and role/text queries for new tests, or add an explicit matcher setup only when the broader test suite adopts it.