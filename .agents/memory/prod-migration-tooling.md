---
name: Production migration tooling
description: The available pg_dump client may lag the Supabase PostgreSQL server and cannot freeze exact DEV DDL.
---

Exact DEV DDL extraction for production migrations requires a client compatible
with the live PostgreSQL major version; the available pg_dump 16.10 rejected a
PostgreSQL 17.6 server before producing a dump.

**Why:** CF-SC-12 must apply certified DEV definitions without reconstructing
them from memory, and an incompatible dump client can silently derail that
freeze step.

**How to apply:** Check `pg_dump --version` against the live server before
building an additive migration; use a PostgreSQL 17-compatible catalog/dump
tool or stop without touching PROD.