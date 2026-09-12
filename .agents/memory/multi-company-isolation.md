---
name: Multi-Company Data Isolation
description: Architecture decisions for multi-company isolation across Vendors, Templates, and WA Templates
---

## Rule
Three entity groups isolated by company_id:
1. **Vendors** (`suppliers`) — company_id already existed in schema; routes in `trading.ts` now filter via `resolveCompanyId`.
2. **Product Templates** (`product_templates`) — company_id added; old `UNIQUE(category_key)` dropped; new `UNIQUE INDEX COALESCE(company_id, 0), category_key`.
3. **WA Templates** (`whatsapp_template_configs`) — company_id added; old `uq_wa_tpl_cfg` on (recipient, workflow) dropped; new `UNIQUE INDEX COALESCE(company_id, 0), recipient, workflow`.

## NULL vs non-NULL company_id
- `company_id IS NULL` = global/system record, visible to all companies
- `company_id = X` = company-specific record, only visible to company X
- Route filter pattern: `or(eq(table.companyId, companyId), isNull(table.companyId))`
- Company-specific rows take priority over global in GET /:key (prefer company row)

## WA Template Upsert
Old `onConflictDoUpdate` on (recipient, workflow) replaced with explicit SELECT + UPDATE/INSERT because partial unique indexes (COALESCE-based) can't be targeted by Drizzle's onConflict syntax.

## Index Creation
Unique indexes were NOT created by `drizzle-kit push` (push only adds columns declared in Drizzle schema, not raw SQL indexes). They must be created via `psql` or inline SQL executed at server startup.

**Why:** COALESCE-based partial unique indexes can't be expressed in Drizzle ORM schema DSL — only via raw SQL.

## How to apply for new multi-company tables
1. Add `companyId: integer("company_id").references(() => companiesTable.id)` (nullable) to Drizzle schema
2. Run `drizzle-kit push`
3. Manually create: `CREATE UNIQUE INDEX IF NOT EXISTS uq_<table>_company ON <table> (COALESCE(company_id, 0), <other_unique_cols>)`
4. Import `resolveCompanyId` in route, filter with `or(eq(...companyId, cid), isNull(...companyId))`
5. Set `companyId = resolveCompanyId(req)` on all INSERT operations
