---
name: IDR number input parsing
description: Why type=number inputs silently drop price saves for Indonesian-formatted values, and the correct pattern
---

# IDR price inputs must not use type="number" with naive dot parsing

**Rule:** For Rupiah price fields where users may type thousand separators (e.g. `150.000`), use `type="text"` + `inputMode="numeric"` and parse by stripping ALL non-digits (`replace(/[^0-9]/g, "")`) before `parseFloat`. IDR amounts are integers.

**Why:** With `type="number"`, a value containing `.` as a thousand separator (especially multi-dot like `3.200.000`) is treated as invalid by the browser, so `e.target.value` becomes `""` → `parseFloat` → `NaN`. A save handler that does `if (isNaN(val)) return;` then *silently skips* the save with no error toast — the user perceives "edit tidak bisa di-save" even though the backend is fine (returns 200 only because nothing/wrong value was sent). A single-dot value like `150.000` instead parses as `150`.

**How to apply:** Audit any price/amount input in BizPortal (vendor catalog, etalase, etc.). Prefer text+inputMode numeric, strip non-digits on parse, and don't let a NaN branch silently swallow the save. Also guard async save handlers against double-submit when both `onKeyDown` Enter and `onBlur` call the same save fn (early-return on an in-flight flag).
