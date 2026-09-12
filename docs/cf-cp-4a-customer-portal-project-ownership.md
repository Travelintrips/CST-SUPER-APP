# CF-CP-4A — Customer Portal Project Ownership Adoption

**Environment:** Development  
**Status:** `CF-CP-4A-COMPLETE`  
**Completed:** 2026-08-20  

## Result

The Customer Portal project configuration was adopted in the development
Supabase runtime with:

| Field | Value |
|---|---|
| `project_code` | `customer_portal` |
| `company_id` | `1` |
| `display_name` | `Customer Portal` |
| `is_active` | `true` |
| `effective_from` | `2026-08-20` |
| `effective_to` | `NULL` |
| `config_version` | `1` |
| `central_accounting_enabled` | `false` |
| canonical company source | `public.sales_documents.company_id` |

The operation was additive, idempotent, fail-closed, and executed in one
transaction against the development runtime only.

## Post-transaction invariant evidence

Exactly one active, currently effective configuration exists for
`customer_portal` and company `1`.

The following related mappings remain empty as required:

- Customer Portal tax mappings: `0`
- Customer Portal payment/provider configs: `0`
- Customer Portal COA mappings: `0`

## Deferred and excluded scope

- Tax configuration: **DEFERRED**
- COA configuration: **DEFERRED**
- Paylabs finance configuration: **OUT_OF_SCOPE**
- Bank configuration: **OUT_OF_SCOPE**
- Settlement: **OUT_OF_SCOPE**
- Production cutover: **not performed**

No tax, Paylabs, bank, COA, settlement, or reconciliation data was seeded.