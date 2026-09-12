---
name: Isolated test DB connectivity
description: Connectivity and schema prerequisites for the API regression suite's isolated Supabase test target.
---

The isolated Supabase test target may expose only a direct IPv6 database endpoint, while the Replit runner's Node `pg` client can fail with `ENOTFOUND` even when a shell DNS probe briefly returns an IPv6 address. Its project can also be reachable through a same-project pooler while still lacking the application schema required by DB-backed tests.

**Why:** substituting the development or production database would violate the regression suite's isolation boundary and could mutate business data. A reachable database is not evidence that the test schema is provisioned.

**How to apply:** preserve the test-target guard, verify the pooler belongs to the same isolated project before using it ephemerally for a test command, and report DNS/transport or missing-schema failures as infrastructure blockers rather than bypassing the guard or changing a live database without explicit approval.

The managed secret loader can inject `TEST_DATABASE_URL` into a workflow child process even when the variable is absent from the interactive shell. Run DB-backed tests through `load-secrets.mjs`; do not infer that the target is unavailable from shell-level env inspection alone.

**Why:** the development workflow and interactive shell have different environment assembly paths, while direct isolated Supabase DNS may still be unavailable to Node.

**How to apply:** use the official loader for the first attempt, keep the URL masked, and only try a same-project pooler when its tenant/region identity is verified without exposing credentials.

The loader requires `APP_ENV=development|production` independently of `NODE_ENV`; in a workspace without `GCP_SECRET_MANAGER_BOOTSTRAP_JSON`, the official DB-backed test command stops before injecting `TEST_DATABASE_URL`.

**Why:** `NODE_ENV=test` selects Vitest behavior but is intentionally not accepted as a secret-bundle selector, and bypassing the managed bundle could route tests to an unverified database.

**How to apply:** run the test with the intended `APP_ENV` through `load-secrets.mjs`; if bootstrap is unavailable, report the DB execution as environment-blocked while keeping the test fail-closed.

The current managed development bundle can still inject `TEST_DATABASE_URL` as a direct `db.<project>.supabase.co:5432` endpoint even when the approved checkpoint expects a regional pooler. The official loader does not rewrite that target, so repeated Node `ENOTFOUND` failures are an environment-provisioning blocker.

**Why:** rerunning the same test or increasing its timeout cannot repair DNS transport, and deriving an unverified pooler URL risks crossing the TEST isolation boundary.

**How to apply:** report the masked target shape and stop; require the TEST secret/bundle owner to provision the verified same-project pooler URL before resuming DB-backed E2E.