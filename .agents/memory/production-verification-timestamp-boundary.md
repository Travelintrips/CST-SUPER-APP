---
name: Production verification timestamp boundary
description: Rounded checkpoint timestamps can double-count the final baseline row during post-republish observation.
---

When a production checkpoint records a timestamp only to whole seconds, resolve the exact boundary from the checkpoint's known maximum row ID before counting post-baseline writes. Treat a row already included in the baseline as boundary data, not a new event.

**Why:** The production RFQ checkpoint at `12:30:18 UTC` included rows created at fractional seconds within that same second; a strict `created_at > 12:30:18` query otherwise reported a false new RFQ and AUTO_SUCCESS.

**How to apply:** Compare the final count/max ID first, then use the exact timestamp of the baseline max ID (or an equivalent immutable checkpoint identity) for post-observation deltas.