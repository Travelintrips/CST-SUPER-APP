---
name: Temporary reconciliation maintenance boundary
description: PROD reconciliation maintenance must be session-scoped, duplicate-root-only, and restored by exact catalog hash.
---

Temporary reconciliation maintenance must never disable triggers or constraints. The only permitted temporary bypass is the canonical duplicate-root exception, and only when the session sets the exact maintenance flag, correlation, and application name. Schema, root-correlation, source-mutation, locking, payment, journal, ledger, and accounting guards remain active.

**Why:** A production reconciliation workaround must not turn into a global financial-integrity bypass or silently alter posted accounting history.

**How to apply:** Capture the live function and trigger definitions before patching, store an audit manifest with hashes, reject out-of-manifest changes, restore the exact original definition, and verify zero disabled protection triggers before cleanup.