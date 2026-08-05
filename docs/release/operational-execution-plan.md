# Operational Execution Plan — Production GO

**Date:** 2026-07-24  
**Classification:** Owner-facing precision guide  
**Verdict (current):** PRODUCTION — **NO-GO**  
**Authority:** This document supersedes the simplified path-to-GO descriptions in prior reports.

> **IMPORTANT:** Injecting `TEST_DATABASE_URL` and running `audit:customer-production` is a necessary
> condition for GO — but it is not sufficient. GO requires all 12 gate conditions to pass independently.
> HTTP E2E itself contains 17 acceptance sub-criteria, each of which must pass individually.
>
> Code changes may still be required if the dedicated staging HTTP E2E uncovers defects.

---

## Phase 1 — Corrected GO Requirements

GO is only valid when **all** of the following conditions are simultaneously PASS in `summary.json`:

| # | Gate condition | `summary.json` key | Current status |
|---|---|---|---|
| 1 | Static gate (build + typecheck + 917 tests) | `static` | ✅ PASS |
| 2 | Runtime SAFE DEV (DB connected, workers running) | `runtimeSafeDev` | ✅ PASS |
| 3 | Secret availability (all secrets present, non-placeholder) | `secretAvailability` | ✅ PASS |
| 4 | Secret rotation (all 19 credentials rotated + revoked + verified) | `secretRotation` | ⛔ INCOMPLETE |
| 5 | Dedicated test target (`TEST_DATABASE_URL` or `STAGING_DATABASE_URL`) | `dedicatedTarget` | ⛔ BLOCKED |
| 6 | Full HTTP E2E (all 17 sub-criteria pass against dedicated target) | `httpE2E` | ⛔ BLOCKED |
| 7 | Tenant isolation (cross-company data proof via HTTP) | `tenantIsolation` | ⛔ BLOCKED |
| 8 | Security (auth + RBAC + token proof via HTTP) | `security` | ⛔ BLOCKED |
| 9 | Accounting (journal immutability + period lock proof via HTTP) | `accounting` | ⛔ BLOCKED |
| 10 | SSE real-time tracking (event stream proof via HTTP) | `sse` | ⛔ BLOCKED |
| 11 | Cleanup (synthetic record deletion verified after E2E run) | `cleanup` | ⛔ BLOCKED |
| 12 | Production gate exits 0 | `production` | ⛔ NO-GO |

**None of conditions 4–12 can be bypassed, skipped, or inferred from other conditions.**

---

## Phase 2 — Secret Rotation Execution Order

Rotate in the sequence below to minimize cascading failures. Complete each group fully before proceeding to the next.

**For each credential in this section, the status in `docs/security/secret-rotation-status.json` must be updated only after:**
- `rotated: true` — new credential created and injected
- `oldCredentialRevoked: true` — old credential deleted/revoked at provider
- `verified: true` — smoke test confirms the new credential works

`verifiedByOwner: true` at the top level is set only after all 19 individual credentials meet all three conditions.

---

### Group 1 — Internal Auth Secrets (no external provider)

**Provider:** Generated locally (`openssl rand -hex 64`)

| # | Credential | Key name | Env | Min length |
|---|---|---|---|---|
| 1 | Express session | `SESSION_SECRET` | dev + prod | 64 hex chars |
| 2 | Customer/vendor portal JWT | `PORTAL_JWT_SECRET` | dev + prod | 64 hex chars |
| 3 | Driver app JWT | `DRIVER_JWT_SECRET` | dev + prod | 64 hex chars |
| 4 | POS cashier token | `CASHIER_TOKEN_SECRET` | dev + prod | 64 hex chars |
| 5 | Admin API key | `PORTAL_ADMIN_KEY` | dev + prod | 64 hex chars |
| 6 | VAPID push private key | `VAPID_PRIVATE_KEY` | dev + prod | ECDSA P-256 |

**Per-credential steps (repeat for each of the 6 above):**

| Step | Action |
|---|---|
| Create new | `openssl rand -hex 64` (or `npx web-push generate-vapid-keys` for VAPID) |
| Inject new | Replit Secrets panel → update key in both development and production stores |
| Smoke test | `curl -sf http://127.0.0.1:18444/api/health \| jq .status` → `"ok"` |
| Revoke old | Not applicable — internally generated; old value is simply overwritten |
| Verify | `pnpm run audit:secrets` → key shows PRESENT, not INVALID |
| Rollback | Generate another new value immediately; restore is not possible |

