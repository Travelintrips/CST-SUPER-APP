---
name: QRIS approval response
description: QRIS approval can appear unresponsive when request-time migration work blocks feedback.
---

QRIS approval must not independently rerun the full settlement DDL/backfill chain for every request; concurrent callers should share one in-flight migration promise, while the UI should show pending state and surface the server error.

**Why:** The approval flow performs canonical settlement work after the migration gate, so repeating runtime schema work made the user-facing action look inactive and hid the actual failure reason.

**How to apply:** Keep QRIS migration initialization memoized per API process, clear the promise only after failure for retry, and preserve response error messages through the frontend mutation.