# GCP Bootstrap Secret Setup Guide

**Version:** 1.0
**Updated:** 2026-08-07
**Topic:** One-time GCP setup for single-credential bootstrap architecture

---

## Overview

This guide documents the one-time GCP setup that enables a fresh Replit import to start
with **exactly ONE Replit Secret** (`GCP_SECRET_MANAGER_BOOTSTRAP_JSON`).

---

## Architecture Summary

```
ONE Replit Secret
  GCP_SECRET_MANAGER_BOOTSTRAP_JSON  (Service Account JSON)
          │ project_id extracted
          ▼
GCP Secret Manager
  cst-super-app-development  (all dev secrets, flat JSON, includes APP_ENV field)
  cst-super-app-production   (all prod secrets, flat JSON, includes APP_ENV field)
          │ loader verifies payload.APP_ENV matches runtime APP_ENV
          ▼
Application (process.env injected at startup)
```

---

## Step 1 — Create a Dedicated Service Account

In GCP Console → IAM & Admin → Service Accounts:

1. Click **Create Service Account**
2. Name: `cst-replit-bootstrap` (or similar)
3. Description: "Bootstrap credential for Replit Secret Manager access"
4. Click **Create and Continue**

### Required Role

Grant the service account **ONE role only**:

```
roles/secretmanager.secretAccessor
```

> ⚠ Do NOT grant `Owner`, `Editor`, or any broader role.
> The bootstrap SA must have minimum permissions — Secret Accessor only.

5. Click **Done**

### Create and Download Key

1. Click the service account → **Keys** tab → **Add Key** → **Create new key**
2. Format: **JSON**
3. Download the key file — this is your `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` value
4. Store it ONLY in Replit Secrets — never commit to git

---

## Step 2 — Create Development Secret Bundle

In GCP Console → Secret Manager → **Create Secret**:

- **Name:** `cst-super-app-development`
- **Value:** (JSON object — paste contents, do not include actual values here)

```json
{
  "APP_ENV": "development",
  "SUPABASE_DATABASE_URL": "<dev-database-url>",
  "VITE_SUPABASE_URL": "<dev-supabase-project-url>",
  "VITE_SUPABASE_ANON_KEY": "<dev-anon-key>",
  "SESSION_SECRET": "<dev-session-secret-min-32-chars>",
  "OPENAI_API_KEY": "<dev-openai-key>",
  "PAYLABS_PRIVATE_KEY": "<dev-paylabs-rsa-key-pem>",
  "FONNTE_TOKEN": "<dev-fonnte-token>",
  "GOOGLE_SERVICE_ACCOUNT_JSON": "<dev-google-sa-json-escaped>",
  "GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN": "<dev-github-pat>",
  "PORTAL_ADMIN_KEY": "<dev-portal-admin-key>"
}
```

> The `APP_ENV` field is mandatory in new-mode bundles. The loader cross-verifies it.

---

## Step 3 — Create Production Secret Bundle

In GCP Console → Secret Manager → **Create Secret**:

- **Name:** `cst-super-app-production`
- **Value:** (JSON object with production values)

```json
{
  "APP_ENV": "production",
  "SUPABASE_DATABASE_URL": "<prod-database-url>",
  "VITE_SUPABASE_URL": "<prod-supabase-project-url>",
  "VITE_SUPABASE_ANON_KEY": "<prod-anon-key>",
  "SESSION_SECRET": "<prod-session-secret-min-32-chars>",
  "OPENAI_API_KEY": "<prod-openai-key>",
  "PAYLABS_PRIVATE_KEY": "<prod-paylabs-rsa-key-pem>",
  "FONNTE_TOKEN": "<prod-fonnte-token>",
  "GOOGLE_SERVICE_ACCOUNT_JSON": "<prod-google-sa-json-escaped>",
  "GITHUB_TOKEN_PERSONAL_ACCESS_TOKEN": "<prod-github-pat>",
  "PORTAL_ADMIN_KEY": "<prod-portal-admin-key>"
}
```

> Production and development bundles must use **completely different values** for
> database URLs, session secrets, API keys, etc.

---

## Step 4 — Grant the Bootstrap SA Access to Both Secrets

For each secret (`cst-super-app-development` and `cst-super-app-production`):

1. Open the secret → **Permissions** tab
2. Click **Grant Access**
3. Principal: `cst-replit-bootstrap@<project-id>.iam.gserviceaccount.com`
4. Role: `Secret Manager Secret Accessor`
5. Save

---

## Step 5 — Add Bootstrap Secret to Replit

In Replit → **Secrets**:

| Key | Value |
|---|---|
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Paste the full contents of the downloaded SA JSON key file |

**That is the only secret to add.** Do not add anything else.

