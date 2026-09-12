---
name: Marketplace internal-vs-external vendor model
description: How PT Cahaya Sejati Teknologi's own commodity/logistics catalog is distinguished from third-party marketplace vendors, and canonical supplier IDs on dev.
---

There is no `owner_type`/`is_internal` column on `suppliers`. Internal-group membership is inferred purely by `suppliers.company_id = 1` (PT Cahaya Sejati Teknologi's company id). `company_id IS NULL` = genuine external vendor (couriers etc.) or unclassified — do not assume external without checking dependencies first.

**Why:** a 2026-07-13 cleanup runbook explicitly forbade adding a new column/migration without approval; user approved using `company_id` as the interim marker, extensible later to a real `owner_type` if needed.

**Canonical entities on dev (Supabase dev project) after the 2026-07-13 cleanup:**
- Supplier id 24 "PT Cahaya Sejati Teknologi" — canonical internal supplier for **commodity products** (coal, coconut charcoal briquette, palm acid oil, rubber, coffee, cinnamon, steel, iron ore). All 8 items seeded as `status='draft', is_published=false` because no real price/spec/MOQ data existed — do not publish or fabricate data for these; wait for real business data before flipping to published.
- Supplier id 10 "CST Freight & Logistics" — internal logistics/freight-forwarding **services** brand (company_id=1). Only service-type marketplace listings belong here (Sea Freight, Air Freight, Customs Clearance/PPJK, Trucking). Its 2 pre-existing published items (Sea Freight FCL, PPJK Customs Clearance) are real/kept; Air Freight and Trucking added as unpublished drafts. Do NOT merge CST Freight's internal operational/trucking/order workflow into the Marketplace catalog — only customer-facing service listings.
- Suppliers id 1 ("PT. Nusantara Komoditas Utama") and id 11 ("PT. Angkasa Kargo Nusantara") were demo/duplicate data — archived (status/marketplace_status='archived', is_active=false, their catalog items unpublished+inactive too), NOT deleted, because id 1 had historical featured-product requests. History preserved for audit.
- Suppliers id 12 and 23 (empty duplicate "PT ANGKASA PURA(...)" rows, zero dependencies anywhere) were hard-deleted.

**Verification pattern:** before any supplier delete/archive decision, check dependencies across: vendor_catalog_items, mkt_rfqs(catalog_vendor_id), rfq_vendor_links, mkt_vendor_quotes, vendor_quotations, mkt_purchase_orders, purchase_documents, vendor_invoices, payment_requests, mkt_featured_product_requests(vendor_id/catalog_item_id join), supplier_status_history, supplier_documents, product_media. A backup snapshot of these rows for the affected supplier ids is worth writing to `.local/backups/` before any destructive SQL.

This cleanup was only applied to the **dev** Supabase project; production still has the pre-cleanup demo data and needs the same script re-run after user review (dev/prod are separate Supabase projects, see db-url-priority-dev.md).

**2026-07-13 catalog hardening round:** official PT CST catalog (11 SKUs) seeded as draft under supplier id 24; 6 non-official commodities (coal/charcoal/rubber/cinnamon/steel/iron-ore) kept as plain `draft` (NOT a custom status like `pending_business_confirmation` — user explicitly rejected that status value, they are real business lines just not yet fully specced). Product/Service grouping requirement was satisfied via the EXISTING `type`/`templateKind` column (already used by `isServiceCatalogItem()` in customer-portal marketplace.tsx) — no schema change needed. Note: customer-portal's marketplace page currently hardcodes `activeTab` to `"product"` only ("service tab removed", services redirected to dedicated pages like `/trucking`) — treat any request to surface a service-type grouping in the main marketplace grid as a UI/workflow change requiring explicit approval, not a pure data task.
