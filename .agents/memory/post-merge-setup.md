---
name: Post-merge setup hook
description: The automatic merge runner requires an explicitly configured, non-interactive setup script.
---

The presence of `scripts/post-merge.sh` is not enough for automatic task-merge setup. The project must also configure the script path and a realistic timeout in the `.replit` post-merge section. The script should remain idempotent, fail fast for required work, and keep optional reports or seeds non-fatal when their guarded dependencies are unavailable.

**Why:** A merged task can fail before any setup command runs when the hook path is absent, even though a valid setup script already exists in the repository.

**How to apply:** When a post-merge hook is missing, register the existing script rather than creating a duplicate, run the setup once, then verify workflow reconciliation and API readiness. Keep production schema changes outside the automatic DEV setup path.