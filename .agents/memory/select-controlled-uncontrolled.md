---
name: Select controlled/uncontrolled account picker bug
description: Radix/shadcn Select value prop using `? String(x) : undefined` can silently fail to persist user selections; use empty string fallback instead.
---

## The problem

Pattern seen repeatedly in `artifacts/bizportal/src/pages/accounting/bank-disbursements.tsx`:

```tsx
<Select
  value={item.accountId ? String(item.accountId) : undefined}
  onValueChange={(v) => onChange(idx, "accountId", v ? Number(v) : null)}
>
```

When the underlying value is `null`/unset, this passes `undefined` to Radix Select's `value` prop, which makes the component briefly uncontrolled. Once a value is picked it becomes a controlled string. React logs "Select is changing from uncontrolled to controlled" warnings, and in list/row contexts (e.g. one Select per invoice line, keyed by a dynamic `lineKey`) this transition can cause the selection to not visibly/reliably stick — users report "I already selected the account" but client-side validation still says it's empty.

**Why:** Toggling a form control between controlled and uncontrolled mid-lifecycle is explicitly unsupported by React and Radix; behavior is inconsistent especially across re-renders triggered by sibling state updates in the same row.

**How to apply:** For any controlled `Select`/`Input` whose backing value can be `null`/`undefined`, always fall back to a stable empty string `""` (never `undefined`) so the component stays controlled for its entire lifetime:

```tsx
value={item.accountId ? String(item.accountId) : ""}
```

This does not require adding a `SelectItem value=""` — it's fine for the root Select to sit at `""` (unselected) as long as no child item shares that value (Radix throws if a `SelectItem` itself has `value=""`).

When debugging "I selected X but validation says it's not selected" bugs in this codebase, grep for `? String(...) : undefined` in the relevant Select usages first — it's a codebase-wide anti-pattern, not a one-off bug.
