---
name: Monorepo dependency workflow refresh
description: Workflow behavior after synchronizing pnpm dependencies in the multi-artifact workspace.
---

After a lockfile-based pnpm synchronization, restart every affected artifact workflow before judging dependency resolution or preview behavior. Existing Vite processes can retain the old package graph and continue reporting missing packages even though the artifact symlinks are repaired.

**Why:** the workspace runs several long-lived artifact processes, while pnpm can replace a large part of the virtual store and importer links during synchronization. The running process does not automatically reload its module-resolution state.

**How to apply:** run the lockfile synchronization, restart API and any affected portal workflows once, then inspect fresh workflow logs and preview requests. Treat pre-restart dependency warnings as stale evidence.