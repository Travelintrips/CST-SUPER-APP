---
name: Startup readiness boundary
description: Distinguishes mirror contract installation from complete API startup readiness
---

## Rule
The canonical mirror installer can complete before the API's final readiness flag. A phase requiring startup/runtime health must require `/api/health/ready` to return `ready: true` and the startup chain completion marker, even when live function definitions and replay tests pass.

**Why:** The API listens before its long migration/seed chain finishes, so port availability and successful resolver installation do not prove the application is fully ready.

**How to apply:** Treat resolver logs, live function checks, replay results, and API readiness as separate evidence. Never certify a finalization that requires healthy startup while the readiness endpoint remains false.