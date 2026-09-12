---
name: GitHub CLI authentication in Replit
description: Replit GitHub integration and Shell HTTPS Git credentials are separate authentication paths.
---

The Replit GitHub connector does not automatically repair an invalid HTTPS credential used by `git push` in Shell. Authenticate the Shell Git client through the workspace's managed secret/credential flow without putting a token in the remote URL or chat.

**Why:** A connected GitHub integration can be healthy while `git push` still returns “Invalid username or token” from the Shell.

**How to apply:** Diagnose the Shell credential path separately from the connector; verify the remote branch and upstream after a successful push.