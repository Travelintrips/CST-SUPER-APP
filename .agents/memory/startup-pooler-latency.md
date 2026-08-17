---
name: Startup pooler latency
description: Startup registry checks can be dominated by cold Supabase pooler checkout rather than SQL execution.
---

The first startup registry operation may spend several seconds acquiring a development pooler connection while the DDL/SELECT itself completes in milliseconds. Reuse one acquired client for adjacent authoritative registry operations when their lifecycle is already serial.

**Why:** Controlled measurements showed pool acquisition dominating both store initialization and the following bulk registry read; removing the second acquisition reduced startup time without changing gate semantics.

**How to apply:** Instrument acquisition and query roundtrip separately before changing SQL, pool size, or routing. Keep readiness fail-closed and treat any remaining cold checkout as a PgBouncer/network investigation.