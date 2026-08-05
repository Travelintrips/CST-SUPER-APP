---
name: devportal token security
description: devportal.* token must always be verified via verifyDevPortalEmail() — never decoded inline. Inline base64 decode has no HMAC and allows email forgery.
---

# devportal Token Security Rule

## The Rule
All `devportal.*` token handling in route files MUST use `verifyDevPortalEmail(token)` from `../lib/supabaseAuth`.
Never do inline `Buffer.from(parts[1], "base64url")` decode of a devportal token in route handlers.

**Why:** Inline decode has zero signature verification. An attacker sends `devportal.<base64({"email":"victim@corp.com"})>.fakesig` and gets the victim's portal customer linked to their quote/order. This works in PRODUCTION (no IS_PROD guard on inline path).

**How to apply:** Import `verifyDevPortalEmail` from `supabaseAuth`, use it before `verifyPortalJwt` in the auth chain. It returns `null` in production (IS_PROD=true) and on bad/missing HMAC signature.

## Where Fixed
- `artifacts/api-server/src/routes/portal.ts` — `POST /marketplace/:id/quote`
- `artifacts/api-server/src/routes/portalProductOrders.ts` — order creation endpoint

## Central Verification Logic
`artifacts/api-server/src/lib/supabaseAuth.ts`:
- `verifyDevToken(token)` — internal, returns full payload with HMAC check + IS_PROD guard
- `verifyDevPortalEmail(token)` — exported helper, returns email string or null

## Scan Command (CI guard)
```bash
grep -rn "devportal\." artifacts/api-server/src/routes/ | grep -v "verifyDevPortalEmail\|// " | grep "base64\|startsWith"
```
Any hit = new unsafe inline decode. Should return empty.
