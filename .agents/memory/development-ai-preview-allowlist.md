---
name: Development AI preview allowlist
description: Safe-development exception for invoice OCR provider calls.
---

Safe development mode may permit invoice OCR to call only the configured OpenAI provider base when `ALLOW_DEV_AI_REQUESTS=true` and `APP_ENV=development`; arbitrary external HTTP and all E2E-mode provider calls remain blocked.

**Why:** The BizPortal OCR preview needs a real provider response, but opening outbound HTTP in the preview would also expose WhatsApp, email, payment, webhook, and arbitrary network paths.

**How to apply:** Resolve the exact base from the credential/client pair in use, keep the exception disabled in `E2E_TEST_MODE`, and add allowlist plus denial tests whenever another development-only provider exception is introduced.