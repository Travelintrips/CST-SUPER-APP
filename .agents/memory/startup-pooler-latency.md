---
name: Startup pooler latency
description: Startup registry checks can be dominated by cold Supabase pooler checkout rather than SQL execution.
---

The first startup registry operation may spend several seconds acquiring a development pooler connection while the DDL/SELECT itself completes in milliseconds. Reuse one acquired client for adjacent authoritative registry operations when their lifecycle is already serial.

**Why:** Controlled measurements showed pool acquisition dominating both store initialization and the following bulk registry read; removing the second acquisition reduced startup time without changing gate semantics.

**How to apply:** Instrument acquisition and query roundtrip separately before changing SQL, pool size, or routing. Keep readiness fail-closed and treat any remaining cold checkout as a PgBouncer/network investigation.

`pg-pool`'s `min` option is not a prewarmer: with `min=0`, the pool creates a client only on demand, and `idleTimeoutMillis` removes an idle client when the pool is above that minimum. A warm checkout can therefore become cold again after the idle timeout.

**Why:** A controlled development-pooler probe measured sub-second cold checkout, sub-1 ms warm reuse, and another sub-second checkout after 31 seconds idle; DNS and TCP/TLS transport were much smaller than the historical multi-second checkout.

**How to apply:** Treat a multi-second checkout as variable pooler/auth/backend evidence until repeated cold samples reproduce it. Separate application-pool lifecycle effects from PgBouncer queue/backend acquisition, which is not exposed by the app pool metrics.