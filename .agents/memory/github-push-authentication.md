---
name: GitHub push authentication
description: Authentication constraints when pushing repository commits from the Replit workspace
---

GitHub Personal Access Token presence in Replit Secrets is not proof that Git can push to the configured repository. A token may be invalid, expired, owned by the wrong account, or lack repository write permission.

**Why:** A cleanup commit was created locally successfully, but GitHub rejected multiple authenticated push attempts with `invalid credentials`; retrying without changing the credential does not help.

**How to apply:** Never print or request tokens in chat. Verify the token through the secure secret flow and prefer an accepted GitHub connection when direct Git remote authentication is rejected. Keep the local commit intact and report that the remote remains unchanged.

When an authenticated Git Database API push materializes an equivalent commit, GitHub may return a different commit SHA even when parent, tree, message, dates, and file blob SHAs match. Compare the tree and blobs before considering a force-push; never rewrite the remote only to match the local SHA.