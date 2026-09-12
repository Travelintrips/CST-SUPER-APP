---
name: Production DB connection
description: Why production deployment fails to connect to Supabase DB and how it was fixed.
---

# Production DB Connection Fix

## Rule
`lib/db/src/index.ts` resolves DB URL by priority. In production, it originally only checked `SUPABASE_DATABASE_URL` and `DATABASE_URL` — neither was set in the Replit deployment secrets, causing ALL DB queries to fail with "password authentication failed for user postgres" (fell back to local pg).

## Fix Applied
Added `SUPABASE_PG_URL` (from `.replit` userenv.shared) and `SUPABASE_DATABASE_URL_DEV` as fallbacks in the production candidates list. This single-DB setup uses the same Supabase instance for dev and prod.

**Why:** Only `SUPABASE_DATABASE_URL_DEV` is configured as a Replit secret; `SUPABASE_PG_URL` is set in `.replit` userenv.shared (available to deployed app). Neither was in the production lookup path.

**How to apply:** If DB fails in production with "password authentication failed", check which env vars are actually set in the deployed environment vs what lib/db checks for production mode.

## Symptoms
- All startup migrations fail with "password authentication failed for user postgres"
- Circuit breaker (ECIRCUITBREAKER) triggers and blocks all subsequent DB connections
- Google login returns {"message":"Internal Server Error"} because saveOauthState throws
- Any route requiring DB access returns 500
