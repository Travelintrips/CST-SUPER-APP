---
name: Gateway workflow config can revert itself
description: The Gateway workflow's start command was observed reverting from start-dev-all.sh back to start-replit.sh mid-session without agent action.
---

On this project, `.replit`'s Gateway workflow `args` reverted from `bash start-dev-all.sh` to `bash start-replit.sh` on its own during a session (not caused by an edit in that turn) — likely an external/platform re-sync of workflow config. `start-replit.sh` manually spawns all upstream services on hardcoded ports and collides with the dedicated per-artifact workflows once those exist and own the same ports, causing port conflicts.

**Why:** Artifact workflows (api-server, bizportal, customer-portal, logistic-order, mockup-sandbox) *can* auto-register mid-session (contradicts an earlier note that claimed they never do — that claim was wrong, just unpredictable timing). Once they exist, Gateway must NOT also try to start those same services.

**How to apply:** If the Gateway workflow's command shows as `start-replit.sh` and per-artifact workflows are present/running, change it back to `start-dev-all.sh` (Gateway-only script that assumes artifact workflows own the upstream services on their proxy ports) and restart Gateway. Check `.replit` for the current `args` value if workflows seem to conflict on ports after any workflow config change event.
