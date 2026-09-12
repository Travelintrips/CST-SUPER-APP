---
name: Customer Portal SSE flushing
description: Runtime constraint for customer-scoped Server-Sent Events when the API uses global response compression.
---

Customer-scoped SSE must explicitly flush after the initial connection frame, every event broadcast, and heartbeat when global response compression is enabled.

**Why:** Without an explicit flush, the server can register the connection and call `res.write()` successfully while clients receive an empty stream until the compression buffer fills or the connection closes.

**How to apply:** Keep `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `X-Accel-Buffering: no`; call the response flush hook after writes in the route and SSE manager. Verify with a live owner/other-customer stream proof, not only persisted notification rows.