---
name: Package firewall dependency recovery
description: Recovery path when Replit's package firewall blocks a direct dependency tarball.
---

When a direct dependency is rejected by the package firewall, verify the latest available version and update the dependency to that version before retrying the frozen workspace install.

**Why:** An older direct dependency tarball can be denied even when the lockfile is internally consistent; retrying the same frozen lockfile does not resolve the block.

**How to apply:** Preserve the lockfile workflow, avoid bypassing the firewall, and verify the resulting workspace with `pnpm install --frozen-lockfile`.