---

## Step 6 — Test the Setup

```bash
# Validate without starting the app (dry-run)
cd artifacts/api-server
node load-secrets.mjs --validate

# Expected output:
# [load-secrets] Environment: development
# [load-secrets] GCP project: <your-project-id> (from bootstrap JSON)
# [load-secrets] Bundle: cst-super-app-development
# [load-secrets] Fetching: projects/<project-id>/secrets/cst-super-app-development/versions/latest
# [load-secrets] Secrets loaded — new: N, overridden: 0
# [load-secrets] Injected keys: SESSION_SECRET, SUPABASE_DATABASE_URL, ...
# [load-secrets] Required secrets: OK ✓
# [load-secrets] --validate complete. All checks passed. Application NOT started.
```

---

## Migration from Legacy Mode (Three Credentials)

If `GCP_PROJECT_ID` and `GCP_SECRET_ID` are currently in Replit Secrets:

1. Create the new `cst-super-app-development` and `cst-super-app-production` bundles (Steps 2–3)
2. Grant the bootstrap SA access to both new bundles (Step 4)
3. Run `node load-secrets.mjs --validate` to verify the new bundles are accessible
4. Once verified, remove `GCP_PROJECT_ID` and `GCP_SECRET_ID` from Replit Secrets
5. The loader automatically switches to single-credential mode when those two are absent

> **Do not remove GCP_PROJECT_ID and GCP_SECRET_ID until Step 3 passes.**
> The loader falls back to legacy mode gracefully while both sets of credentials exist.

---

## Updating a Secret Bundle

To update or rotate any application secret:

1. Open GCP Secret Manager → select the bundle (`cst-super-app-development` or `cst-super-app-production`)
2. Click **New Version** → paste the updated full JSON payload
3. No code changes required — loader always fetches `versions/latest`
4. Restart the relevant workflow to pick up the new values

---

## Rotating the Bootstrap Credential

To rotate the Service Account key:

1. GCP Console → IAM & Admin → Service Accounts → `cst-replit-bootstrap`
2. Keys tab → **Add Key** → download new JSON key
3. Update `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` in Replit Secrets with new value
4. Delete the old key from GCP Console
5. Restart the relevant workflow

---

## Revoking the Bootstrap Credential (Emergency)

To immediately revoke all Replit access to secrets:

1. GCP Console → IAM & Admin → Service Accounts → `cst-replit-bootstrap`
2. **Disable** the service account (fast, reversible)
   OR: Keys tab → delete all keys (permanent)
3. The application will fail startup with "GCP access denied" — this is intentional
4. Remove `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` from Replit Secrets to prevent retry

---

## Custom Bundle Prefix

If your organization uses a different naming convention for GCP secrets, you can override
the default bundle prefix by setting `GCP_SECRET_BUNDLE_PREFIX` in Replit Secrets:

| Env var | Default | Effect |
|---|---|---|
| `GCP_SECRET_BUNDLE_PREFIX` | `cst-super-app` | Bundle name = `{prefix}-{APP_ENV}` |

Example: `GCP_SECRET_BUNDLE_PREFIX=my-company-app` →
bundles `my-company-app-development` and `my-company-app-production`.

---

## Security Checklist

- [ ] Service account has ONLY `roles/secretmanager.secretAccessor` — no Owner/Editor
- [ ] Bootstrap JSON key file downloaded and stored in Replit Secrets only
- [ ] Bootstrap JSON NOT committed to git (`.gitignore` covers it)
- [ ] Development and production bundles have completely different values
- [ ] Both bundles contain `APP_ENV` field matching their environment
- [ ] `node load-secrets.mjs --validate` passes for both environments
- [ ] Old legacy secrets (`GCP_PROJECT_ID`, `GCP_SECRET_ID`) removed after migration

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON is not set` | Secret missing from Replit | Add the SA JSON to Replit Secrets |
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON is not valid JSON` | Corrupt value in Replit | Re-paste the downloaded SA JSON key file |
| `Missing required fields: project_id` | Wrong JSON pasted | Ensure the value is the full SA key file (not just partial JSON) |
| `Failed to fetch ... PERMISSION_DENIED` | SA lacks access to the bundle | Grant `Secret Manager Secret Accessor` on the specific bundle |
| `Failed to fetch ... NOT_FOUND` | Bundle does not exist yet | Create the GCP secret bundle following Steps 2–3 |
| `Bundle environment mismatch` | Wrong bundle fetched or wrong APP_ENV in payload | Verify `APP_ENV` field in bundle JSON matches the bundle environment |
| `Required secrets missing: SESSION_SECRET` | Bundle payload missing required key | Add `SESSION_SECRET` to the bundle JSON in GCP |
