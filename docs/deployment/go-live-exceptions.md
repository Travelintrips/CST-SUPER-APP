# Production Go-Live Exceptions

**Checked:** 2026-09-12  
**Scope:** production deployment configuration and preflight evidence

## Completed in the workspace

- Replit deployment configuration is set to `autoscale`.
- The deployment build command is `pnpm run build`.
- The deployment entrypoint is `bash start.sh`.
- `pnpm run build` completed successfully for the workspace artifacts.
- The production secret loader successfully fetched the `cst-super-app-production` bundle and passed its required startup-secret validation without exposing secret values.
- `pnpm run deployment:preflight` now runs through the production secret loader. It no longer treats development-only `_DEV` credentials as production deployment blockers.

## Exceptions that remain

These are intentionally not bypassed:

1. **Publishing has not happened yet.** Replit has no active production deployment or live URL, so production HTTP/auth/proxy smoke tests cannot be run.
2. **Admin domain configuration is unsafe.** The production bundle currently contains the placeholder `example.com` for `ADMIN_EMAIL_DOMAINS`. It must be replaced with the organization-owned admin domain before publishing.
3. **Required runtime secrets are incomplete.** The production bundle does not currently provide `CASHIER_TOKEN_SECRET`, `WATI_API_TOKEN`, `VAPID_PRIVATE_KEY`, or `VAPID_PUBLIC_KEY`. Add real rotated values through the approved production secret process.
4. **Dedicated staging is not provisioned.** Neither `TEST_DATABASE_URL` nor `STAGING_DATABASE_URL` is configured, so the isolated HTTP E2E, tenant-isolation, security, accounting, SSE, and cleanup gates remain blocked.
5. **Credential rotation is not owner-verified.** `docs/security/secret-rotation-status.json` still records `verifiedByOwner: false` and incomplete credential records. This file must only be updated after provider-side rotation and revocation are actually confirmed.
6. **The production gate has not been run to completion.** `validate:production-go` remains `NO-GO` until the staging-dependent gates, production gate, and canonical settlement preflight have current evidence.

## Required release sequence

1. Replace the placeholder admin domain and provision the missing production runtime secrets.
2. Rotate/revoke credentials at their providers and update the rotation evidence file only after owner verification.
3. Provision the isolated staging target, apply migrations, and run the static/runtime/HTTP E2E gates.
4. Run `pnpm run deployment:preflight` and `pnpm run validate:production-go`; resolve every `FAIL`, `BLOCKED`, or `NOT_RUN` result.
5. Publish from Replit Deploy using the configured production build and `start.sh`.
6. Obtain the deployment URL from Replit, run `pnpm run smoke:prod` with that URL, and verify customer portal, auth, BizPortal, and `/api` proxy routes.
