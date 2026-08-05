# ENTERPRISE DATABASE PHASE 3
## Order & Quote Consolidation — Design Audit

**Status:** Design audit only. No schema changes, no migrations, no table merges were made in this phase.

Continues after Phase 1 (company isolation, token hardening, initial indexes) and Phase 2 (22 FK relationships enforced, 14 new indexes, idempotent migrations confirmed clean).

---

## Executive Summary

**Recommendation: Do NOT merge tables. Adopt Option C (unified read-only views) now, Option D (event-driven link table) as the medium-term connective layer. Revisit a canonical `business_orders` header (Option B) only after 2+ quarters of stable view/link usage.**

The five order tables and six quote/RFQ tables are not accidental duplication — they represent five genuinely different business domains (general e-commerce, freight logistics, marketplace B2B procurement, portal product sales, and customs/PPJK brokerage) each with a different lifecycle, different external counterparties (customer vs. vendor vs. broker), and different downstream accounting treatment. They were built by different teams/phases at different times and already have deep, independent integrations with routes, workers, and three separate frontends (bizportal, customer-portal, logistic-order).

Merging the physical tables now carries high risk (double invoicing, duplicate payment postings, broken accounting sources, RFQ lifecycle corruption — see Fase 6) for low reward, since the actual pain point users feel is **fragmented reporting/visibility**, not schema duplication. That pain point is fully solved by a `UNION`-based read-only view layer, which is reversible, additive, and does not touch a single write path.

---

## FASE 1 — Table Inventory

### Order Tables

| Table | Domain | Purpose | Lifecycle | Used By | Overlap |
|---|---|---|---|---|---|
| `orders` | General e-commerce | Generic sales orders (bizportal internal sales) | `pending → processing → shipped → delivered / cancelled` | `routes/ecommerce.ts`; bizportal sales pages | Low — generic catch-all, thin schema, no vendor/RFQ linkage |
| `logistic_orders` | Freight / logistics | Export-import & freight order header (origin/destination/commodity) | `New Order → Quoted → Approved → In Progress → Completed / Cancelled` | `routes/logisticOrders.ts`, `services/logisticOrderStatusService.ts`, `driverJobWorker.ts`, `routes/freight.ts`; `logistic-order` app (primary), `bizportal/pages/logistics` | High — shares vendor selection + RFQ flow with `logistic_order_rfqs`/`rfq_vendor_links`; feeds `vendor_fulfillment_links` |
| `mkt_purchase_orders` | Marketplace B2B | PO issued to a vendor after RFQ acceptance | `draft → sent → accepted / rejected → completed / cancelled` | `services/mktPoLifecycleService.ts`, `routes/mktAdmin.ts`, `routes/mktPortal.ts`; bizportal purchase pages, customer-portal vendor acceptance | High — directly FK'd to `mkt_rfqs`; parallel structure to `logistic_orders` + `logistic_order_rfqs` but for a different counterparty type (catalog vendor vs. freight vendor) |
| `portal_product_orders` | Marketplace B2C / product sales | Customer purchase of catalog product | `pending_payment → paid → processing → shipped → completed / cancelled` | `routes/portalProductOrders.ts`, `services/portalMarketplaceService.ts`; customer-portal | Medium — own payment_status field, own item table (`portal_product_order_items`), no vendor/RFQ dependency |
| `ppjk_orders` | Customs brokerage | Import/export customs clearance order | `Draft → Submitted → Process → Paid → Finished / Cancelled` | `routes/ppjk.ts`, `routes/freight.ts`; `bizportal/pages/logistics/ppjk.tsx`, `customer-portal/pages/ppjk-track.tsx` | Low-Medium — conceptually a service order tied to freight, but has customs-specific fields (`nilai_pabean`, `trade_type`) with no shared table today |

### Quote Tables

