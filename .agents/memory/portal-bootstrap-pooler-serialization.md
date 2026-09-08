---
name: Portal bootstrap pooler serialization
description: Auth bootstrap query concurrency can be slower than sequential reads on the development Supabase transaction pooler.
---

The portal auth path should preserve the measured bootstrap read ordering on the Supabase transaction pooler. In DEV, the remaining ~1.7s can sit in the combined revocation/customer lookup inside auth middleware even when the bootstrap handler itself is ~0.45s and the app pool has no waiters.

**Why:** API-only and portal-active runs were both about 2.2s, with bootstrap handler timings around 0.44–0.45s and auth middleware/revocation-customer timings around 1.76–1.79s. Public portal request bursts did not materially change the bootstrap median.

**How to apply:** Do not attribute this latency to frontend business-request bursts without an API-only comparison. Preserve the measured bootstrap ordering unless a different pool/connection configuration is proven, and profile auth connection/query latency separately before changing authorization logic or increasing pool size.