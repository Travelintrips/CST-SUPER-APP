---
name: Production OpenAI credential validation
description: Production GCP secret loading can succeed while OpenAI rejects the credential.
---

Presence of `OPENAI_API_KEY` in the canonical production bundle is not proof that KTP OCR is usable; the bundle must first parse as JSON, then a non-destructive provider request must return a successful authentication result before republish.

**Why:** A production bundle first loaded successfully while OpenAI returned HTTP 401, then a later owner update made the same bundle fail JSON parsing because of a raw control character. Treat payload validity and provider authentication as separate gates from secret presence.

**How to apply:** After any production OpenAI secret change, run the loader validation; if JSON parsing passes, run a safe client/request probe without printing the credential, then perform the KTP OCR proof before publishing. Multiline secret values in the JSON payload must use escaped `\n`, not literal control characters.