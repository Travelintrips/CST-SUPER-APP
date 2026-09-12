---
name: Portal CMS media locale contract
description: CMS portal images are global assets, while text overrides remain language-specific.
---

Portal CMS media such as the homepage hero must resolve across visitor locales.
The CMS stores text overrides per locale, but uploaded images and other shared
branding assets use the default locale as their canonical record and are
fallback-visible to every locale.

**Why:** The admin can save while viewing Indonesian, while public visitors may
use English; exact-locale reads otherwise hide the saved image and silently
show the default hero.

**How to apply:** Keep image/config keys in the shared-key allowlist, normalize
their writes to the canonical locale, and preserve exact-locale behavior for
text fields.