| Table | Domain | Purpose | Lifecycle | Used By | Overlap |
|---|---|---|---|---|---|
| `quote_requests` | Public portal intake | Anonymous freight quote request from marketing site | `new → handled` | `routes/customerQuoteFlow.ts` | Low — pure lead-capture, converts manually into `logistic_orders`, no FK |
| `portal_quick_quotes` | Public portal intake | Quick quote form (broader service categories than `quote_requests`) | `new → contacted → converted / cancelled` | `routes/portalQuickQuotes.ts` | Low — parallel lead-capture path to `quote_requests`, functionally near-duplicate intake form |
| `logistic_order_rfqs` | Freight vendor sourcing | RFQ against freight vendors for a specific `logistic_orders` row | `admin_review → vendor_blasted → quoted → customer_review → customer_accepted/rejected → closed/expired` | `logisticRfqV2.ts`, `rfqStatusService.ts`, `logisticOrderStatusService.ts` | High — 1:1(ish) child of `logistic_orders`; parallel structure to `mkt_rfqs` for a different vendor pool |
| `mkt_rfqs` | Marketplace vendor sourcing | RFQ against catalog vendors, portal-buyer initiated | `draft → submitted → open → closed / cancelled`, separate `approval_status` | `marketplaceRfqService.ts`, `rfqApprovalService.ts` | High — parent of `mkt_vendor_quotes`, `rfq_vendor_links`, and `mkt_purchase_orders.rfq_id` |
| `rfq_vendor_links` | Freight vendor sourcing | Per-vendor invitation/response record for a `logistic_order_rfqs` row | `waiting_response → opened → submitted → selected/not_selected → expired` | `rfqStatusService.ts`, `vendorInvitationService.ts` | High — child of `logistic_order_rfqs` (Phase 2 confirmed `rfq_id → mkt_rfqs` AND a pre-existing Drizzle FK on a different reference — **see Fase 6, data-integrity flag**) |
| `mkt_vendor_quotes` | Marketplace vendor sourcing | Vendor's submitted quote against a `mkt_rfqs` row | `draft → submitted → accepted / rejected` | `vendorQuoteSubmissionService.ts` | High — child of `mkt_rfqs`; structurally the marketplace equivalent of `rfq_vendor_links` |

