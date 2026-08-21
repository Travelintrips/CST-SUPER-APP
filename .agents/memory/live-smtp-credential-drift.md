---
name: Live SMTP credential drift
description: Distinguishes a valid current production secret bundle from a deployed runtime using a different or stale SMTP credential.
---

The production notification log is the authoritative evidence for mail delivery. An SMTP `535 5.7.8 authentication failed` means the live process reached the provider but its credential was rejected. A direct `verify()` using the current workspace production Secret Manager bundle can still pass when the custom domain is served by another deployment, an older deployment, or a runtime with a different bootstrap/bundle source.

**Why:** The same production database can receive 535 failures from the live domain while the current Repl's loaded production bundle authenticates successfully.

**How to apply:** Compare the live deployment's Secret Manager project/secret bundle and runtime startup logs with the workspace bundle. Do not keep changing portal UI or SMTP code until the live runtime is proven to load the same credential source.