---
name: CF-SC-12B targeted production runner
description: Production Central Finance foundation must be applied through an explicit additive runner, not normal startup or generic schema reconciliation.
---

The CF-SC-12B production foundation is intentionally isolated in an explicit
runner guarded by both production environment identity and a separate apply
flag. It creates only the certified shared-finance tables, validates reference
violations before constraints, installs the checked-in Sport Center owner
functions, seeds business-key-resolved PROD identities, and proves the resolver
without processing financial events.

**Why:** Generic DEV→PROD reconciliation previously surfaced unrelated
production conflicts, while normal application startup must remain legacy and
must not unexpectedly create or process Central Finance state.

**How to apply:** Keep the runner separate from startup. Require an explicit
authorized PROD invocation, preserve legacy mode, and report the actual
post-run resolver/idempotency evidence before declaring CF-SC-12B complete.