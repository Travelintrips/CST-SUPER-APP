# Customer Portal Asset Release Procedure

## Storage contract

Customer Portal static application assets use the Supabase Storage `public-assets`
bucket under:

```text
portal-assets/static/customer-portal/
```

Raster source names (`.png`, `.jpg`, `.jpeg`) are released as derived `.webp`
objects. The checked-in manifest at
`docs/customer-portal-static-assets.json` is generated from Customer Portal
source usage and records object identity only; it contains no credentials.

Customer Portal CMS/user-uploaded media is runtime data and is deliberately not
part of the static manifest.

## CMS assets

An admin upload follows the environment in which the admin is working:

```text
Development CMS → Supabase development
Production CMS  → Supabase production
```

There is no automatic DEV → PROD sync for CMS uploads. Development drafts and
experiments must not become production content implicitly. The API resolves
storage credentials from explicit `APP_ENV`; production never falls back to a
development credential.

## Static application assets

Generate/update the manifest after an approved source change:

```bash
pnpm assets:customer:manifest
```

Verify a single environment through the normal secret loader. The command
checks HTTP status, image MIME, non-empty body, and rejects HTML/JSON
fallbacks:

```bash
APP_ENV=development node artifacts/api-server/load-secrets.mjs \
  node artifacts/api-server/scripts/customer-portal-assets.mjs verify \
  --env development --base-url http://127.0.0.1:23434

APP_ENV=production node artifacts/api-server/load-secrets.mjs \
  node artifacts/api-server/scripts/customer-portal-assets.mjs verify \
  --env production --base-url https://<production-domain>
```

CMS reference verification is performed when `--base-url` (or
`CUSTOMER_PORTAL_BASE_URL`) is supplied. It reads `id-ID` and `en-US`, resolves
media URLs, checks the image response, and reports missing objects as
`STALE STORAGE REFERENCE`. Global visual media remains shared across locales;
text remains locale-specific.

## Controlled promotion

Promotion is scoped to the approved Customer Portal manifest, never the whole
bucket, and never uses `sync --delete`. It compares SHA-256 content and MIME,
copies only missing/outdated expected objects, verifies each copy, and is
idempotent:

```bash
# Safe default: no write. Run with the production secret bundle so the
# canonical destination credentials cannot be confused with development.
APP_ENV=production pnpm assets:customer:promote

# Explicit production write, only after reviewing the dry-run
APP_ENV=production CUSTOMER_PORTAL_ASSET_WRITE_ACK=I_UNDERSTAND \
  node artifacts/api-server/scripts/customer-portal-assets.mjs promote \
  --source development --destination production --write
```

Dry-run output includes `would-copy`, `already-present`, `missing-source`, and
`invalid-mime`. The production write additionally requires the explicit
acknowledgement environment variable and `--write`.

When the environment-specific secret bundles intentionally isolate DEV and PROD
credentials, use the staged scoped flow for a small approved asset set. The
development loader downloads only the approved manifest paths to a temporary
staging directory; the production loader then performs the dry-run/write from
that staging directory. No credential is copied between environments:

```bash
cat >/tmp/customer-portal-ppjk-paths.json <<'JSON'
[
  "portal-assets/static/customer-portal/images/customs.webp",
  "portal-assets/static/customer-portal/images/customs-document.webp"
]
JSON

APP_ENV=development node artifacts/api-server/load-secrets.mjs \
  node artifacts/api-server/scripts/customer-portal-assets.mjs stage \
  --env development \
  --paths-file /tmp/customer-portal-ppjk-paths.json \
  --stage-dir /tmp/customer-portal-ppjk-stage

APP_ENV=production node artifacts/api-server/load-secrets.mjs \
  node artifacts/api-server/scripts/customer-portal-assets.mjs promote \
  --staged-dir /tmp/customer-portal-ppjk-stage --dry-run
```

## Release gate

```text
build
→ tests
→ generate/inspect Customer Portal manifest
→ development storage verification
→ production storage dry-run
→ controlled promotion, only if approved
→ production storage verification
→ deploy
→ live CMS/image verification
```

Do not certify release when any expected production object is missing or
invalid. Do not delete orphan storage objects automatically. A storage object
without a current CMS reference may be historical, a rollback asset, or a
future asset.