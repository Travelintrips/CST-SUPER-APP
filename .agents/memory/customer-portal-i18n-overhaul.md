---
name: Customer Portal i18n overhaul
description: Full i18n system overhaul for artifacts/customer-portal — key parity across 18 locales, build-time validator, tests. Ongoing page-level migration.
---

All 18 locales in `artifacts/customer-portal/src/i18n/translations.ts` have full 394-key
structural parity with the `id-ID` baseline. 701 translation keys × 18 locales (14,412 lines).
Customer Portal sections: nav, hero, stats, about, why, cta, contact, footer, testimonials,
partners, login, register, products, jasa, services, dashboard, orders, tracking, notFound,
common, servicesMenu, homePromo, calculator, accountSecurity, registerPage, marketplace,
marketplaceDetail, catalog, trackingPage, booking, contactPage, onboarding, vendorForm,
vendorProfile.

**t() usage pattern:** `const { t } = useLanguage()` — t is a FUNCTION `t(key, fallback?)` with
dot-path lookup and en-US → id-ID fallback chain. Template substitution via `.replace("{placeholder}", value)`.

**Phase 2 — partially migrated pages — COMPLETED:**
- `dashboard.tsx` — full migration done
- `account-security.tsx` — full migration done
- `orders.tsx` — full migration done (noOrders/noOrdersDesc fix required whitespace-exact match)
- `login.tsx` — remaining strings migrated: Google button, OTP send/verify/change labels,
  WA auto-login/trusted device text, remember device checkbox, phone label. Keys used:
  `registerPage.sending/sendOtp/otpSentTo/otpLabel/otpPlaceholder/verifying/changeNumber/resendOtp/phoneLabel/rememberDevice`,
  `accountSecurity.loading/thisDevice`, `login.signIn`.
- `contact.tsx` — REWRITTEN: file had duplicate tags from a partial migration (both contactPage.*
  and old contact.* keys in same JSX), causing TS17008 unclosed `<p>`. Fixed by keeping only
  contactPage.* keys with inline fallbacks.

**Phase 3 — zero-t() pages connected:**
- `marketplace.tsx` — added `useLanguage` import; `StockBadge` uses `t("marketplace.statusAvailable/statusLimited/statusOutOfStock/statusPreOrder")`; `FilterSidebar` uses `t("marketplace.searchPlaceholder")`.
  Note: hero uses `EditableText` (CMS-driven), CATEGORY_TABS "Semua Produk" is top-level const (no hook).

**Validator:** `pnpm run validate:i18n` + unit tests in `src/i18n/__tests__/`.
**Why AST-parse:** duplicate object-key detection can't happen on built object — use
`scripts/validate-translations.mjs` with `@babel/parser` to catch collisions before silent overwrite.

**Remaining in Customer Portal:** calculator.tsx (76+ hardcoded strings, large effort),
home.tsx SERVICE_GROUPS_HOME titles, remaining zero-t() pages (booking, catalog, jasa, etc.)
