# Secret Rotation Runbook

**Last Updated:** 2026-07-24  
**Classification:** Internal — DevOps / Security Lead  
**Status:** ⛔ All 19 credentials pending rotation (see `docs/security/secret-rotation-status.json`)

> **IMPORTANT:** Never write credential values into this file or any other file in the repository.
> All values are injected exclusively through the Replit Secrets panel.

---

## Overview

This runbook covers credential rotation for all external and internal secrets used by the CST Super App.
Rotation must be performed by the account owner who holds access to all provider dashboards.

**Automated validator:**
```bash
pnpm run audit:secrets
# Expected: PRESENT: N | MISSING: 0 | INVALID: 0 | exit 0
```

**Rotation status check:**
```bash
pnpm run audit:secret-rotation
# exit 0 = all marked rotated; exit 1 = incomplete
```

**After each rotation:** update `docs/security/secret-rotation-status.json` — set the credential's
`rotated`, `oldCredentialRevoked`, and `verified` fields to `true`, and set `verifiedAt` to the ISO timestamp.

---

## Rotation Order (recommended)

Rotate in this sequence to minimize cascading failures:

1. Internal JWT secrets and session secret (no external dependency)
2. Database credentials (Supabase) — restart API server immediately after
3. Auth providers (Google OAuth)
4. Messaging providers (Fonnte, WATI)
5. Payment provider (Paylabs)
6. Email (SMTP)
7. AI provider (OpenAI)
8. Source control (GitHub)

---

## 1. Supabase — Database & Auth

### 1.1 Credentials

| Field | Detail |
|---|---|
| **Provider** | Supabase (supabase.com) |
| **Environment** | Production: `SUPABASE_DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_MIGRATION_URL` · Development: `*_DEV` variants |
| **Rotation Trigger** | Every 90 days; immediately on suspected compromise; before every production deployment |
| **Rotation Method** | Supabase Dashboard → Settings → API → Regenerate service-role key; Settings → Database → Reset database password |
| **Injection Method** | Replit Secrets panel — workspace store for dev variants; deployment store for production variants |
| **Verification Method** | `pnpm run audit:customer-runtime` → exit 0; `curl /api/health` → `status: ok` |
| **Old Credential Revocation** | Supabase invalidates JWTs immediately on regeneration; DB password is invalidated on reset |
| **Rollback** | Re-rotate immediately (there is no restore for Supabase JWTs); update Replit Secrets with newest values |
| **Owner** | Account Owner (Supabase dashboard access required) |
| **Evidence Required** | Runtime health log confirming DB connected after rotation; `audit:secrets` exit 0 |

| Secret | Key name | Scope |
|---|---|---|
| Production DB pooler URL | `SUPABASE_DATABASE_URL` | prod |
| Production service-role JWT | `SUPABASE_SERVICE_ROLE_KEY` | prod |
| Production anon JWT | `SUPABASE_ANON_KEY` | prod |
| Production migration URL | `SUPABASE_MIGRATION_URL` | prod |
| Dev DB pooler URL | `SUPABASE_DATABASE_URL_DEV` | dev |
| Dev service-role JWT | `SUPABASE_SERVICE_ROLE_KEY_DEV` | dev |
| Dev anon JWT | `SUPABASE_ANON_KEY_DEV` | dev |

### 1.2 Rotation steps

