---
name: QRIS approval response
description: QRIS approval can appear unresponsive when request-time migration work blocks feedback.
---

QRIS approval must not independently rerun the full settlement DDL/backfill chain for every request; concurrent callers should share one in-flight migration promise, while the UI should show pending state and surface the server error.

**Why:** The approval flow performs canonical settlement work after the migration gate, so repeating runtime schema work made the user-facing action look inactive and hid the actual failure reason.

**How to apply:** Keep QRIS migration initialization memoized per API process, clear the promise only after failure for retry, and preserve response error messages through the frontend mutation.

Candidate generation can also be a false-negative response: snapshot rows may already be committed before a later cleanup or connection failure returns the generic generation error.

**Why:** Production persisted the complete calculated candidate set while the UI still received `QRIS_CANDIDATE_GENERATION_FAILED`.

**How to apply:** Check the newest candidate timestamps before retrying. Generation persistence and stale cleanup should share one transaction or report the committed result; log the failing stage so a successful write is not shown as total failure.