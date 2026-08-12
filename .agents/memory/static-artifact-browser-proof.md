---
name: Static artifact browser proof
description: Temporary Node fetch gateways must not forward compression headers after fetch has already decompressed the upstream body.
---

When using a temporary Node fetch-based gateway to preview a static artifact with API forwarding, strip `content-encoding` and `content-length` before returning the already-buffered upstream body.

**Why:** Forwarding those headers after Node fetch decompression makes the browser report `ERR_CONTENT_DECODING_FAILED`, falsely suggesting the artifact is broken.

**How to apply:** Keep the proof gateway outside the repository, serve `dist/public`, proxy only `/api`, and remove the temporary workflow after the screenshot/network check.