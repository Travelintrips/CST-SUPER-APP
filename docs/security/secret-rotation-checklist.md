# Secret Rotation Checklist

This checklist must be completed before every production release.
**Never write secret values into this file.**

Run the automated validator:
```bash
pnpm run audit:secrets
```
Expected output per secret: `SECRET_NAME: PRESENT` or `SECRET_NAME: MISSING` or `SECRET_NAME: INVALID`.
Exit code 0 = all required secrets PRESENT and not placeholder.

---

## Auth / Session Secrets

- [ ] **SESSION_SECRET** — Express session signing. Minimum 32 characters. Rotate every 90 days.
- [ ] **PORTAL_JWT_SECRET** — Customer/vendor portal JWT signing. Minimum 32 characters. Rotate every 90 days.
- [ ] **DRIVER_JWT_SECRET** — Driver app JWT signing. Minimum 32 characters. Rotate every 90 days.
- [ ] **CASHIER_TOKEN_SECRET** — POS cashier token signing. Minimum 32 characters. Rotate every 90 days.
- [ ] **PORTAL_ADMIN_KEY** — Admin API key. Minimum 32 characters. Rotate every 90 days.

**Rotation procedure (auth secrets):**
1. Generate a new random value (`openssl rand -hex 32`).
2. Update the value in Replit Secrets → development and production environments.
3. Run `pnpm run audit:secrets` — all entries must show PRESENT.
4. Restart all services.
5. Invalidate existing sessions if the SECRET_KEY changed (users must re-login).

---

## Database Secrets

### Development (DEV)
- [ ] **SUPABASE_DATABASE_URL_DEV** — Pooler URL for dev Supabase project. Never point at prod ref.
- [ ] **SUPABASE_SERVICE_ROLE_KEY_DEV** — Service-role JWT for dev project only.
- [ ] **SUPABASE_ANON_KEY_DEV** — Anon JWT for dev project only.

### Production (PROD — only required when deploying)
- [ ] **SUPABASE_DATABASE_URL** — Pooler URL for prod Supabase project (`nzdweipzckfszczzqtuw`).
- [ ] **SUPABASE_SERVICE_ROLE_KEY** — Service-role JWT for prod project. Do NOT use dev key.
- [ ] **SUPABASE_ANON_KEY** — Anon JWT for prod project. Do NOT use dev key.

**Rotation procedure (database secrets):**
1. Rotate the key in Supabase dashboard → Settings → API.
2. Update Replit Secrets immediately after rotation.
3. Run `pnpm run audit:secrets` to confirm PRESENT.
4. Verify DB connectivity: `pnpm run db:verify:dev` and `pnpm run db:verify:prod`.

---

## Messaging Secrets

- [ ] **FONNTE_TOKEN** — WhatsApp messaging via Fonnte. Minimum 16 characters.
- [ ] **WATI_API_TOKEN** — WhatsApp messaging via Wati. Minimum 32 characters.

**Rotation procedure (messaging):**
1. Regenerate the token in the Fonnte / Wati dashboard.
2. Update Replit Secrets.
3. Run `pnpm run audit:secrets`.

---

## Email Secrets

- [ ] **SMTP_PASS** — SMTP server password. Minimum 8 characters.

**Rotation procedure (email):**
1. Rotate the SMTP credential in your email provider's admin panel.
2. Update Replit Secrets.
3. Run `pnpm run audit:secrets`.

---

## Payment Gateway Secrets

- [ ] **PAYLABS_PRIVATE_KEY** — RSA private key for Paylabs. Minimum 100 characters. Rotate per Paylabs policy.

**Rotation procedure (Paylabs):**
1. Generate a new RSA key pair or obtain from Paylabs dashboard.
2. Register the new public key with Paylabs.
3. Update PAYLABS_PRIVATE_KEY in Replit Secrets.
4. Run `pnpm run audit:secrets`.

---

## AI / Push Notification Secrets

- [ ] **OPENAI_API_KEY** — OpenAI API access. Minimum 20 characters.
- [ ] **VAPID_PRIVATE_KEY** — Web push VAPID private key. Minimum 40 characters.
- [ ] **VAPID_PUBLIC_KEY** — Web push VAPID public key. Minimum 40 characters.

---

## Validation Rules

The automated validator (`scripts/validate-secret-rotation.mjs`) enforces:

| Rule | Description |
|------|-------------|
| PRESENT | Secret is set and non-empty |
| MISSING | Secret is not set or empty |
| INVALID | Secret contains a placeholder value or is shorter than minimum length |

