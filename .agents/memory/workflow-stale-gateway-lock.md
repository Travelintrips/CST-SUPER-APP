---
name: Stale Gateway workflow lock
description: A previous start-dev-all process can keep the Gateway lock and make a new workflow appear to time out.
---

When configuring or restarting the main preview workflow, an old `start-dev-all.sh`
process group may still own `/tmp/cst-gateway.lock`. The old Gateway can answer
health checks while API and portal child processes are gone, so the new workflow
will yield and eventually time out without opening its own preview.

**Why:** The lock protects port 5000 from duplicate Gateway instances, but a
partially dead process group can survive after a workflow configuration change.

**How to apply:** Inspect the process group and listeners before restarting.
Terminate only the stale `start-dev-all.sh` process group, then restart the
single main workflow. Do not remove the lock file while its owner is alive.