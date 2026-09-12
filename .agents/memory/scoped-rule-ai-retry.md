---
name: Scoped Rule AI retry
description: Retry behavior for bank mutations where a full-confidence rule matched but auto-post was held by a journal safeguard.
---

Expose a mutation-scoped retry when a non-final bank mutation has `AUTO_POST_GUARD` and an active `recon_rule` candidate at full confidence. The retry must send only that mutation ID with the rematch mode; it must not launch a full-dataset matching run.

**Why:** A rule match can be correct while journal creation is blocked by an accounting safeguard. Reviewers need a safe way to re-evaluate current rules/configuration without losing the audit boundary or accidentally retrying unrelated mutations.

**How to apply:** Keep final-status protection in the backend matching guard. Treat a successful retry as posted only when the server reports `auto_matched`; otherwise keep the mutation reviewable and show the latest safeguard reason.