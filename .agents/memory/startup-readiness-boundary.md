---
name: Startup readiness boundary
description: Distinguishes mirror contract installation from complete API startup readiness
---

## Rule
The canonical mirror installer can complete before the API's final readiness flag. A phase requiring startup/runtime health must require `/api/health/ready` to return `ready: true` and the startup chain completion marker, even when live function definitions and replay tests pass.

**Why:** The API listens before its long migration/seed chain finishes, so port availability and successful resolver installation do not prove the application is fully ready.

**How to apply:** Treat resolver logs, live function checks, replay results, and API readiness as separate evidence. Never certify a finalization that requires healthy startup while the readiness endpoint remains false.

## Frontend boundary
When the API listens before cold-start migrations finish, keep the login/auth shell available immediately, but keep company/data providers and startup side effects behind the readiness gate.

**Why:** A full-screen readiness gate leaves BizPortal unusable for several minutes during the long serial migration chain, while mounting all data providers early can recreate the request fan-out the gate is meant to prevent.

**How to apply:** During development startup, poll `/api/health/ready` with a short timeout; allow login/auth discovery to render while it is false, and let `CompanyContext`/data side effects wait for `ready: true`. Keep production behavior unchanged unless its startup contract explicitly requires the gate.