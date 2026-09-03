---
name: Deployment publish build prerequisites
description: The publish builder can auto-detect unrelated root-language manifests, and build scripts must be validated independently from runtime preflight checks.
---

## Rule
Keep root dependency manifests limited to the production stack actually used by the application. Validate the publish dependency/install phase and every configured artifact build separately from environment readiness checks.

**Why:** An unused root Python manifest caused the publish builder to run `uv sync` and fail while installing Pillow into the read-only Nix store. After that was removed, the next independent failure exposed an undefined path in the customer portal translation validator.

**How to apply:** When a publish build fails before application compilation, inspect root manifests and the exact configured build command first. Then run the same install/build sequence locally; treat deployment preflight failures about production domains, staging, or secret rotation as separate configuration concerns.

## Merge resolution guard
Conflict markers can be removed while duplicate JSX wrappers or state declarations remain; always run the exact production build after resolving a merge before publishing.

**Why:** The failed publish contained marker-free merge leftovers that only the production compiler exposed.

**How to apply:** Treat `bash build-prod.sh` as the final gate after conflict resolution, not only `git diff --check` or an individual artifact build.