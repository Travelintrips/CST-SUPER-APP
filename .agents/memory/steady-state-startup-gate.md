---
name: Steady-state startup gate
description: Keep persistent migration startup fast without weakening authoritative fallback, lock, or failure semantics.
---

The persistent migration gate should initialize its state store and bulk-read the registry as the first database readiness operation. Do not add a separate `SELECT 1` probe before that authoritative operation; completed/version-matching rows may use the process-local snapshot, while pending, failed, missing, or version-mismatched rows must fall back to the database read, lock, re-check, and execution path.

**Why:** On the Supabase pooler, serial metadata roundtrips dominate an all-completed restart. A redundant readiness probe adds latency without proving anything the registry initialization does not already prove.

**How to apply:** Preserve retry-on-transient and fail-closed-on-metadata-error behavior around registry initialization. Keep AsyncLocalStorage and the post-lock TOCTOU re-check unchanged, and report store-init versus bulk-read timing separately because pool latency can vary substantially between restarts.