Placeholder values that trigger INVALID: `changeme`, `example`, `test123`, `secret`, `placeholder`, `undefined`, `null`, `todo`, `fixme`, `_dummy_api_key_`, and similar.

**The validator NEVER prints secret values, substrings, hashes, or any derivation of the secret.**

---

## Pre-Release Checklist

Before every production deployment, verify all boxes below are checked:

- [ ] `pnpm run audit:secrets` exits 0
- [ ] No `_DEV` secrets are present in the production environment
- [ ] No production secrets are present in the development environment
- [ ] All secrets have been rotated within their maximum age (90 days for auth, per-policy for others)
- [ ] DB connectivity verified: `pnpm run db:verify:prod`
- [ ] Production gate passes: `pnpm run audit:customer-production`

---

## Prohibited Actions

- ❌ Never commit a secret value to git
- ❌ Never log, print, or return a secret value or its hash
- ❌ Never use a `_DEV` credential in production
- ❌ Never use the production credential in a dev/test environment
- ❌ Never use placeholder values in any environment
Generated: 2026-07-24
Status: **ROTATION REQUIRED** for secrets that were visible in shared workspace environment.

> ⚠️  Jangan menaruh nilai credential di file ini.
> File ini hanya berisi nama variabel, status, dan instruksi tindakan.

## Inventaris Secret

| Secret Name | Provider | Environment | Rotation Required | Rotated | Verified | Notes |
|---|---|---|---|---|---|---|
| FONNTE_TOKEN | Fonnte (WhatsApp) | shared | **YES** | ☐ | ☐ | Nilai pernah terlihat di workspace shared env |
| WATI_API_TOKEN | Wati (WhatsApp) | shared | **YES** | ☐ | ☐ | Nilai pernah terlihat di workspace shared env |
| SMTP_PASS | Resend / SMTP | shared | **YES** | ☐ | ☐ | Nilai pernah terlihat di workspace shared env |
| PAYLABS_PRIVATE_KEY | Paylabs | shared | **YES** | ☐ | ☐ | Kunci privat pembayaran — prioritas rotasi tinggi |
| PAYLABS_PRIVATE_KEY_SANDBOX | Paylabs | shared | **YES** | ☐ | ☐ | Sandbox key — rotasi bersama production |
| SESSION_SECRET | Internal | secrets store | NO* | ☐ | ☐ | Di secrets store, nilai tidak terekspos |
| CASHIER_TOKEN_SECRET | Internal | shared | **YES** | ☐ | ☐ | Nilai pernah terlihat di workspace shared env |
| PORTAL_JWT_SECRET | Internal | shared | **YES** | ☐ | ☐ | Nilai pernah terlihat di workspace shared env |
| DRIVER_JWT_SECRET | Internal | shared | **YES** | ☐ | ☐ | Nilai pernah terlihat di workspace shared env |
| PORTAL_ADMIN_KEY | Internal | shared | **YES** | ☐ | ☐ | Nilai pernah terlihat di workspace shared env |
| VAPID_PRIVATE_KEY | Web Push | shared | **YES** | ☐ | ☐ | Nilai pernah terlihat di workspace shared env |
| SUPABASE_SERVICE_ROLE_KEY | Supabase (prod) | production | **YES** | ☐ | ☐ | Service role key prod — akses penuh DB |
| SUPABASE_SERVICE_ROLE_KEY_DEV | Supabase (dev) | development | **YES** | ☐ | ☐ | Service role key dev |
| SUPABASE_DATABASE_URL | Supabase (prod) | production | **YES** | ☐ | ☐ | Connection string mengandung password |
| SUPABASE_DATABASE_URL_DEV | Supabase (dev) | development | **YES** | ☐ | ☐ | Connection string mengandung password |
| SUPABASE_ANON_KEY | Supabase (prod) | production | **YES** | ☐ | ☐ | Nilai pernah terlihat |
| SUPABASE_ANON_KEY_DEV | Supabase (dev) | development | **YES** | ☐ | ☐ | Nilai pernah terlihat |
| GITHUB_PERSONAL_ACCESS_TOKEN | GitHub | secrets store | **YES** | ☐ | ☐ | PAT dengan akses repo — rotasi segera |
| OPENAI_API_KEY | OpenAI | secrets store | NO* | ☐ | ☐ | Di secrets store |
| GOOGLE_CLIENT_SECRET | Google OAuth | shared | **YES** | ☐ | ☐ | Nilai pernah terlihat di workspace shared env |
| GOOGLE_SERVICE_ACCOUNT_JSON | Google Cloud | not configured | N/A | — | — | Belum dikonfigurasi di environment ini |
| SUPABASE_MIGRATION_URL | Supabase (prod) | shared | **YES** | ☐ | ☐ | Direct connection string dengan password |

