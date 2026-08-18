---
name: Supabase Node 20 WebSocket transport
description: One-off Supabase client scripts on Node 20 need an explicit ws realtime transport.
---

When running a one-off Supabase client script under Node 20, pass the `ws` package as the client's realtime transport.

**Why:** The installed Supabase client attempts to initialize native WebSocket support and throws before Storage or database operations begin when native WebSocket is unavailable.

**How to apply:** Use `createClient(url, key, { realtime: { transport: ws } })` for maintenance scripts; do not print loaded secret values.