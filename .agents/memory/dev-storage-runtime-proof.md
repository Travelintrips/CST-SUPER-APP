---
name: DEV storage runtime proof
description: Runtime proof constraints for authenticated Supabase Storage uploads in Node 20.
---

DEV Storage proof must run from a workspace package so Node resolves `pg` and `@supabase/supabase-js`; the Supabase client needs the `ws` transport on Node 20, and image uploads may be recompressed to WebP.

**Why:** A proof launched from `/tmp` failed before execution due to ESM package resolution, the default Supabase realtime client rejected Node 20 without WebSocket transport, and byte-for-byte image assertions mistook intentional compression for a storage failure.

**How to apply:** Run through the official development Secret Manager loader from the API package, provide `ws` as realtime transport, and use a non-compressible fixture such as a small PDF when exact byte readback is required.