---
name: BizPortal i18n pattern
description: BizPortal t usage is an object NOT a function — critical difference from Customer Portal
---

**CRITICAL:** BizPortal's `useLanguage()` returns `{ locale, setLocale, t, isRTL }` where
`t` is a **`Translations` object** (not a function). Usage: `t.nav.reports`, `t.common.save`.
Do NOT use `t("nav.reports")` — that causes TS2349 "This expression is not callable".

Customer Portal uses `t("key.path")` (function call).
BizPortal uses `t.section.key` (property access).

**Import:** `import { useLanguage } from "@/contexts/LanguageContext";`

**Available sections in BizPortal Translations interface:**
nav, common, welcome, dashboard, settings, pos, trading, logistics, sales, purchase,
users, notFound, accounting

**Pages migrated (BizPortal):**
- `settings/uom.tsx` — t.nav.uomSettings, t.settings.title, t.common.add/loading/name/status/noData/edit/cancel/save
- `reports/index.tsx` — t.nav.reports, t.nav.dashboard
- `reports/sales.tsx` — t.nav.salesReport, t.common.loading, t.dashboard.totalRevenue/totalOrders, t.common.noData
- `reports/purchase.tsx` — t.nav.purchaseReport, t.common.loading

**Note:** 326 BizPortal pages still have zero t() — only specific priority pages targeted per instructions.
Pre-existing TS7006 errors (implicit any in map callbacks) exist in reports pages — not from i18n work.
