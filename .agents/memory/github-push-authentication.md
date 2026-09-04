---
name: GitHub push authentication
description: Authentication constraints when pushing repository commits from the Replit workspace
---

GitHub Personal Access Token presence in Replit Secrets is not proof that Git can push to the configured repository. A token may be invalid, expired, owned by the wrong account, or lack repository write permission.

**Why:** A cleanup commit was created locally successfully, but GitHub rejected the configured remote credential; retrying without changing the credential does not help.

**How to apply:** Never print or request tokens in chat. Prefer an accepted GitHub connection when direct Git remote authentication is rejected. If remote history moved, inspect the remote tree and append only non-conflicting changes with a fast-forward guard; never force-push.

When an authenticated Git Database API push materializes an equivalent commit, GitHub may return a different commit SHA even when parent, tree, message, dates, and file blob SHAs match. Compare the tree and blobs before considering a force-push; never rewrite the remote only to match the local SHA.

The Replit Git UI can automatically start a new pull-rebase immediately after an abort, leaving a detached/rebasing presentation even when the abort command itself succeeded. When the remote already contains the intended tree, preserve a local backup ref and align the working branch to the remote instead of retrying abort.