---
name: Artifact workflow CWD
description: Artifact workflows start from the workspace root, so commands must address scripts with workspace-relative paths.
---

Artifact workflows do not automatically change into the artifact directory. A script configured as `bash start-dev.sh` fails with “No such file or directory” when the script lives under an artifact directory; use a workspace-relative command such as `bash artifacts/customer-portal/start-dev.sh`, or explicitly `cd` before running the command.

**Why:** The workflow runner launches commands from the workspace root, while artifact metadata may describe commands as if they run from the artifact directory.

**How to apply:** When configuring or repairing an artifact preview workflow, verify the command’s working directory and use a root-relative path unless the command explicitly changes directory.