**Impact warnings:**
- `SESSION_SECRET` rotation: all active browser sessions invalidated — users must re-login
- `PORTAL_JWT_SECRET` / `DRIVER_JWT_SECRET` rotation: all issued JWTs invalidated immediately — mobile users must re-authenticate
- `CASHIER_TOKEN_SECRET` rotation: all active POS cashier tokens invalidated

---

### Group 2 — Development Supabase Credentials

**Provider:** [app.supabase.com](https://app.supabase.com) → project `xssrfshdrtdfupgqwfdw`

| # | Credential | Key name | Env |
|---|---|---|---|
| 7 | Dev DB pooler URL | `SUPABASE_DATABASE_URL_DEV` | dev only |
| 8 | Dev service-role JWT | `SUPABASE_SERVICE_ROLE_KEY_DEV` | dev only |
| 9 | Dev anon JWT | `SUPABASE_ANON_KEY_DEV` | dev only |

**Per-credential steps:**

| Step | Action |
|---|---|
| Create new | Supabase Dashboard → project `xssrfshdrtdfupgqwfdw` → Settings → API → Regenerate service role key |
| Inject new | Replit Secrets → `SUPABASE_SERVICE_ROLE_KEY_DEV`, `SUPABASE_ANON_KEY_DEV`; for DB URL → Settings → Database → reset password → copy new pooler URL |
| Smoke test | `pnpm run audit:customer-runtime` → DB connection shows PASS |
| Revoke old | Supabase invalidates old JWTs immediately upon regeneration — no separate revoke step |
| Verify | `pnpm run audit:secrets` → all `*_DEV` keys show PRESENT |
| Rollback | Immediately re-rotate at Supabase; update Replit Secrets with newest key |

---

### Group 3 — Production Supabase Credentials

**Provider:** [app.supabase.com](https://app.supabase.com) → project `nzdweipzckfszczzqtuw`

> Rotate AFTER dev credentials are confirmed working to avoid downtime.

| # | Credential | Key name | Env |
|---|---|---|---|
| 10 | Prod DB pooler URL | `SUPABASE_DATABASE_URL` | prod |
| 11 | Prod service-role JWT | `SUPABASE_SERVICE_ROLE_KEY` | prod |
| 12 | Prod anon JWT | `SUPABASE_ANON_KEY` | prod |
| 13 | Prod direct migration URL | `SUPABASE_MIGRATION_URL` | prod (migration scripts only) |

**Per-credential steps:**

| Step | Action |
|---|---|
| Create new | Supabase Dashboard → project `nzdweipzckfszczzqtuw` → Settings → API → Regenerate; for DB URL → Settings → Database → reset password |
| Inject new | Replit Secrets → update `SUPABASE_DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_MIGRATION_URL` in **both** development and production secret stores |
| Smoke test | `curl -sf http://127.0.0.1:18444/api/health \| jq '{status,db}'` → `{"status":"ok","db":"connected"}` |
| Revoke old | Supabase invalidates old JWTs immediately; old DB password is invalidated when reset |
| Verify | `pnpm run audit:secrets` → all prod Supabase keys PRESENT; `pnpm run audit:customer-runtime` PASS |
| Rollback | Immediately re-rotate; do not attempt to restore old credentials |

---

### Group 4 — Messaging: Fonnte

**Provider:** [app.fonnte.com](https://app.fonnte.com)

| # | Credential | Key name | Env | Min length |
|---|---|---|---|---|
| 14 | Fonnte API token | `FONNTE_TOKEN` | dev + prod | 16 chars |

| Step | Action |
|---|---|
| Create new | Fonnte Dashboard → API → Regenerate token |
| Inject new | Replit Secrets → `FONNTE_TOKEN` in both dev and prod stores |
| Smoke test | `curl -s https://api.fonnte.com/validate -H "Authorization: $FONNTE_TOKEN" \| jq .status` → `"true"` |
| Revoke old | Fonnte invalidates old token upon regeneration |
| Verify | `pnpm run audit:secrets` → `FONNTE_TOKEN` PRESENT; smoke test returns `"true"` |
| Rollback | Regenerate again immediately |

---

### Group 5 — Messaging: WATI

**Provider:** [app.wati.io](https://app.wati.io)

| # | Credential | Key name | Env | Min length |
|---|---|---|---|---|
| 15 | WATI API token | `WATI_API_TOKEN` | dev + prod | 32 chars |

| Step | Action |
|---|---|
| Create new | WATI Dashboard → Settings → API → Regenerate access token |
| Inject new | Replit Secrets → `WATI_API_TOKEN` in both stores; confirm `WATI_BASE_URL` unchanged |
| Smoke test | `curl -s "$WATI_BASE_URL/api/v1/getContacts?pageSize=1" -H "Authorization: Bearer $WATI_API_TOKEN" \| jq .result` → HTTP 200, not 401 |
| Revoke old | WATI invalidates old token upon regeneration |
| Verify | `pnpm run audit:secrets` → PRESENT; smoke test HTTP 200 |
| Rollback | Regenerate again immediately |

---

### Group 6 — SMTP

**Provider:** SMTP provider dashboard (e.g., SendGrid, Mailgun, Mailtrap)

| # | Credential | Key name | Env |
|---|---|---|---|
| 16 | SMTP password / API key | `SMTP_PASS` | dev + prod |

| Step | Action |
|---|---|
| Create new | SMTP provider dashboard → generate new API key or password |
| Inject new | Replit Secrets → `SMTP_PASS` in both stores |
| Smoke test | `node -e "const nm=require('nodemailer'); nm.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT),auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}).verify((_,ok)=>console.log(ok?'OK':_))"` → `OK` |
| Revoke old | SMTP provider dashboard → delete old API key |
| Verify | `pnpm run audit:secrets` → PRESENT; `verify()` returns OK |
| Rollback | Generate new key immediately; if email delivery broken check provider quota/block |

---

### Group 7 — Payment Sandbox (Paylabs)

**Provider:** Paylabs merchant dashboard

| # | Credential | Key name | Env |
|---|---|---|---|
| 17 | Paylabs sandbox private key | `PAYLABS_PRIVATE_KEY_SANDBOX` | dev only |

| Step | Action |
|---|---|
| Create new | Paylabs Dashboard → API Keys → generate new RSA key pair for sandbox |
| Inject new | Replit Secrets → `PAYLABS_PRIVATE_KEY_SANDBOX` (full PEM block) |
| Smoke test | Trigger a sandbox payment flow in Customer Portal → verify signature validation in API logs: `[paylabs] signature OK` |
| Revoke old | Paylabs Dashboard → delete old public key |
| Verify | `pnpm run audit:secrets` → PRESENT; sandbox payment flow completes |
| Rollback | Re-upload old public key to Paylabs if new key rejected; restore old private key in Replit Secrets |

---

### Group 8 — Payment Production (Paylabs)

**Provider:** Paylabs merchant dashboard

> Rotate production payment keys only after sandbox is confirmed working.

| # | Credential | Key name | Env |
|---|---|---|---|
| 18 | Paylabs production private key | `PAYLABS_PRIVATE_KEY` | prod |

| Step | Action |
|---|---|
| Create new | Paylabs Dashboard → API Keys → generate new RSA key pair for production |
| Inject new | Replit Secrets → `PAYLABS_PRIVATE_KEY` (full PEM block) in production secrets store |
| Smoke test | Confirm Paylabs production webhook callback processes: `[paylabs] signature OK` in prod logs |
| Revoke old | Paylabs Dashboard → delete old production public key |
| Verify | At least one live payment callback processed successfully after rotation |
| Rollback | Re-upload old production public key; restore old private key; alert Paylabs support if live transactions affected |

---

### Group 9 — OpenAI

**Provider:** [platform.openai.com](https://platform.openai.com)

| # | Credential | Key name | Env |
|---|---|---|---|
| 19 | OpenAI API key | `OPENAI_API_KEY` | dev + prod |

| Step | Action |
|---|---|
| Create new | OpenAI Dashboard → API Keys → Create new secret key → copy immediately (shown once) |
| Inject new | Replit Secrets → `OPENAI_API_KEY`; confirm `OPENAI_BASE_URL=https://api.openai.com/v1` (not localhost proxy) |
| Smoke test | `curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY" \| jq '.data \| length'` → positive integer |
| Revoke old | OpenAI Dashboard → API Keys → delete old key |
| Verify | `pnpm run audit:secrets` → PRESENT; model list API returns data |
| Rollback | Generate new key immediately; AI feature failure is non-critical (degrades gracefully) |

---

### Group 10 — Google OAuth & Service Account

**Provider:** [console.cloud.google.com](https://console.cloud.google.com) → project `cst-super-app`

| # | Credential | Key name | Env |
|---|---|---|---|
| 20 | Google OAuth client secret | `GOOGLE_CLIENT_SECRET` | dev + prod |
| 21 | Google service account JSON | `GOOGLE_SERVICE_ACCOUNT_JSON` | dev + prod |

Note: credentials 20 and 21 are not in the `secret-rotation-status.json` 19-count but are in the checklist. Verify the JSON file and add if missing.

**Google OAuth Client Secret:**

| Step | Action |
|---|---|
| Create new | GCP Console → APIs & Services → Credentials → OAuth 2.0 Client ID → Reset Secret |
| Inject new | Replit Secrets → `GOOGLE_CLIENT_SECRET`; verify `GOOGLE_REDIRECT_BASE_URL` matches deployment domain |
| Smoke test | Complete a Google OAuth login flow in Customer Portal → session established |
| Revoke old | Deleting the old client secret via Reset is automatic; optionally delete and recreate the OAuth client |
| Verify | OAuth login works end-to-end |
| Rollback | Create new OAuth client if reset fails; update redirect URIs |

**Google Service Account JSON:**

| Step | Action |
|---|---|
| Create new | GCP Console → Service Accounts → `sheet-customer@...` → Keys → Add Key → JSON → download |
| Inject new | Replit Secrets → `GOOGLE_SERVICE_ACCOUNT_JSON` (minified JSON, full content) |
| Smoke test | Trigger a Google Sheets sync from BizPortal → data updated in sheet |
| Revoke old | GCP Console → Service Accounts → Keys → select old key ID → Delete |
| Verify | Sheet sync succeeds without 401 |
| Rollback | Create another new key immediately; old key cannot be restored after deletion |

---

### Group 11 — GitHub

**Provider:** github.com → Settings → Developer settings → Personal access tokens

| # | Credential | Key name | Env |
|---|---|---|---|
| 22 | GitHub personal access token | `GITHUB_PERSONAL_ACCESS_TOKEN` | dev only |

| Step | Action |
|---|---|
| Create new | GitHub → Settings → Developer settings → Personal access tokens → Generate new (Fine-grained, repo scope only) |
| Inject new | Replit Secrets → `GITHUB_PERSONAL_ACCESS_TOKEN` |
| Smoke test | `curl -s -H "Authorization: Bearer $GITHUB_PERSONAL_ACCESS_TOKEN" https://api.github.com/user \| jq .login` → GitHub username |
| Revoke old | GitHub → Personal access tokens → delete old token |
| Verify | `pnpm run audit:secrets` → PRESENT; API call returns username |
| Rollback | Generate new token immediately; old token cannot be restored |

---

## Phase 3 — Staging Provisioning Checklist

Complete in this exact order. Do not proceed to the next step if the current step fails.

| # | Step | Command / Action | Pass Criteria |
|---|---|---|---|
| 1 | Create dedicated Supabase staging project | app.supabase.com → New Project → name: `cst-super-app-staging`, region: ap-southeast-2 | Project shows Online status |
| 2 | Create dedicated database credentials | Settings → API (copy service role, anon keys); Settings → Database → copy pooler URL (port 6543) and direct URL (port 5432) | All 4 values copied |
| 3 | Apply all migrations | `SUPABASE_MIGRATION_URL=<staging-direct> pnpm run db:migrate:test` | Exit 0; no SQL errors |
| 4 | Verify migration parity | `psql "$TEST_DATABASE_URL" -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'"` | Count matches production table count |
| 5 | Create staging storage buckets | Supabase → Storage → New Bucket → `attachments-staging`, private, same size limit as prod | Bucket visible in dashboard |
| 6 | Configure staging auth | Settings → Auth → Site URL = staging API URL; no production OAuth redirect URIs | Auth config saved |
| 7 | Seed synthetic-only fixtures | `TEST_DATABASE_URL=<staging> node scripts/seed-staging.mjs` (when available; see note below) | Root company + admin user rows exist |
| 8 | Configure payment sandbox | Confirm `PAYLABS_PRIVATE_KEY_SANDBOX` is set for staging (not production key) | `pnpm run audit:secrets` shows PRESENT |
| 9 | Disable real WA/email outbound | Set `E2E_TEST_MODE=true` in API server env — this suppresses Fonnte/WATI/SMTP delivery | `/api/e2e-safety` returns `{"e2eTestMode":true}` |
| 10 | Inject `TEST_*` variables | Replit Secrets → add `TEST_DATABASE_URL`, `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, `TEST_SUPABASE_ANON_KEY`, `TEST_STORAGE_BUCKET` | `pnpm run audit:secrets` shows all TEST_* PRESENT |
| 11 | Run staging health checks | `psql "$TEST_DATABASE_URL" -c "SELECT 1"` + `curl -sf http://127.0.0.1:18444/api/health \| jq .` | DB responds; API shows `status:ok` |
| 12 | Verify target is NOT production or dev | `node -e "const u=process.env.TEST_DATABASE_URL; if(u.includes('nzdweipzckfszczzqtuw')\|\|u.includes('xssrfshdrtdfupgqwfdw')) throw new Error('WRONG TARGET'); console.log('OK')"` | Prints `OK` — must not match prod or dev project ref |

> **Note on Step 7:** `scripts/seed-staging.mjs` is not yet created. The E2E harness creates its own synthetic
> records at runtime using `RUNTIME_TEST_RUN_ID`. However, it requires a root company and admin user to
> exist before it can run. If the harness fails with "company not found", create a minimal seed script or
> manually insert the required fixture rows.

---

## Phase 4 — Post-Provision Command Execution Order

Run these commands in exact order. Do not proceed to the next command if the previous fails.

### Command 1 — Secret Availability

```bash
pnpm run audit:secrets
# alias: pnpm run audit:secret-availability
```

| Attribute | Value |
|---|---|
| Expected exit code | `0` |
| Expected output | `PRESENT: N | MISSING: 0 | INVALID: 0` |
| `summary.json` key | `secretAvailability: "PASS"` |
| Artifact | Console output |
| Failure condition | Any secret shows MISSING or INVALID → inject/correct the affected secret then re-run |

---

### Command 2 — Secret Rotation

```bash
pnpm run audit:secret-rotation
```

| Attribute | Value |
|---|---|
| Expected exit code | `0` |
| Expected output | `All credentials verified: rotated=true, oldCredentialRevoked=true, verified=true` |
| `summary.json` key | `secretRotation: "PASS"` |
| Artifact | `docs/security/secret-rotation-status.json` (all entries `verified: true`) |
| Failure condition | Any credential has `rotated: false` or `verified: false` → complete rotation for that credential and update the JSON |

---

### Command 3 — Static Gate

```bash
pnpm run audit:customer-static
```

| Attribute | Value |
|---|---|
| Expected exit code | `0` |
| Expected output | `917/917 tests pass`, `tsc: no errors`, `build: success` for all 4 packages |
| `summary.json` key | `static: "PASS"` |
| Artifact | Build artifacts in each package `dist/` directory |
| Failure condition | Any typecheck error, test failure, or build error → investigate and fix before continuing |

---

### Command 4 — Runtime

```bash
pnpm run audit:customer-runtime
```

| Attribute | Value |
|---|---|
| Expected exit code | `0` |
| Expected output | `SAFE DEV TEST MODE` + all 12 health checks pass |
| `summary.json` key | `runtimeSafeDev: "PASS"` |
| Artifact | Console output; API server must be running before this command |
| Failure condition | DB connection refused (check Supabase credentials) or worker startup failure → review API server logs |

---

### Command 5 — HTTP E2E

```bash
TEST_DATABASE_URL=<staging-url> \
E2E_TEST_MODE=true \
RUNTIME_TEST_RUN_ID="rc-$(date +%Y%m%d-%H%M%S)" \
pnpm run audit:customer-http-e2e
```

| Attribute | Value |
|---|---|
| Expected exit code | `0` |
| Expected output | All 17 sub-criteria: PASS |
| `summary.json` keys | `httpE2E`, `tenantIsolation`, `security`, `accounting`, `sse`, `cleanup` → all `"PASS"` |
| Artifact | Detailed JSON result in console; `summary.json` updated |
| Failure (exit 2) | `TEST_DATABASE_URL` not set — set it and re-run |
| Failure (exit 3) | API server not reachable or not in E2E mode — start API server with `E2E_TEST_MODE=true` |
| Failure (exit 1) | One or more sub-criteria failed — see console output for which phase failed; fix defect; **code change may be required** |

---

### Command 6 — Production Gate

```bash
TEST_DATABASE_URL=<staging-url> \
E2E_TEST_MODE=true \
pnpm run audit:customer-production
```

| Attribute | Value |
|---|---|
| Expected exit code | `0` |
| Expected final line | `[production] GO` |
| `summary.json` key | `production: "GO"` |
| Artifact | `summary.json` with all 12 fields PASS; final `GO` verdict |
| Failure | Any sub-gate failed → see which gate failed in output; address root cause; re-run from that sub-gate |

---

## Phase 5 — HTTP E2E Acceptance Matrix

HTTP E2E is only marked PASS when **all 17** of the following sub-criteria pass. No partial PASS is accepted.

| # | Sub-criterion | What is verified | HTTP-only? |
|---|---|---|---|
| 1 | Customer login | JWT issued on POST `/api/auth/login` with valid credentials; invalid credentials return 401 | ✅ HTTP |
| 2 | Order creation | POST `/api/trucking/bookings` creates booking record; returns `bookingNumber`; status = `pending` | ✅ HTTP |
| 3 | Quotation | POST `/api/vendor-trucking-pricing/public-estimate` returns `has_data: true` with pricing breakdown | ✅ HTTP |
| 4 | Admin approval | POST `/api/admin/bookings/:id/approve` transitions status to `approved`; 403 if not admin | ✅ HTTP |
| 5 | Vendor assignment | POST `/api/admin/bookings/:id/assign-vendor` assigns vendor; vendor receives notification record | ✅ HTTP |
| 6 | Operational status | GET `/api/trucking/bookings/:id` shows updated status after each lifecycle transition | ✅ HTTP |
| 7 | Tracking | GET `/api/tracking/:bookingId` returns current position or status for the booking | ✅ HTTP |
| 8 | SSE event | GET `/api/sse/booking/:id` stream receives at least one event within timeout; stream closes cleanly | ✅ HTTP |
| 9 | Invoice | POST `/api/admin/invoices` generates invoice tied to booking; GET returns invoice record | ✅ HTTP |
| 10 | Sandbox payment | POST to payment initiation endpoint returns valid Paylabs sandbox redirect or token | ✅ HTTP |
| 11 | Payment callback idempotency | POST same payment callback twice → second call returns 200 without creating duplicate journal entry | ✅ HTTP |
| 12 | Payment allocation | GET `/api/bank-reconciliation/allocations` shows allocation record for the payment | ✅ HTTP |
| 13 | Balanced journal | SQL verification: `SELECT SUM(debit_amount) - SUM(credit_amount) FROM accounting_entries WHERE ref LIKE 'TEST-%'` = 0 | SQL read-only |
| 14 | Tenant isolation | Company A's JWT cannot access Company B's bookings → 403 or 404 on cross-tenant GET | ✅ HTTP |
| 15 | Auth security | Expired token → 401; tampered token → 401; missing token on protected route → 401 | ✅ HTTP |
| 16 | Concurrent idempotent request | Same booking creation request sent 3× concurrently → exactly 1 booking created (check DB count) | ✅ HTTP + SQL verify |
| 17 | Cleanup | All synthetic records tagged with `RUNTIME_TEST_RUN_ID` are deleted; DB count = 0 for run ID prefix | SQL verify |

**SQL is only permitted for sub-criteria 13, 16 (count verification), and 17 (cleanup verification).**  
**Business flows must run through HTTP exclusively.**

---

## Phase 6 — Corrected Wording

### Correction 1 — Code changes

**Incorrect (do not use):**
> "Tidak ada perubahan kode yang diperlukan."  
> "No code changes required."

**Correct wording:**
> Belum ada perubahan kode tambahan yang diketahui. Perubahan kode masih mungkin diperlukan apabila dedicated staging HTTP E2E menemukan defect.

### Correction 2 — Time estimate

**Incorrect (do not use):**
> "Estimasi waktu: ~3 jam"  
> "Total estimated time to GO (no code changes required): ~3 hours"

**Correct wording:**
> Estimasi kasar tanpa jaminan: ~3 jam untuk pekerjaan infrastruktur dan rotasi secret saja, **tidak termasuk** waktu investigasi dan perbaikan apabila HTTP E2E menemukan defect.

### Correction 3 — Simplified path to GO

**Incorrect (do not use):**
> "Step 8 — Run: pnpm run audit:customer-production → Step 9 — Read final line: [production] GO"

**Correct:**
> GO requires all 12 gate conditions to individually pass (see Phase 1 table above). Running `audit:customer-production` is the final verification — it does not produce GO unless all 12 conditions are independently confirmed PASS. HTTP E2E alone contains 17 sub-criteria.

---

## Phase 7 — Final Output

### Documents corrected or created

| Document | Action | Correction applied |
|---|---|---|
| `docs/release/operational-execution-plan.md` | ✅ Created (this file) | Authoritative corrected plan |
| `docs/release/go-live-remediation-final-report.md` | ✅ Corrected | Removed "no code changes required"; corrected path-to-GO; marked time estimate as kasar |
| `docs/release/release-readiness.md` | ✅ Corrected | Removed "~3 hours" time estimate; corrected GO conditions to list all 12 |

### Secret rotation order (summary)

1. Internal auth secrets (SESSION, JWT, CASHIER, ADMIN, VAPID)
2. Dev Supabase (URL_DEV, SERVICE_ROLE_DEV, ANON_DEV)
3. Prod Supabase (URL, SERVICE_ROLE, ANON, MIGRATION_URL)
4. Fonnte
5. WATI
6. SMTP
7. Paylabs sandbox
8. Paylabs production
9. OpenAI
10. Google (OAuth + Service Account)
11. GitHub

### Staging provisioning order (summary)

1 → Create project · 2 → Credentials · 3 → Migrations · 4 → Verify parity · 5 → Storage · 6 → Auth config · 7 → Seed · 8 → Payment sandbox · 9 → Disable outbound (E2E_TEST_MODE) · 10 → Inject TEST_* vars · 11 → Health checks · 12 → Verify not prod/dev

### Command execution order

```
pnpm run audit:secrets
  → pnpm run audit:secret-rotation
    → pnpm run audit:customer-static
      → pnpm run audit:customer-runtime
        → pnpm run audit:customer-http-e2e   (requires TEST_DATABASE_URL + E2E_TEST_MODE=true)
          → pnpm run audit:customer-production
            → GO only if all 12 gate conditions PASS
```

### GO acceptance criteria (all must be true simultaneously)

`static` PASS + `runtimeSafeDev` PASS + `secretAvailability` PASS + `secretRotation` PASS + `dedicatedTarget` PASS + `httpE2E` PASS + `tenantIsolation` PASS + `security` PASS + `accounting` PASS + `sse` PASS + `cleanup` PASS + `production` exit 0 = **GO**

Any single condition FAIL or BLOCKED = **NO-GO**

### Remaining operational blockers

| # | Blocker | What unblocks it | Code change possible? |
|---|---|---|---|
| B1 | Secret rotation incomplete — 19 credentials, all `rotated: false` | Account owner completes rotation per Phase 2 above | No |
| B2 | Dedicated staging target not configured | DevOps provisions Supabase staging project per Phase 3 above | No |
| B3 | HTTP E2E not executed — 17 sub-criteria unverified | Unblocked when B2 resolved; may reveal defects requiring code fixes | **Yes — defects may require code changes** |
| B4 | seed-staging.mjs not created | Create minimal seed script if E2E harness cannot self-seed | Yes (small script) |

---

## Current Verdict

```
PRODUCTION: NO-GO

Reasons:
  • Secret rotation incomplete (19 credentials, verifiedByOwner: false)
  • Dedicated staging target not configured (TEST_DATABASE_URL unset)
  • Full HTTP E2E BLOCKED — 17 acceptance sub-criteria unverified
  • Tenant isolation, security, accounting, SSE, cleanup all BLOCKED

This verdict is correct and must not be altered until all 12 gate conditions are PASS.
```