## Rotasi yang Harus Dilakukan Manual

Semua rotasi di bawah harus dilakukan oleh **pemilik akun** melalui dashboard provider:

| Provider | Dashboard | Secret yang Perlu Dirotasi |
|---|---|---|
| Supabase (prod) | app.supabase.com → Project Settings → API | SERVICE_ROLE_KEY, ANON_KEY, DATABASE_URL (reset password) |
| Supabase (dev) | app.supabase.com → Project Settings → API | SERVICE_ROLE_KEY_DEV, ANON_KEY_DEV, DATABASE_URL_DEV |
| Fonnte | app.fonnte.com → API | FONNTE_TOKEN |
| Wati | app.wati.io → Settings → API | WATI_API_TOKEN |
| Resend / SMTP | resend.com → API Keys | SMTP_PASS |
| Paylabs | Dashboard Paylabs → API Keys | PAYLABS_PRIVATE_KEY, PAYLABS_PRIVATE_KEY_SANDBOX |
| GitHub | github.com → Settings → Developer settings → PAT | GITHUB_PERSONAL_ACCESS_TOKEN |
| Google Cloud | console.cloud.google.com → APIs → Credentials | GOOGLE_CLIENT_SECRET, GOOGLE_SERVICE_ACCOUNT_JSON |

## Internal Secrets (regenerate locally)

Secret berikut dapat diregenerasi tanpa akun provider:

```bash
# SESSION_SECRET (256-bit hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# CASHIER_TOKEN_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# PORTAL_JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# DRIVER_JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# PORTAL_ADMIN_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# VAPID keys (butuh web-push package)
npx web-push generate-vapid-keys
```

## Verification Status

- [ ] Semua secret ROTATION REQUIRED sudah dirotasi oleh pemilik akun
- [ ] Nilai baru sudah diinput ke Replit Secrets / env
- [ ] `pnpm run audit:secrets` dijalankan dan semua PRESENT
- [ ] API server di-restart dan berjalan normal setelah rotasi
- [ ] Tidak ada error 401/403 di log setelah rotasi

## Gate Production

Production gate (`summary.json`) **TIDAK BOLEH GO** sampai:
1. Kolom **Rotated = ✅** untuk semua baris dengan Rotation Required = YES
2. Kolom **Verified = ✅** untuk semua baris
3. `pnpm run audit:secrets` exit 0 

---

## Per-Credential 7-Step Rotation Checklist

Use `pnpm run audit:secret-rotation-status` to see current status automatically.  
Update `docs/security/secret-rotation-status.json` as each step is completed.

> **☐ = Pending · ☑ = Complete**  
> Steps: (1) New credential created · (2) Injected to Replit Secrets · (3) Smoke tested · (4) Old credential revoked · (5) Verified via audit:secrets · (6) Evidence attached · (7) Completed in status.json

| Credential | (1) Created | (2) Injected | (3) Smoke test | (4) Old revoked | (5) Verified | (6) Evidence | (7) Complete |
|---|---|---|---|---|---|---|---|
| FONNTE_TOKEN | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| WATI_API_TOKEN | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| SMTP_PASS | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| PAYLABS_PRIVATE_KEY | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| PAYLABS_PRIVATE_KEY_SANDBOX | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| CASHIER_TOKEN_SECRET | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| PORTAL_JWT_SECRET | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| DRIVER_JWT_SECRET | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| PORTAL_ADMIN_KEY | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| VAPID_PRIVATE_KEY | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| SUPABASE_SERVICE_ROLE_KEY | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| SUPABASE_SERVICE_ROLE_KEY_DEV | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| SUPABASE_DATABASE_URL | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| SUPABASE_DATABASE_URL_DEV | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| SUPABASE_ANON_KEY | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| SUPABASE_ANON_KEY_DEV | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| GITHUB_PERSONAL_ACCESS_TOKEN | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| GOOGLE_CLIENT_SECRET | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| SUPABASE_MIGRATION_URL | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

**After all 19 rows complete:**
```bash
# 1. Set verifiedByOwner and verifiedAt in status.json
# 2. Verify gate passes
pnpm run audit:secret-rotation   # exit 0 = PASS
pnpm run audit:secret-rotation-status  # all 19 complete
```
