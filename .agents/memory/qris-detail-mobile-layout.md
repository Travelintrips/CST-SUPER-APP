---
name: Mobile detail sheet layout
description: Responsive constraints for narrow-screen bank mutation and QRIS detail panels.
---

The shared SheetContent component defaults side panels to `w-3/4` with a desktop max width. A narrow detail panel must explicitly override that width to the viewport (`100vw`) and switch dense label/value grids to a single-column layout below the tablet breakpoint.

**Why:** Long settlement references and right-aligned monetary values can otherwise widen grid tracks beyond the viewport; the browser clips the right side instead of wrapping the content.

**How to apply:** For mobile detail sheets, use an explicit viewport width override and `min-w-0` on grid/flex children. Use stacked label/value rows on small screens, restoring two-column alignment only at a larger breakpoint.