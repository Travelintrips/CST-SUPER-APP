---
name: BizPortal frontend conventions
description: Non-obvious missing imports and correct patterns for new bizportal pages
---

## Rules

**No `PageHeader` component** — `@/components/layout/` only has AppShell, ModuleHub, etc. Use inline div:
```tsx
<div className="flex items-center gap-3">
  <Icon className="w-6 h-6 text-blue-600" />
  <div>
    <h1 className="text-xl font-semibold">Title</h1>
    <p className="text-sm text-muted-foreground">Description</p>
  </div>
</div>
```

**No `@/stores/companyStore`** — Use `useCompany` from `@/contexts/CompanyContext`:
```tsx
import { useCompany } from "@/contexts/CompanyContext";
const { activeCompanyId } = useCompany();
```

**No `@/lib/apiClient`** — Use native `fetch` with credentials:
```tsx
// GET
fetch(`/api/...?company_id=${id}`, { credentials: "include" }).then(r => r.json())

// POST
fetch("/api/...", {
  method: "POST", credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({...}),
}).then(async r => { const data = await r.json(); if (!r.ok) throw data; return data; })
```

**No `@/lib/format` with `formatIDR`** — Use inline:
```tsx
function fmt(n: unknown) {
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(Number(n ?? 0)));
}
```

**Why:** These paths never existed in bizportal's lib/stores directory. The patterns above match existing pages like closing-entries.tsx and wht-reconciliation.tsx.

**How to apply:** Every new bizportal page must use these patterns. Check closing-entries.tsx or wht-reconciliation.tsx as reference.
