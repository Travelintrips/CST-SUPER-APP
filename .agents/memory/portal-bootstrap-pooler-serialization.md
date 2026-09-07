---
name: Portal bootstrap pooler serialization
description: Auth bootstrap query concurrency can be slower than sequential reads on the development Supabase transaction pooler.
---

The portal auth bootstrap should keep its canonical profile and company-context reads serialized when running through the Supabase transaction pooler; concurrent reads can contend and add seconds even when each query is fast alone.

**Why:** Live DEV measurements showed two independent bootstrap reads taking about 1.5–1.8 seconds in parallel, while sequential reads completed in roughly 0.45 seconds and reduced the end-to-end bootstrap to under 0.7 seconds.

**How to apply:** Preserve the measured sequential pattern for this bootstrap path unless a different pool/connection configuration is proven in the target environment; remeasure both query-level and end-to-end latency before reverting to `Promise.all`.