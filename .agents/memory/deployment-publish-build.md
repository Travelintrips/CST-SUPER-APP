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

## Artifact entrypoint compatibility
When an artifact manifest starts a historical dist entrypoint, the build must either emit that exact file or create a byte-for-byte compatibility alias after bundling. Prefer detecting the actual bundler output so the alias step is a no-op when the current source already emits the manifest path.

**Why:** The API publish runtime referenced `dist/index.mjs` while the bundler output changed between `bootstrap.mjs` and `index.mjs`; a clean build can otherwise pass compilation and still fail at process start.

**How to apply:** Compare the configured artifact entrypoint with the build output in every publish validation, and test the configured start command—not only the compiler.