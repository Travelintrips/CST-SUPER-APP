---
name: Supabase project credentials
description: Supabase project ref, pooler host, and credential management notes.
---

## Project
- **Ref:** `nzdweipzckfszczzqtuw`
- **Pooler host:** `aws-1-ap-southeast-2.pooler.supabase.com:6543` (transaction mode)
- **User:** `postgres.nzdweipzckfszczzqtuw`
- **DB:** `postgres`

## Env var
`SUPABASE_DATABASE_URL` is stored in both `development` and `production` environments (not `shared`). Both must be updated together when password changes.

## Password history (do NOT store actual passwords here — this is a reminder only)
Multiple incorrect passwords were tried before getting the right one from Supabase Dashboard → Project Settings → Database → Connection String URI. Always get the full URI from that page.

## Correct URL format
`postgresql://postgres.<ref>:<password>@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres`

Password must NOT be URL-encoded in the env var — the `pg` Node.js driver handles it correctly as a raw connection string.

**Why:** URL-encoding special chars in the password (e.g. `%24` for `$`) then having the URL class double-decode caused auth failures even with correct credentials.

## How to apply
When DB auth fails: always get fresh URI from Supabase dashboard rather than guessing password. After updating, `rm -f /tmp/db-startup-cb.json` and restart api-server.
