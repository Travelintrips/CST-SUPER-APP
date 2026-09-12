---
name: Customer Portal bootstrap secrets
description: Customer Portal artifact startup depends on API Secret Manager bootstrap credentials being present in the shared environment.
---

The Customer Portal development workflow invokes the API server secret loader before starting Vite. Without the three Secret Manager bootstrap credentials, the proxy may start but the Vite process exits fail-closed.

**Why:** The project intentionally does not allow a development fallback when the Secret Manager bootstrap contract is incomplete.

**How to apply:** When Customer Portal stops after a workflow restart, check for the bootstrap-secret error before changing frontend code or dependencies; never print or request secret values in chat.