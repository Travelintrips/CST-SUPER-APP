# CF-CP-4C — Customer Portal Tax Decision + Jasa Revenue Resolution

**Status:** `PARTIAL / OWNER_TAX_DECISION_REQUIRED / JASA_REVENUE_AMBIGUOUS`  
**Environment:** Development only  
**Date:** 2026-08-21

## Scope boundary

This audit covers only Customer Portal product/service revenue, tax treatment,
`TAX_OUTPUT`, and receivable usage. Paylabs, settlement, and reconciliation are
explicitly out of scope and were not changed.

The canonical Customer Portal project remains:

| Field | Value |
|---|---|
| project code | `customer_portal` |
| project config | `3` |
| company | `1` / CST |
| company source | `sales_documents.company_id` |
| payment source | `payments.id` |

## Runtime evidence

The development database was inspected read-only using the actual runtime
schema. The following facts are deterministic:

### Revenue

`finance_project_coa_mappings` contains exactly one active Customer Portal
revenue mapping:

| Scope | COA ID | Code | Name |
|---|---:|---|---|
| `goods` | `49121` | `4-1015-CST` | Pendapatan Penjualan Barang CST |

This mapping is retained from CF-CP-4B.

Jasa revenue remains service-specific/ambiguous. Active company-1 candidates
include freight, air freight, customs clearance, handling service, and document
service accounts. No Customer Portal posting proves that all jasa use one
account, and no current order row provides a persisted canonical service
discriminator that can safely select among them.

The relevant runtime structures are:

- `products.item_type` distinguishes `barang` and `jasa`;
- `products` has no canonical service subtype field;
- `portal_product_order_items` stores `product_id`, SKU, and display fields, but
  no `service_type`/`service_code`;
- `portal_product_orders.product_category` is a template/category label, not a
  proven accounting identity;
- `vendor_catalog_items.service_type` exists, but the Customer Portal order
  item does not persist a canonical vendor-catalog reference.

Therefore no jasa revenue mapping is created. A display-name or generic
`jasa` fallback would be unsafe.

### Tax treatment

Company 1 has an active equivalent output rule:

| Rule ID | Name | Rate | Direction | Transaction |
|---:|---|---:|---|---|
| `1` | PPN Keluaran 11% | 11% | output | `sales_order` |

However, the Customer Portal source does not expose one consistent tax
contract:

- standard order creation initializes `subtotal = grand_total`;
- standard sales-order creation derives `tax_amount` from the stored total but
  does not populate `sales_documents.tax_rate_id`;
- `product_first` invoice creation calculates `11%` on the line total and adds
  it as an exclusive tax;
- invoice update for shipment/truck cost also hardcodes `11%`;
- development Customer Portal rows currently have no runtime orders/payments
  proving the behavior end to end.

The source therefore proves an existing implementation convention, not an
approved business treatment for all goods or jasa. It does not prove whether
goods or jasa are universally taxable, nor whether the contract is inclusive
or exclusive. No Customer Portal tax mapping is created and no tax rule is
modified or invented.

Required business decisions, expressed only in business terms:

- goods: PPN 11% inclusive, PPN 11% exclusive, non-PPN, or another proven
  treatment;
- jasa: the same choice, independently, or per proven service subtype.

### `TAX_OUTPUT`

The canonical shared company-1 account is:

| Role | COA ID | Code | Name |
|---|---:|---|---|
| `TAX_OUTPUT` | `49109` | `2-1020-CST` | PPN Keluaran CST |

No separate Customer Portal tax account is needed. This account may be reused
only after an affected product/service scope has an approved taxable
treatment. No `TAX_OUTPUT` mapping is added in this phase.

### Receivable

The canonical candidate is `49101 / 1-1030-CST / Piutang Usaha CST`, but the
current Customer Portal payment boundary does not prove an invoice → A/R →
payment sequence:

- Customer Portal orders use `portal_product_orders` and
  `customer_invoice_links`;
- no company-1 Customer Portal accounting entries prove an A/R posting;
- no current Customer Portal runtime payment rows prove an A/R settlement
  lifecycle.

Classification: `RECEIVABLE = NOT_REQUIRED_FOR_CURRENT_PAYMENT_BOUNDARY`.
This does not prevent a future invoice-credit flow from introducing an
explicitly proven A/R mapping.

## Source and contract outcome

Existing additive contracts remain unchanged:

- nullable `product_scope` on `finance_project_coa_mappings`;
- nullable `product_scope` on `finance_project_tax_mappings`;
- goods revenue mapping only;
- revenue and tax resolvers fail closed for missing, unknown, or ambiguous
  scopes;
- the Customer Portal finance event adapter remains pure and side-effect free.

No mapping was created for:

- jasa revenue;
- goods tax;
- jasa tax;
- `TAX_OUTPUT`;
- receivable.

## Fail-closed matrix

| Case | Expected result |
|---|---|
| unknown goods/jasa scope | configuration failure |
| unknown jasa subtype | configuration failure |
| missing revenue mapping | configuration failure |
| ambiguous revenue mapping | configuration failure |
| missing tax mapping | configuration failure |
| ambiguous tax mapping | configuration failure |
| company mismatch | event/configuration rejection |

Financial effects remain zero for these unresolved cases. No accounting,
settlement, bank mutation, reconciliation, or Paylabs operation is introduced
by CF-CP-4C.

## Final classification

```text
CF-CP-4C = PARTIAL
GOODS REVENUE = 49121 / 4-1015-CST / ADOPTED
JASA REVENUE MODEL = SERVICE_SPECIFIC_OR_AMBIGUOUS
JASA REVENUE MAPPINGS = NONE; stable subtype is not persisted by Customer Portal
GOODS TAX = OWNER_DECISION_REQUIRED
JASA TAX MODEL = OWNER_DECISION_REQUIRED
JASA TAX MAPPINGS = NONE
TAX_OUTPUT COA = 49109 / 2-1020-CST / PPN Keluaran CST / DEFERRED
RECEIVABLE = NOT_REQUIRED_FOR_CURRENT_PAYMENT_BOUNDARY
FAIL-CLOSED = PASS
PROD WRITES = 0
PROD MIGRATION = 0
PAYLABS = DEFERRED
SETTLEMENT = DEFERRED
RECONCILIATION = DEFERRED
READY FOR CF-CP-5 CENTRAL CONSUMER = NO
```

## Owner decisions still required

Only these business decisions remain:

1. Goods tax treatment: inclusive PPN 11%, exclusive PPN 11%, non-PPN, or
   another proven treatment.
2. Jasa tax treatment: same choices independently, or per service subtype if
   the subtype contract is first made canonical.
3. Whether Customer Portal should persist a stable service discriminator
   (`service_type`, `service_code`, or equivalent) before jasa COA mappings are
   adopted.