1. Log in to [app.supabase.com](https://app.supabase.com).
2. Select the **production** project (`nzdweipzckfszczzqtuw`).
3. Navigate to **Settings → API**.
4. Click **Regenerate** next to the service role key.
   - Copy the new `service_role` value immediately (shown once).
5. Navigate to **Settings → Database → Connection Pooling**.
   - If rotating the database password: click **Reset database password**.
   - Copy the new pooler connection strings.
6. Update Replit Secrets:
   - `SUPABASE_SERVICE_ROLE_KEY` = new service-role JWT
   - `SUPABASE_DATABASE_URL` = new pooler URL (port 6543, transaction mode)
   - `SUPABASE_MIGRATION_URL` = new direct URL (port 5432)
   - `SUPABASE_ANON_KEY` = new anon JWT (regenerated simultaneously with service role)
7. Repeat steps 2–6 for the **dev** project (`xssrfshdrtdfupgqwfdw`) → update `*_DEV` variants.
8. Revoke old credentials: Supabase invalidates old JWTs immediately upon regeneration.

### 1.3 Smoke test

```bash
# Verify DB connectivity
pnpm run audit:customer-runtime

# Verify API server health
curl -sf http://127.0.0.1:18444/api/health | jq .
```

Expected: `status: ok`, DB pool connected.

### 1.4 Rollback

Supabase does not support reverting a JWT regeneration. If the new key is incorrect:
1. Immediately re-rotate to generate a new key.
2. Update Replit Secrets with the newest key.
3. Restart all services.

---

## 2. Internal JWT & Session Secrets

### 2.1 Credentials

| Field | Detail |
|---|---|
| **Provider** | Internal (self-generated — no external dashboard) |
| **Environment** | Production + Development (separate values per environment) |
| **Rotation Trigger** | Every 90 days; immediately on suspected compromise; before every production deployment |
| **Rotation Method** | `openssl rand -hex 64` for HMAC secrets; `npx web-push generate-vapid-keys` for VAPID |
| **Injection Method** | Replit Secrets panel — workspace store (dev) and deployment store (prod) independently |
| **Verification Method** | `curl /api/health` → status ok; login flow succeeds; cashier token signing works |
| **Old Credential Revocation** | Old values are invalidated immediately when new values are injected and services restarted; no external revocation needed |
| **Rollback** | No restoration of old JWT secrets — generate new values immediately if rotation fails |
| **Owner** | Engineering Lead (generates values); Account Owner (injects into production secrets) |
| **Evidence Required** | Health log post-rotation; login flow smoke test; `audit:secrets` exit 0 |

| Secret | Key name | Algorithm | Min length |
|---|---|---|---|
| Express session signing | `SESSION_SECRET` | HMAC | 32 chars |
| Customer/vendor portal JWT | `PORTAL_JWT_SECRET` | HMAC-SHA256 | 32 chars |
| Driver app JWT | `DRIVER_JWT_SECRET` | HMAC-SHA256 | 32 chars |
| POS cashier token | `CASHIER_TOKEN_SECRET` | HMAC-SHA256 | 32 chars |
| Admin API key | `PORTAL_ADMIN_KEY` | Random | 32 chars |
| VAPID push key | `VAPID_PRIVATE_KEY` | ECDSA P-256 | standard |

### 2.2 Rotation steps

1. Generate new values (no external provider):
   ```bash
   # For HMAC secrets (SESSION_SECRET, PORTAL_JWT_SECRET, DRIVER_JWT_SECRET, CASHIER_TOKEN_SECRET, PORTAL_ADMIN_KEY)
   openssl rand -hex 64

   # For VAPID_PRIVATE_KEY — use web-push CLI
   npx web-push generate-vapid-keys
   # Copy the privateKey value only
   ```
2. Update Replit Secrets with the new values (development + production separately).
3. Restart all services:
   ```bash
   # In Replit: Stop Gateway → Start Gateway
   ```
4. **Impact of SESSION_SECRET rotation:** all active browser sessions are invalidated. Users must log in again.
5. **Impact of PORTAL_JWT_SECRET / DRIVER_JWT_SECRET rotation:** all issued JWTs become invalid immediately.
   Mobile app users (CST Driver) must re-authenticate.
6. **Impact of CASHIER_TOKEN_SECRET rotation:** all active POS cashier tokens are invalidated.

### 2.3 Smoke test

```bash
curl -sf http://127.0.0.1:18444/api/health | jq .
# Expect: status ok

# Verify cashier token signing
curl -sf -X POST http://127.0.0.1:18444/api/kasir/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"test"}' | jq .status
```

### 2.4 Rollback

There is no rollback for JWT secret rotation — the old tokens are permanently invalidated.
If rotation breaks a critical flow, generate a new value immediately (do not restore the old one).

---

## 3. Google — OAuth & Service Account

### 3.1 Credentials

| Field | Detail |
|---|---|
| **Provider** | Google Cloud Platform (console.cloud.google.com) |
| **Environment** | Production |
| **Rotation Trigger** | Every 180 days; immediately on personnel change or suspected compromise |
| **Rotation Method** | GCP Console → APIs & Services → Credentials → Reset Secret (OAuth); Service Accounts → Keys → Add Key (service account) |
| **Injection Method** | Replit Secrets deployment store: `GOOGLE_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON` |
| **Verification Method** | Complete Google OAuth login flow in Customer Portal; trigger Google Sheets sync from BizPortal |
| **Old Credential Revocation** | OAuth: delete old client secret via GCP Console; Service account: delete old key via Service Accounts → Keys |
| **Rollback** | Create new credentials immediately — old credentials cannot be restored once deleted |
| **Owner** | Account Owner (GCP project access required) |
| **Evidence Required** | OAuth login success screenshot; Sheets sync log; `audit:secrets` exit 0 |

| Secret | Key name | Console path |
|---|---|---|
| OAuth client secret | `GOOGLE_CLIENT_SECRET` | APIs & Services → Credentials |
| Service account JSON | `GOOGLE_SERVICE_ACCOUNT_JSON` | APIs & Services → Service Accounts |

### 3.2 Rotation — OAuth client secret

1. Log in to [console.cloud.google.com](https://console.cloud.google.com).
2. Project: `cst-super-app`.
3. Navigate to **APIs & Services → Credentials**.
4. Click the OAuth 2.0 Client ID used by the app.
5. Click **Reset Secret** (or delete + recreate the client).
6. Copy the new client secret.
7. Update Replit Secrets: `GOOGLE_CLIENT_SECRET` = new value.
8. Update `GOOGLE_REDIRECT_BASE_URL` if the deployment domain changed.
9. Test: attempt Google OAuth login from the Customer Portal.

### 3.3 Rotation — Service account key

1. Navigate to **APIs & Services → Service Accounts**.
2. Select `sheet-customer@cst-super-app.iam.gserviceaccount.com`.
3. Click **Keys → Add Key → Create new key → JSON**.
4. Download the new JSON file.
5. Update Replit Secrets: `GOOGLE_SERVICE_ACCOUNT_JSON` = paste full JSON content (minified).
6. **Revoke the old key:** Service Accounts → Keys → select old key → Delete.
7. Smoke test: trigger a Google Sheets sync from BizPortal.

### 3.4 Rollback

Re-create a new service account key immediately. The old key cannot be restored once deleted.

---

## 4. SMTP — Outbound Email

### 4.1 Credentials

| Field | Detail |
|---|---|
| **Provider** | SMTP provider (e.g., SendGrid, Mailgun, Mailtrap) |
| **Environment** | Production; staging uses a sandbox SMTP endpoint (e.g., Mailtrap) |
| **Rotation Trigger** | Every 90 days; immediately on suspected compromise |
| **Rotation Method** | SMTP provider dashboard → generate new API key / password |
| **Injection Method** | Replit Secrets deployment store: `SMTP_PASS` (and `SMTP_HOST`, `SMTP_USER`, `SMTP_PORT` if changed) |
| **Verification Method** | `node -e "nodemailer.createTransport(...).verify(cb)"` → SMTP OK |
| **Old Credential Revocation** | Revoke old key in SMTP provider dashboard after new key verified |
| **Rollback** | Generate new SMTP key immediately; check provider dashboard for quota or block issues |
| **Owner** | Account Owner (SMTP provider dashboard access required) |
| **Evidence Required** | SMTP verify log; test email delivered to internal address; `audit:secrets` exit 0 |

| Secret | Key name |
|---|---|
| SMTP host | `SMTP_HOST` |
| SMTP user | `SMTP_USER` |
| SMTP password | `SMTP_PASS` |
| SMTP port | `SMTP_PORT` |

### 4.2 Rotation steps

1. Log in to your SMTP provider dashboard (e.g., SendGrid, Mailgun, Mailtrap).
2. Generate a new API key / password.
3. Update Replit Secrets: `SMTP_PASS` = new value.
4. Revoke the old key in the SMTP provider dashboard.
5. Restart the API server.

### 4.3 Smoke test

```bash
# From the API server shell:
node -e "
  const nodemailer = await import('nodemailer');
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  t.verify((e, ok) => console.log(ok ? 'SMTP OK' : e.message));
"
```

### 4.4 Rollback

Generate a new SMTP key. If email delivery breaks, check provider dashboard for quota/block issues.

---

## 5. Fonnte — WhatsApp Messaging

### 5.1 Credentials

| Field | Detail |
|---|---|
| **Provider** | Fonnte (app.fonnte.com) |
| **Environment** | Production; Fonnte does not offer a sandbox mode — staging uses `E2E_TEST_MODE=true` to suppress outbound |
| **Rotation Trigger** | Every 90 days; immediately on suspected compromise |
| **Rotation Method** | Fonnte dashboard → API settings → Regenerate token |
| **Injection Method** | Replit Secrets deployment store: `FONNTE_TOKEN` |
| **Verification Method** | `curl https://api.fonnte.com/validate -H "Authorization: $FONNTE_TOKEN"` → status true |
| **Old Credential Revocation** | Old token invalidated in Fonnte dashboard after new token verified |
| **Rollback** | Regenerate immediately — old token cannot be restored |
| **Owner** | Account Owner (Fonnte dashboard access required) |
| **Evidence Required** | Fonnte validate API response log; `audit:secrets` exit 0 |

| Secret | Key name | Min length |
|---|---|---|
| Fonnte API token | `FONNTE_TOKEN` | 16 chars |

### 5.2 Rotation steps

1. Log in to [app.fonnte.com](https://app.fonnte.com).
2. Navigate to **API** settings.
3. Regenerate the API token.
4. Copy the new token.
5. Update Replit Secrets: `FONNTE_TOKEN` = new value.
6. Revoke the old token in the Fonnte dashboard.

### 5.3 Smoke test

```bash
curl -s https://api.fonnte.com/validate \
  -H "Authorization: $FONNTE_TOKEN" | jq .status
# Expect: 'true'
```

### 5.4 Rollback

Immediately regenerate again if the new token is incorrect. No restoration of old token is possible.

---

## 6. WATI — WhatsApp Business API

### 6.1 Credentials

| Field | Detail |
|---|---|
| **Provider** | WATI (app.wati.io) |
| **Environment** | Production; use WATI sandbox number for staging if available |
| **Rotation Trigger** | Every 90 days; immediately on suspected compromise |
| **Rotation Method** | WATI dashboard → Settings → API → Regenerate access token |
| **Injection Method** | Replit Secrets deployment store: `WATI_API_TOKEN`; update `WATI_BASE_URL` if endpoint changed |
| **Verification Method** | `curl "$WATI_BASE_URL/api/v1/getContacts?pageSize=1" -H "Authorization: Bearer $WATI_API_TOKEN"` → not 401 |
| **Old Credential Revocation** | Revoke old token in WATI dashboard after new token verified |
| **Rollback** | Generate new WATI token immediately; alert active WATI automation flows |
| **Owner** | Account Owner (WATI dashboard access required) |
| **Evidence Required** | WATI contacts API response log; `audit:secrets` exit 0 |

| Secret | Key name | Min length |
|---|---|---|
| WATI API token | `WATI_API_TOKEN` | 32 chars |

### 6.2 Rotation steps

1. Log in to [app.wati.io](https://app.wati.io).
2. Navigate to **Settings → API**.
3. Regenerate the access token.
4. Update Replit Secrets: `WATI_API_TOKEN` = new value.
5. Update `WATI_BASE_URL` if the endpoint changed.
6. Revoke the old token in WATI dashboard.

### 6.3 Smoke test

```bash
curl -s "${WATI_BASE_URL}/api/v1/getContacts?pageSize=1" \
  -H "Authorization: Bearer $WATI_API_TOKEN" | jq .result
# Expect: ok or empty list — not 401
```

### 6.4 Rollback

Generate a new WATI token immediately. Alert any active WATI automation flows to re-authenticate.

---

## 7. Paylabs — Payment Processing

### 7.1 Credentials

| Field | Detail |
|---|---|
| **Provider** | Paylabs (merchant dashboard) |
| **Environment** | Production: `PAYLABS_PRIVATE_KEY` · Sandbox/Staging: `PAYLABS_PRIVATE_KEY_SANDBOX` |
| **Rotation Trigger** | Every 180 days; per Paylabs security policy; immediately on suspected compromise |
| **Rotation Method** | Paylabs dashboard → Settings → API Keys → Generate new RSA key pair; upload new public key to Paylabs |
| **Injection Method** | Replit Secrets deployment store: `PAYLABS_PRIVATE_KEY` (full PEM block) |
| **Verification Method** | Sandbox callback flow with signature validation; check API server logs for `[paylabs] signature OK`. **Production payment credentials must NOT be tested by triggering real financial transactions.** Use Paylabs health/verification endpoint or sandbox callback only. If Paylabs provides no verification endpoint, use owner-approved alternative procedure. |
| **Old Credential Revocation** | Revoke old key pair in Paylabs dashboard after new key pair verified |
| **Rollback** | Re-upload old public key to Paylabs; restore old private key from offline secret backup; alert Paylabs account manager if live transactions affected |
| **Owner** | Account Owner (Paylabs merchant dashboard access required) |
| **Evidence Required** | Sandbox callback log with `[paylabs] signature OK`; `audit:secrets` exit 0 |

| Secret | Key name | Notes |
|---|---|---|
| Production private key | `PAYLABS_PRIVATE_KEY` | RSA private key — PEM format |
| Sandbox private key | `PAYLABS_PRIVATE_KEY_SANDBOX` | RSA private key — PEM format |

### 7.2 Rotation steps

1. Log in to the Paylabs merchant dashboard.
2. Navigate to **Settings → API Keys**.
3. Generate a new RSA key pair (or upload a new public key).
4. Download/copy the new private key (PEM format).
5. Update Replit Secrets:
   - `PAYLABS_PRIVATE_KEY` = new production private key (full PEM block)
   - `PAYLABS_PRIVATE_KEY_SANDBOX` = new sandbox private key
6. Register the corresponding public key in the Paylabs dashboard.
7. Revoke the old key pair.

### 7.3 Smoke test

1. Trigger a sandbox payment flow from the Customer Portal.
2. Verify the callback webhook is received and the signature validates.
3. Check the API server logs for `[paylabs] signature OK`.

### 7.4 Rollback

Re-upload the old public key to Paylabs if the new key is rejected. Restore the old private key in
Replit Secrets. Alert the Paylabs account manager if live transactions are affected.

---

## 8. OpenAI — AI Features

### 8.1 Credentials

| Field | Detail |
|---|---|
| **Provider** | OpenAI (platform.openai.com) |
| **Environment** | Production; use a quota-limited staging key for staging/testing |
| **Rotation Trigger** | Every 90 days; immediately on suspected compromise or quota anomaly |
| **Rotation Method** | OpenAI dashboard → API Keys → Create new secret key → copy immediately (shown once) |
| **Injection Method** | Replit Secrets deployment store: `OPENAI_API_KEY`; verify `OPENAI_BASE_URL=https://api.openai.com/v1` |
| **Verification Method** | `curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"` → positive model count |
| **Old Credential Revocation** | Delete old key from OpenAI dashboard after new key verified |
| **Rollback** | Create new OpenAI key immediately; app degrades gracefully without AI features |
| **Owner** | Account Owner (OpenAI platform access required) |
| **Evidence Required** | OpenAI models API response log; `audit:secrets` exit 0 |

| Secret | Key name |
|---|---|
| OpenAI API key | `OPENAI_API_KEY` |

### 8.2 Rotation steps

1. Log in to [platform.openai.com](https://platform.openai.com).
2. Navigate to **API Keys**.
3. Click **Create new secret key** → copy the value immediately (shown once).
4. Update Replit Secrets: `OPENAI_API_KEY` = new key.
5. Delete the old key from the OpenAI dashboard.
6. Verify `OPENAI_BASE_URL` is set to the direct OpenAI endpoint (not the localhost proxy):
   ```
   OPENAI_BASE_URL=https://api.openai.com/v1
   ```

### 8.3 Smoke test

```bash
curl -s https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | jq '.data | length'
# Expect: positive integer
```

### 8.4 Rollback

Generate a new OpenAI key. If AI features break, the app degrades gracefully — non-AI flows are unaffected.

---

## 9. GitHub — Source Control

### 9.1 Credentials

| Field | Detail |
|---|---|
| **Provider** | GitHub (github.com) |
| **Environment** | Production / CI |
| **Rotation Trigger** | Every 90 days; immediately on personnel change or suspected compromise |
| **Rotation Method** | GitHub → Settings → Developer settings → Personal access tokens → Generate new token (fine-grained, minimum required scopes) |
| **Injection Method** | Replit Secrets (workspace or deployment store as applicable): `GITHUB_PERSONAL_ACCESS_TOKEN` |
| **Verification Method** | `curl -H "Authorization: Bearer $GITHUB_PERSONAL_ACCESS_TOKEN" https://api.github.com/user` → returns GitHub username |
| **Old Credential Revocation** | Revoke old token in GitHub → Developer settings → Personal access tokens → Delete |
| **Rollback** | Generate new token immediately — GitHub does not allow restoring revoked tokens |
| **Owner** | Account Owner (GitHub account access required) |
| **Evidence Required** | GitHub user API response log; `audit:secrets` exit 0 |

| Secret | Key name |
|---|---|
| Personal access token | `GITHUB_PERSONAL_ACCESS_TOKEN` |

### 9.2 Rotation steps

1. Log in to GitHub → **Settings → Developer settings → Personal access tokens**.
2. Click **Generate new token (classic)** or **Fine-grained token**.
3. Select the minimum required scopes (repo access for the CST Super App repository only).
4. Copy the new token.
5. Update Replit Secrets: `GITHUB_PERSONAL_ACCESS_TOKEN` = new value.
6. Revoke the old token in GitHub settings.

### 9.3 Smoke test

```bash
curl -s -H "Authorization: Bearer $GITHUB_PERSONAL_ACCESS_TOKEN" \
  https://api.github.com/user | jq .login
# Expect: your GitHub username
```

### 9.4 Rollback

Generate a new token immediately. GitHub does not allow restoring revoked tokens.

---

## 10. Internal — Session Secret

### 10.1 Credential

| Secret | Key name | Notes |
|---|---|---|
| Express session secret | `SESSION_SECRET` | Covered in Section 2, listed separately here for completeness |

See Section 2 for full rotation procedure.

---

## Post-Rotation Checklist

After rotating ALL credentials:

```bash
# 1. Verify all secrets are present and non-placeholder
pnpm run audit:secrets
# Expected: PRESENT: N | MISSING: 0 | INVALID: 0

# 2. Mark rotation as complete in status file
# Edit: docs/security/secret-rotation-status.json
# Set verifiedByOwner: true, verifiedAt: ISO timestamp
# Set each credential's rotated + oldCredentialRevoked + verified: true

# 3. Verify rotation gate passes
pnpm run audit:secret-rotation
# Expected: exit 0

# 4. Restart all services
# Stop Gateway workflow → Start Gateway workflow

# 5. Run full production gate
pnpm run audit:customer-production
# Expected after staging + rotation complete: GO
```

---

## Rotation Schedule

| Credential class | Recommended frequency |
|---|---|
| Internal JWT / session secrets | Every 90 days |
| Supabase service role keys | Every 90 days or after any suspected compromise |
| OAuth client secret | Every 180 days |
| API tokens (Fonnte, WATI, OpenAI, GitHub) | Every 90 days |
| Payment keys (Paylabs) | Every 180 days or per Paylabs policy |
| Service account JSON | Every 90 days; immediately upon personnel change |

---

## Emergency Rotation (suspected compromise)

1. Immediately rotate ALL credentials in parallel using this runbook.
2. Revoke all active sessions: restart the API server (invalidates SESSION_SECRET-signed cookies).
3. Audit database access logs in Supabase → Logs → API.
4. Review API server logs for anomalous traffic patterns.
5. Notify affected users if customer data may have been accessed.
6. Document the incident in `docs/security/incident-log.md`.
