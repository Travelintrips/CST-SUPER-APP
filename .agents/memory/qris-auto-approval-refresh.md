---
name: QRIS auto-approval refresh
description: Runtime rule for reprocessing QRIS candidates after source corrections in a multi-port API workflow.
---

Candidate regeneration triggered by a payment date, amount, or settlement-status correction must preserve the authenticated request context and schedule the same canonical auto-approval worker used by explicit generation. Candidate creation alone is not completion.

**Why:** A refresh path previously regenerated MATCHED provisional candidates but stopped before the approval worker, leaving them waiting even though the source data was now eligible. Loopback approval also needs the listener port that accepted the request because primary and artifact API listeners can coexist on different ports.

**How to apply:** Pass the originating request through authenticated refresh queues, derive the loopback port from `req.socket.localPort` before environment fallbacks, and keep approval on the canonical builder/link path with its existing company, H-1, exact-net, and race guards.