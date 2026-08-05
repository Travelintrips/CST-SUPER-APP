---
name: i18n translation merge — duplicate top-level key bug
description: How adding new sections to an existing locale object in translations.ts can silently create a second top-level key with the same name, breaking the TS build.
---

When adding newly-translated sections (e.g. `nav`, `footer`, `servicesMenu`) to an existing locale entry in `artifacts/customer-portal/src/i18n/translations.ts`, always merge new sub-keys INTO the existing top-level key block for that locale. Appending a second `nav: { ... }` (or any other repeated key) inside the same locale object literal is valid JS at runtime (the second silently overwrites the first) but is a TypeScript compile error (TS1117 "duplicate property"), and can also silently drop translations that were only in the first block if the second is incomplete.

**Why:** happened across zh-CN/zh-TW/ja-JP/ko-KR after a translation batch job appended whole new sections as duplicate keys instead of merging; broke `tsc --noEmit` with 8 TS1117 errors until fixed.

**How to apply:** before adding keys to any locale, grep for the target top-level key name within that locale's line range first — if it already exists, insert new sub-keys into that block; never add a second declaration. After any translation batch, run `npx tsc --noEmit -p .` in `artifacts/customer-portal` and confirm zero TS1117 errors, plus a node/ts-based leaf-key parity check against en-US (all locales should show the same total, currently 394).
