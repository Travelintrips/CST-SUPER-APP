---
name: Static artifact browser proof
description: Temporary Node fetch gateways must not forward compression headers after fetch has already decompressed the upstream body.
---

When using a temporary Node fetch-based gateway to preview a static artifact with API forwarding, strip `content-encoding` and `content-length` before returning the already-buffered upstream body. For guarded admin screenshots, the browser session must also include the UI's non-sensitive cached role/profile state; a valid HttpOnly cookie alone may pass the API guard but still fail a synchronous client-side role check.

**Why:** Forwarding those headers after Node fetch decompression makes the browser report `ERR_CONTENT_DECODING_FAILED`, falsely suggesting the artifact is broken.

**How to apply:** Keep the proof gateway outside the repository, serve `dist/public`, proxy only `/api`, seed only non-secret development profile state when the UI requires it, and remove the temporary workflow after the screenshot/network check.