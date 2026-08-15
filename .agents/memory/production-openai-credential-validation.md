---
name: Production OpenAI credential validation
description: Production GCP secret loading can succeed while OpenAI rejects the credential.
---

Presence of `OPENAI_API_KEY` in the canonical production bundle is not proof that KTP OCR is usable; a non-destructive provider request must return a successful authentication result before republish.

**Why:** A production bundle loaded successfully and source resolution matched `OPENAI_API_KEY`, but OpenAI returned HTTP 401. Treat provider authentication as a separate gate from secret presence.

**How to apply:** After any production OpenAI secret change, run the loader validation and a safe client/request probe without printing the credential, then perform the KTP OCR proof before publishing.