> **Naming collision flagged during Phase 2 verification:** `rfq_vendor_links.rfq_id` was added as a Phase 2 FK pointing at `mkt_rfqs`, but Postgres already had a pre-existing constraint `rfq_vendor_links_rfq_id_fkey` pointing at `logistic_order_rfqs`. **Both constraints currently coexist** (Phase 2's `fk_rfq_vl_rfq` is `NOT VALID` against `mkt_rfqs`; the original validated constraint points at `logistic_order_rfqs`). This means `rfq_vendor_links.rfq_id` is ambiguous by name alone — it structurally belongs to the **logistics** RFQ chain, not the marketplace one. This is a data-model naming trap, not a bug introduced by Phase 3, but it directly affects the consolidation design below and should be resolved (see "Next Patch Recommendation").

---

## FASE 2 — Data Model Comparison

### Order Fields

| Field | orders | logistic_orders | mkt_purchase_orders | portal_product_orders | ppjk_orders |
|---|---|---|---|---|---|
| customer | `customer_name/email/phone` | `customer_name/email/phone` | — (vendor-facing, no customer) | `customer_id` (FK) | `customer_name` |
| company | `company_id` | `company_id` | `company_id` | `company_id` | `company_id` |
| vendor/supplier | — | `approved_vendor_id` | `vendor_id` | — | `vendor_id` |
| service type | — (generic) | `order_type`, `shipment_type` | — (per RFQ) | — (catalog product) | `trade_type` (import/export) |
| origin/destination | — | `origin`, `destination` | — | `shipping_address` | — |
| amount | `total_amount`, `grand_total` | `subtotal`, `tax`, `grand_total` | `total_amount` | `total_amount` | `service_fee`, `total_service_fee` |
| status | `status` | `status` | `status` | `status` | `status` |
| payment status | — (implicit in status) | — (implicit in status) | — | `payment_status` (explicit) | — (implicit in status) |
| invoice relation | none direct | via accounting_entries (source=logistic) | via accounting_entries | via accounting_entries | via accounting_entries |
| fulfillment relation | none | `vendor_fulfillment_links` | none direct | `portal_product_order_items` | none |
| document relation | none | `sales_documents`/`purchase_documents` (indirect) | none direct | none direct | none direct |

**Observation:** Only `portal_product_orders` has an explicit `payment_status` column — the rest encode payment state inside the generic `status` enum, which is inconsistent and one of the drivers of accounting risk noted in Fase 6.

### Quote Fields

| Field | quote_requests | portal_quick_quotes | logistic_order_rfqs | mkt_rfqs | mkt_vendor_quotes |
|---|---|---|---|---|---|
| requester | `name/email/whatsapp` | `name/email/phone` | — (inherits from parent order) | `buyer_name/buyer_email` | — (vendor, not requester) |
| customer | same as requester | same as requester | via `logistic_orders.customer_*` | `portal_customer_id` | via parent RFQ |
| vendor/supplier | — | — | via `rfq_vendor_links` | via `mkt_vendor_quotes`/`rfq_vendor_links` | `vendor_id` |
| RFQ status | `status` (new/handled — not a real RFQ) | `status` (new/contacted/converted/cancelled — not a real RFQ) | `status` (full RFQ lifecycle) | `status` + separate `approval_status` | `status` |
| quote amount | `estimated_total` | — | `basic_price`, `quoted_price` | — (rolled up from `mkt_vendor_quotes`) | `quote_amount` |
| validity | — | — | — | — | `valid_until` |
| response deadline | — | — | `response_deadline` | — | — |
| selected vendor | — | — | via `rfq_vendor_links.status='selected'` | via `mkt_purchase_orders.rfq_id` after PO issued | n/a (this IS the vendor's quote) |
| created source | web form | web form | admin-created from `logistic_orders` | portal buyer-created | vendor portal submission |

**Observation:** `quote_requests` and `portal_quick_quotes` are not RFQs in the vendor-sourcing sense — they are pre-sales lead-capture forms with near-identical shapes and no FK relationship to any order/RFQ table. They are the clearest, lowest-risk consolidation candidate in the entire audit.

---

## FASE 3 — Single Source of Truth Design

Evaluated against the four options in the spec:

- **A. Keep separate** — correct for `orders`, `portal_product_orders`, `ppjk_orders` (genuinely distinct domains, low current pain).
- **B. Parent-child (`business_orders` header + domain detail tables)** — architecturally the "correct" long-term answer, but requires rewriting every write path (5 order tables × their route/service files) and every read path in 3 frontends simultaneously. High blast radius, not appropriate to attempt without a dedicated migration project and a freeze window.
- **C. Unified read-only view (`v_unified_orders`, `v_unified_quotes`)** — **recommended now.** Zero risk to existing writers, gives cross-domain reporting/search immediately, fully reversible (`DROP VIEW`), and does not require any frontend change unless a new "unified" screen is built against it.
- **D. Event-driven link table (`order_links`)** — **recommended as the next structural step**, specifically to resolve real cross-domain relationships that already exist informally today, e.g. a `logistic_orders` row that also has a `ppjk_orders` customs leg, or a `mkt_purchase_orders` that originated from a `portal_product_orders` bulk request. This is additive (new table, no FK changes to existing tables) and directly enables Option C's views to also express relationships, not just union rows.

Recommended combination: **C now, D next, reassess B only if C+D still leave reporting gaps after adoption.**

---

## FASE 4 — Recommendation Per Domain

| Domain | Recommendation | Rationale |
|---|---|---|
| `orders` | **Keep** | Generic/simple, low overlap, no RFQ chain |
| `logistic_orders` | **Keep + Link** | Core of the logistics product; link to `ppjk_orders` and `vendor_fulfillment_links` via `order_links`, not merge |
| `mkt_purchase_orders` | **Keep + Link** | Structurally parallel to `logistic_orders`+RFQ but different vendor pool (catalog vs. freight); link, don't merge |
| `portal_product_orders` | **Keep** | Only table with proper `payment_status`; distinct B2C catalog flow |
| `ppjk_orders` | **Keep + Link** | Often triggered by a `logistic_orders` shipment; link relationship, don't fold into logistics table (customs-specific compliance fields) |
| `quote_requests` | **Merge (into `portal_quick_quotes`, or a new shared `portal_lead_quotes`)** | Near-identical shape and purpose to `portal_quick_quotes`; lowest risk merge candidate, no downstream FK dependents |
| `portal_quick_quotes` | **Keep as merge target** | See above |
| `logistic_order_rfqs` | **Keep** | Deep integration with `logistic_orders` lifecycle and driver/vendor blast workflow; do not touch |
| `mkt_rfqs` | **Keep** | Deep integration with marketplace PO/vendor-quote chain; do not touch |
| `rfq_vendor_links` | **Do Not Touch Yet** | Ambiguous dual-FK state from Phase 2 (see Fase 1 flag) must be resolved first — merging or relinking this table before that is fixed risks corrupting vendor selection history |
| `mkt_vendor_quotes` | **Keep** | Clean 1:1 structural analog to `rfq_vendor_links` for the marketplace side once the above is resolved |

**View-only candidates (Fase 3, Option C), independent of the merge/keep decision above:** all 5 order tables → `v_unified_orders`; all 6 quote tables → `v_unified_quotes`.

No table is recommended for **Deprecate** or **Archive** at this time — all are actively written to by live workflows.

---

## FASE 5 — Migration Roadmap (staged, no step commits without separate approval)

1. **Tahap 1 — Read-only unified views.** Create `v_unified_orders` (UNION ALL of the 5 order tables, normalized to a common column set: id, source_table, company_id, counterparty_name, status, amount, created_at) and `v_unified_quotes` (same pattern for the 6 quote tables). Views only — zero write-path risk, fully reversible.
2. **Tahap 2 — Cross-reference table (`order_links`).** New table: `order_links(id, source_table, source_id, target_table, target_id, link_type, created_at)`. Backfill known relationships (e.g., `ppjk_orders` rows that reference a `logistic_orders` shipment via existing free-text fields, if any) manually/scripted, additive only.
3. **Tahap 3 — Standardize statuses.** Introduce a shared `order_status_map` / `quote_status_map` lookup that normalizes each domain's native status into a common coarse status (`open/in_progress/completed/cancelled`) for use by the unified views — does not touch the native status columns.
4. **Tahap 4 — New writes to canonical model.** Only after Tahap 1-3 are stable in production for a full cycle: evaluate whether `quote_requests` + `portal_quick_quotes` merge (the one identified low-risk merge) is worth executing, routing new lead-capture writes to the merged table behind a feature flag.
5. **Tahap 5 — Backfill old records.** Only applies if Tahap 4 is executed; backfill `quote_requests` history into the merged table with a `legacy_source` marker column.
6. **Tahap 6 — Deprecate legacy table.** Only `quote_requests` is a deprecation candidate, and only after Tahap 4/5 are validated in production for a full reporting cycle. No order table is a deprecation candidate under this roadmap.

Each stage should be its own patch/review cycle — do not batch stages.

---

## FASE 6 — Risk Analysis

| Risk | Applies To | Severity | Notes |
|---|---|---|---|
| Breaking frontend | Any physical merge (Option B) | **Critical** | 3 separate frontends (bizportal, customer-portal, logistic-order) each hardcode field names from these tables |
| Breaking API | Any physical merge (Option B) | **Critical** | Route files are table-specific; a header/detail split would require versioning every order/quote endpoint |
| Double invoice | `logistic_orders` ↔ `ppjk_orders` if merged/linked incorrectly | **High** | Both can generate `accounting_entries`; a naive merge/link could cause the same shipment to post twice |
| Duplicate payment | `portal_product_orders` ↔ `orders` if a future "unified checkout" writes to both | **Medium** | Currently isolated; only a risk if Option C views are misused as write targets (they must stay strictly read-only) |
| Wrong accounting posting | Any status-standardization work (Tahap 3) | **High** | `accounting_entries.source` keys off each table's native identity; a coarse unified status must never be fed back into posting logic |
| Vendor/customer mismatch | `rfq_vendor_links` dual-FK ambiguity (flagged in Fase 1) | **High** | Until resolved, any tooling built on `rfq_vendor_links.rfq_id` could silently join against the wrong RFQ domain |
| RFQ lifecycle corruption | `logistic_order_rfqs` / `mkt_rfqs` if forced into one schema | **Critical** | Their status enums are not compatible (freight has a customer-review step; marketplace has a separate approval_status) — collapsing them would lose state |

**Overall risk of proceeding with any physical merge today: HIGH. Overall risk of Tahap 1 (views only): LOW.**

---

## OUTPUT SUMMARY

### Executive Summary
Do not merge. Build `v_unified_orders` / `v_unified_quotes` read-only views now; add an `order_links` cross-reference table next; standardize status mapping after that. Revisit a canonical header table only if the view+link layer proves insufficient after real usage.

### Order Table Matrix
See Fase 1 & Fase 2 tables above.

### Quote Table Matrix
See Fase 1 & Fase 2 tables above.

### Recommended Architecture
**Unified read-only view** (Option C) now, **link table** (Option D) next. Parent-child canonical table (Option B) deferred indefinitely pending real gaps after C+D.

### Migration Roadmap
Six staged tahap, each independently reviewable — see Fase 5. No stage should be executed without a dedicated approval/patch cycle.

### Tables To Keep
`orders`, `logistic_orders`, `mkt_purchase_orders`, `portal_product_orders`, `ppjk_orders`, `logistic_order_rfqs`, `mkt_rfqs`, `mkt_vendor_quotes`.

### Tables To Deprecate Later
`quote_requests` — only after merging into `portal_quick_quotes` (or a new shared lead table) and validating for a full reporting cycle.

### Do Not Touch Yet
`rfq_vendor_links` — has a dual/ambiguous FK state from Phase 2 (`fk_rfq_vl_rfq → mkt_rfqs` NOT VALID coexisting with the original validated `rfq_vendor_links_rfq_id_fkey → logistic_order_rfqs`). Resolve this ambiguity as a standalone, targeted patch before any consolidation work touches this table.

### Next Patch Recommendation
A small, isolated patch (not part of consolidation) to resolve the `rfq_vendor_links` dual-FK ambiguity: confirm with the logistic RFQ team whether `rfq_vendor_links.rfq_id` should reference `logistic_order_rfqs` (matching its actual usage in `rfqStatusService.ts`/`vendorInvitationService.ts`) or `mkt_rfqs`, then drop whichever Phase 2 FK is incorrect. This is a pure correctness fix, unrelated to the consolidation decision, and should happen before Tahap 1 views are built so the view logic doesn't inherit the ambiguity.
