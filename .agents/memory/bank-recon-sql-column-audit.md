---
name: Bank Reconciliation SQL Column Audit
description: Known column name mismatches in candidateDetailsSql UNION ALL query + debugging technique for hidden Drizzle SQL errors.
---

## Rule
When writing raw SQL in `candidateDetailsSql` or any UNION ALL query in `bankReconciliation.ts`, always verify column names against Drizzle schema or raw SQL migration files — not intuition.

**Why:** The query accesses 7+ heterogeneous tables. Column names were wrong for several candidate types, each causing a 500 that was invisible because Drizzle only puts the PostgreSQL error in `e.cause.message`, not `e.message`. Four separate errors were peeled one by one before the endpoint worked.

## Confirmed correct column names (verified Aug 2026)

| Table | Wrong (was) | Right |
|---|---|---|
| `sales_documents` | `issue_date` | `invoice_date` (nullable → COALESCE with `created_at::date`) |
| `sales_documents` | `doc_type` | `kind` |
| `logistic_orders` | `total_price` | `grand_total` |
| `sport_payments` | `customer_id` | does NOT exist — go via `sport_bookings.customer_id` |
| `sport_payments` | `payment_type` | does NOT exist on this table |
| `tenants` | `name` | `business_name` |
| `tenant_invoices` | `tenant_name` | does NOT exist — join `tenants` and use `t.business_name` |

## UNION ALL type mismatch
`bank_mutations.status` is a USER-DEFINED enum on this Supabase DB. Any UNION ALL with a TEXT CASE expression fails.
Fix: always cast `bm.status::text`, `bm.transaction_date::text`, `bm.direction::text` explicitly in the bm side of the UNION.

`bank_mutations.bank_account_id` is TEXT in the runtime Supabase schema while `company_bank_accounts.id` is INTEGER. Compare normalized text identities (and allow the account number where required); a direct equality makes the entire mutation list return HTTP 500.

**Why:** A correlated eligibility subquery is evaluated as part of every list request, even when no eligible historical settlement exists.

## Drizzle error logging fix
`e.message` only says "Failed query: …\nparams: ". Real PostgreSQL error is in `e.cause?.message`.
Always log: `const dbMsg = e.cause?.message ?? e.cause ?? e.message; logger.error({ err: dbMsg }, "...")`.

## AccountingHub view column rename
`CREATE OR REPLACE VIEW` fails if column names changed (PostgreSQL error: "cannot change name of view column").
Fix: `await db.execute(sql\`DROP VIEW IF EXISTS accounting_payments_v\`).catch(() => {})` before CREATE.

## How to apply
- Before modifying any raw SQL touching these tables, grep the Drizzle schema file for actual column names.
- sport_payments is NOT in lib/db/src/schema/ — defined via raw SQL in `src/modules/sport-center/migration.ts`.
- tenant_invoices is NOT in lib/db/src/schema/ — defined via raw SQL in `src/modules/tenant/migration.ts`.
- For debugging 500 on SQL endpoints: add `e.cause?.message` to error catch immediately, restart, then read the real error.
