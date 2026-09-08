---
name: Portal bootstrap pooler serialization
description: Auth bootstrap query concurrency can be slower than sequential reads on the development Supabase transaction pooler.
---

The portal auth path should preserve the measured bootstrap read ordering on the Supabase transaction pooler. In DEV, the remaining ~1.7s can sit in the combined revocation/customer lookup inside auth middleware even when the bootstrap handler itself is ~0.45s and the app pool has no waiters. Direct profiling showed first/fresh pool acquisition around 1.3–1.4s, query execution around 220ms, row mapping near 0ms, and `EXPLAIN ANALYZE` around 0.08ms.

**Why:** API-only and portal-active runs were both about 2.2s, with bootstrap handler timings around 0.44–0.45s and auth middleware/revocation-customer timings around 1.76–1.79s. Public portal request bursts did not materially change the bootstrap median, and the database plan itself was sub-millisecond.

**How to apply:** Classify this DEV-only profile as pooler/transport latency unless application-level evidence changes. Do not add indexes or alter authorization logic based on this measurement; preserve the measured bootstrap ordering and keep pool-size changes deferred until connection behavior is proven different.