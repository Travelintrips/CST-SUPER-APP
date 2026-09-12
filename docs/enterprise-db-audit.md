# ENTERPRISE DATABASE AUDIT
## Monorepo-wide Schema, Relation, Integrity, and Overlap Audit

**Tanggal:** 2026-07-07  
**Scope:** `lib/db/src/schema/` (~120 schema files), `artifacts/api-server/src/routes/` (~80+ route files)  
**Status:** READ-ONLY — tidak ada migration, tidak ada perubahan schema, tidak ada perubahan kode.

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total schema files audited | ~120 |
| Estimated total tables | ~140+ |
| Foreign key gaps (unlinked `_id` columns) | **23+** |
| Multi-company isolation gaps (CRITICAL) | **4** |
| Missing indexes (high-impact queries) | **8** |
| Domain overlaps (table duplication) | **6** |
| Token security issues | **6** |
| Status/enum inconsistencies | **5 categories** |
| Orphan/unused table candidates | **3** |

---

## Domain Map

### Portal
`portal_customers`, `portal_customer_profiles`, `portal_company_members`, `portal_product_orders`, `portal_quick_quotes`, `onboarding`, `customer_verification_documents`, `customer_approval_history`, `customer_service_requests`

### Marketplace
`mkt_rfqs`, `mkt_rfq_lines`, `mkt_rfq_approvals`, `mkt_rfq_guest_claims`, `mkt_vendor_quotes`, `mkt_vendor_quote_lines`, `mkt_purchase_orders`, `mkt_purchase_order_lines`, `mkt_po_shipments`, `mkt_po_shipment_items`, `mkt_po_shipment_events`, `mkt_po_goods_receipts`, `mkt_po_goods_receipt_items`, `mkt_company_settings`, `mkt_dual_write_log`, `mkt_notification_queue`, `rfq_vendor_links`, `quote_requests`, `customer_quote_links`

### Logistics
`logistic_orders`, `logistic_order_items`, `logistic_order_quotes`, `logistic_vendor_fulfillments`, `shipments`, `shipment_stages`, `freight_shipments`, `freight_master_data`, `freight_attachments`, `freight_audit_log`, `freight_customs_docs`, `air_freight_*`, `ocean_freight_*`, `ppjk_orders`, `order_fulfillment`, `order_stage_logs`, `order_status_history`, `order_audit_logs`, `orders`, `logistics_rate_cards`, `logistics_service_rates`, `logistics_surcharges`

### Accounting / Finance
`accounting_journals`, `accounting_entries`, `accounting_entry_lines`, `accounting_periods`, `chart_of_accounts`, `accounting_payments`, `cost_centers`, `financial_outbox_events`, `sales_documents`, `sales_document_lines`, `purchase_documents`, `purchase_document_lines`, `transactions`, `payments`, `cash_advances`, `expenses`, `expense_approvals`, `bank_loans`, `bank_mutation_imports`, `bank_mutations`, `fixed_assets`, `margin_rules`, `allocations`

### Tax
`tax_periods`, `tax_export_batches`, `tax_export_rows`, `transaction_taxes`, `btki_tariff`

### Sport Center
`sport_bookings` (Supabase cross-schema), `sport_payments` (Supabase cross-schema), `sport_expenses`

### HRM / Driver / Fleet
`org_structure` (branches, divisions, departments, sections), `drivers`, `driver_jobs`, `driver_locations`, `fleet_vehicles`, `fleet_expenses`, `fleet_intelligence`, `fleet_outstanding`

### Tenant / Mall POS
`thai_tea_*` (pos_transactions, product_variants, etc.), `whatsapp_template_configs`, `service_packages`, `service_templates`

### AI Task Center
`ai_chat_sessions`, `ai_chat_messages`, `ai_governance_requests`, `intelligence_alerts`, `intelligence_alert_settings`, `internal_tasks`, `wa_ai_intake_log`

### Vendor / Supplier
`suppliers`, `vendor_profiles`, `vendor_catalog_items`, `vendor_catalog_submission_links`, `vendor_catalog_submissions`, `vendor_mini_form_submissions`, `vendor_notifications`, `vendor_performance_*`, `vendor_quote_history`, `vendor_rates`, `vendor_trucking_pricing`, `vendor_installments`, `vendor_fulfillment_links`

### Documents / Storage
`media_assets`, `freight_attachments`, `storage_audit_log`, `correspondences`, `email_correspondences`, `pod_ocr_results`

### Bank / Reconciliation
`bank_mutation_imports`, `bank_loans`, `bank_disbursements`

### Auth / RBAC
`users`, `sessions`, `companies`, `holding_companies`, `user_allowed_companies`, `rbac_roles`, `rbac_permissions`, `custom_roles`, `trusted_devices`, `wa_otp_codes`, `short_links`, `token_access_log`, `admin_action_links`, `activity_logs`, `approval_matrix`, `approval_rules`

### Other / System
`api_response_times`, `audit_reports`, `conversations`, `messages`, `exceptions`, `notification_logs`, `system_error_logs`, `uom`, `products`, `product_bom`, `product_media`, `product_templates`, `inventory`, `stocks`, `warehouse_*` (wh_stock, wh_movements, wh_transfers, wh_damage_reports, wh_returns, wh_opnames), `purchase_requests`, `purchase_approvals`, `vendor_quotations`, `goods_receipts`, `quotation_reply_logs`, `wa_incoming_messages`

---

## FASE 1 — Table Inventory (Sample: Key Tables)

| Table | Domain | Schema File | PK | FK Columns (explicit) | Indexes | company_id | timestamps | status col |
|-------|--------|-------------|----|-----------------------|---------|------------|------------|-----------|
| accounting_journals | accounting | accounting.ts | id | company_id | journal_company_idx | ✓ | created_at | - |
| chart_of_accounts | accounting | accounting.ts | id | company_id | coa_company_code_uniq | ✓ | created_at | - |
| accounting_entries | accounting | accounting.ts | id | journal_id, company_id, account_id | company_idx, date_idx | ✓ | created_at | status (posted/draft) |
| accounting_payments | accounting | accounting.ts | id | journal_id, entry_id, void_entry_id | payments_company_idx | ✓ | created_at | status |
| **payments** | accounting | payments.ts | id | - | **NONE** | **✗** | created_at, updated_at | status |
| **transactions** | accounting | transactions.ts | id | - | **NONE** | created_at | **✗** | - |
| sales_documents | accounting | salesDocuments.ts | id | company_id, customer_id | company_status_idx, customer_idx | ✓ | created_at | status |
| purchase_documents | accounting | purchaseDocuments.ts | id | company_id, supplier_id | status_kind_idx | ✓ | created_at | status |
| cash_advances | accounting | cashAdvances.ts | id | company_id, employee_id | company_idx, status_idx | ✓ | created_at | status |
| expenses | accounting | expenses.ts | id | company_id | company_idx, status_idx | ✓ | created_at | status (text) |
| **bank_mutation_imports** | bank | bankMutationImports.ts | id | company_id | **NONE** | ✓ | created_at | status |
| **stocks** | accounting | stocks.ts | id | product_id, warehouse_id | **NONE** | **✗** | - | - |
| logistic_orders | logistics | logisticOrders.ts | id | company_id, customer_id | company_idx, status_idx, order_num_uniq | ✓ | created_at | status |
| orders | logistics | orders.ts | id | company_id | customer_email_idx, status_idx, company_idx | ✓ | created_at | status |
| mkt_rfqs | marketplace | mktRfqs.ts | id | company_id, portal_customer_id | - | ✓ | created_at | status (text) |
| mkt_purchase_orders | marketplace | mktPurchaseOrders.ts | id | company_id, rfq_id, vendor_id | status_idx | ✓ | created_at | status (enum) |
| drivers | driver | drivers.ts | id | company_id | - | ✓ | created_at | - |
| **driver_jobs** | driver | driverJobs.ts | id | driver_id, order_id | - | **✗** | created_at | status (UPPER enum) |
| portal_customers | portal | portalCustomers.ts | id | - | email_uniq | ✗ | created_at | - |
| customers | portal | customers.ts | id | company_id | - | ✓ | created_at | - |
| suppliers | vendor | suppliers.ts | id | company_id | - | ✓ | created_at | - |
| vendor_profiles | vendor | vendorCatalogEngine.ts | id | company_id, supplier_id | - | ✓ | created_at | verification_status |
| tax_periods | tax | taxAudit.ts | id | company_id | company_idx | ✓ | created_at | status |
| wh_stock | warehouse | warehouse.ts | id | product_id, warehouse_id | product_warehouse_rack_uniq | ✗ | - | - |
| fixed_assets | accounting | fixedAssets.ts | id | company_id | company_idx | ✓ | created_at | status |
| bank_loans | bank | bankLoans.ts | id | company_id | company_idx | ✓ | created_at | status |

---

## FASE 3 — Foreign Key Audit (Missing `.references()`)

| Table | Column | Expected Reference | FK Exists? | Risk |
|-------|--------|--------------------|------------|------|
| **payments** | ref_id | orders / logistic_orders (polymorphic) | ✗ | **High** |
| **transactions** | (all _id cols) | Multiple tables | ✗ | **High** |
| **order_status_history** | order_id | orders | ✗ | High |
| **vendor_fulfillment_links** | order_id | logistic_orders | ✗ | High |
| **vendor_fulfillment_links** | vendor_id | suppliers / vendor_profiles | ✗ | High |
| **pod_ocr_results** | order_id | orders | ✗ | High |
| **vendor_quotations** | rfq_id | purchase_requests | ✗ | Medium |
| **vendor_quotations** | supplier_id | suppliers | ✗ | Medium |
| **goods_receipts** | po_id | purchase_documents | ✗ | Medium |
| **goods_receipts** | supplier_id | suppliers | ✗ | Medium |
| **logistic_order_items** | order_id | logistic_orders | ✗ | High |
| **purchase_document_lines** | document_id | purchase_documents | ✗ | High |
| **sales_document_lines** | document_id | sales_documents | ✗ | High |
| **expense_approvals** | expense_id | expenses | ✗ | Medium |
| **mkt_rfq_lines** | rfq_id | mkt_rfqs | ✗ | Medium |
| **mkt_vendor_quote_lines** | quote_id | mkt_vendor_quotes | ✗ | Medium |
| **mkt_po_goods_receipt_items** | receipt_id | mkt_po_goods_receipts | ✗ | Medium |
| **driver_jobs** | driver_id | drivers | ✗ | Medium |
| **driver_jobs** | order_id | logistic_orders | ✗ | Medium |
| **portal_company_members** | customer_id | portal_customers | ✗ | Medium |
| **vendor_notifications** | vendor_id | suppliers / vendor_profiles | ✗ | Medium |
| **quota­tion_reply_logs** | rfq_id | quote_requests | ✗ | Low |
| **token_access_log** | user_id | users | ✗ | Low |

> **Note:** The absence of `.references()` in Drizzle is intentional in many cases for pgBouncer transaction-mode compatibility (DB-level FKs cause issues). However, **application-level enforcement** must compensate — these represent referential integrity risks if not validated in service layers.

---

## FASE 4 — Multi-Company Isolation Audit

| Table | Has company_id? | Isolation Risk | Recommendation |
|-------|----------------|----------------|----------------|
| **payments** | ✗ | **CRITICAL** | Add company_id column; derive from linked order/document |
| **transactions** | ✗ | **CRITICAL** | Add company_id; all financial queries must be scoped |
| **stocks** | ✗ | **CRITICAL** | Add company_id; inventory must be company-isolated |
| **driver_jobs** | ✗ | **CRITICAL** | Add company_id; cross-company job leakage risk |
| **wh_stock** | ✗ | High | Add company_id or gate via warehouse→company FK |
| **order_status_history** | ✗ | High | Inherits from order; but direct queries bypass scope |
| **pod_ocr_results** | ✗ | High | Inherits from order; direct query bypass risk |
| **vendor_fulfillment_links** | ✗ | High | Add company_id |
| **product_recipes** | ✗ | Medium | Multi-tenant product recipes need isolation |
| **portal_customers** | ✗ | Medium | Global auth table (by design); access via portal_company_members |
| **wa_incoming_messages** | ✗ | Medium | WA messages should be scoped to company |
| **conversations** / **messages** | ✗ | Medium | If multi-tenant, needs company_id |
| accounting_journals | ✓ | Low | OK |
| accounting_entries | ✓ | Low | OK |
| sales_documents | ✓ | Low | OK |
| purchase_documents | ✓ | Low | OK |
| expenses | ✓ | Low | OK |
| cash_advances | ✓ | Low | OK |
| logistic_orders | ✓ | Low | OK |
| mkt_rfqs | ✓ | Low | OK |
| tax_periods | ✓ | Low | OK |
| fixed_assets | ✓ | Low | OK |
| bank_loans | ✓ | Low | OK |

---

## FASE 5 — Index Audit

### Defined Indexes (Key Tables)

| Table | Index | Columns | Type |
|-------|-------|---------|------|
| chart_of_accounts | coa_company_code_uniq | company_id, code | unique |
| accounting_entries | accounting_entries_company_idx | company_id | index |
| accounting_entries | accounting_entries_date_idx | date | index |
| accounting_entry_lines | entry_lines_account_idx | account_id | index |
| logistic_orders | logistic_orders_company_idx | company_id | index |
| logistic_orders | logistic_orders_status_idx | status | index |
| logistic_orders | order_number_uniq | order_number | unique |
| logistic_order_quotes | liq_rfq_vendor_uidx | rfq_id, vendor_id | unique |
| expenses | expenses_company_idx | company_id | index |
| expenses | expenses_status_idx | status | index |
| purchase_documents | purchase_docs_status_idx | status, kind | index |
| sales_documents | sales_docs_customer_idx | customer_id | index |
| sales_documents | sales_docs_company_status_idx | company_id, status | composite |
| wh_stock | wh_stock_product_warehouse_rack_idx | product_id, warehouse_id, rack_id | unique |

### Missing Indexes (High-Impact Queries)

| Query Pattern | Table | Existing Index? | Missing? | Impact |
|---------------|-------|----------------|----------|--------|
| `WHERE ref_id = ? AND ref_kind = ?` | payments | ✗ | **YES** | **High** — every payment status lookup |
| `WHERE order_id = ?` | logistic_order_items | ✗ | **YES** | **High** — every order detail page |
| `WHERE document_id = ?` | purchase_document_lines | ✗ | **YES** | **High** — every PO/invoice detail |
| `WHERE document_id = ?` | sales_document_lines | ✗ | **YES** | **High** — every invoice detail |
| `WHERE rfq_id = ?` | mkt_purchase_orders | ✗ | **YES** | **High** — PO retrieval from RFQ |
| `WHERE email = ?` | logistic_orders | ✗ | **YES** | **High** — public order tracking |
| `WHERE company_id, status` | logistic_orders | Separate only | Composite missing | Medium — dashboard filters |
| `WHERE created_by_id = ?` | purchase_documents | ✗ | **YES** | Medium — "my documents" portal |
| `WHERE driver_id = ?` | driver_jobs | ✗ | **YES** | Medium — driver job list |
| `WHERE is_active = ?` | drivers | ✗ | **YES** | Low — active driver filter |
| `WHERE token_hash = ?` | admin_action_links | ✗ | **YES** | Medium — token verification |

---

## FASE 6 — Status / Enum Consistency

| Table | Column | Type | Values | Risk |
|-------|--------|------|--------|------|
| driver_jobs | status | pgEnum | `ASSIGNED`, `ACCEPTED`, `ON_THE_WAY_TO_PICKUP`, `ARRIVED_AT_PICKUP`, `PICKED_UP`, `DELIVERED` | **CRITICAL** — UPPER_SNAKE_CASE unlike all other tables |
| customer_verification_docs | verificationStatus | text array check | `UPLOADED`, `VERIFIED`, `REJECTED` | High — UPPERCASE, camelCase column name |
| mkt_rfqs | status | text | `draft`, `waiting_approval`, `submitted`, `rejected` | Medium — plain text, no enum |
| mkt_purchase_orders | status | pgEnum | `pending`, `vendor_confirmed`, `vendor_rejected`, `shipping`, `completed`, `cancelled` | OK (formal enum) |
| freight_shipments | status | pgEnum | `draft`, `rfq_sent`, `confirmed`, `in_transit`, `completed`, `cancelled` | OK (formal enum) |
| expenses | status | text | `draft` (default only) | Medium — no enum, values inferred |
| expense_approvals | status | text | `pending`, `l1_approved`, `l2_approved`, `approved`, `rejected` | Medium — hierarchical text states |
| wh_transfers | status | pgEnum | `draft`, `in_transit`, `received`, `cancelled` | OK |
| wh_opname | status | text | `draft` (default) | Medium — same file as enum tables |
| fleet_vehicles | status | text | `active` | Low — single value as text |
| fleet_outstanding | status | text | `open` | Low — inconsistent with `active` used elsewhere |
| vendor_installments | status | text | `active`, `partial`, `paid` | Medium — no enum, no index |
| vendor_catalog | status | text | `submitted`, `approved`, `rejected` | Low — consistent values at least |
| mkt_po_shipments | shipmentStatus | text | `planned`, `warehouse`, `arrived`, `delivered`, `cancelled` | Medium — camelCase column, text not enum |
| vendor_mini_form | phase | text | `quotation` | Low — uses "phase" not "status" |
| portal_quick_quotes | status | text | `new` | Medium — "new" vs "draft" vs "pending" elsewhere |
| customer_service_requests | status | text | `draft`, `submitted`, `reviewing`, `quoted`, `approved`, `rejected`, `cancelled` | Low — consistent, though text |

**Summary of enum inconsistencies:**
1. `driver_jobs.status` uses `UPPER_SNAKE_CASE` — only table in the entire schema to do so
2. `customer_verification_docs.verificationStatus` uses `UPPERCASE` + camelCase column name
3. ~60% of status columns are plain `text` without pgEnum; the remaining 40% use formal enums — no consistent standard
4. Completion semantics conflict: `completed` vs `received` vs `delivered` vs `paid` vs `closed`
5. Active state: `active` vs `open` vs `new` used interchangeably across tables

---

## FASE 7 — Token / Magic Link Security Audit

| Table | Token Column | Hashed? | expires_at | used_at | revoked_at | Rate Limit | Risk |
|-------|-------------|---------|------------|---------|------------|------------|------|
| sessions | sid | ✗ Plaintext | expire ✓ | ✗ | ✗ | ✗ | Medium — express-session managed; DB exposure = hijack |
| **trusted_devices** | device_token | **✗ Plaintext** | expires_at ✓ | ✗ | ✗ | ✗ | **High** — long-lived plaintext token |
| wa_otp_codes | code_hash | ✓ (OTP) | expires_at ✓ | verified (bool) ✓ | ✗ | attempts ✓ | Low — OTP well-secured |
| **wa_otp_codes** | **verify_token** | **✗ Plaintext** | expires_at ✓ | ✗ | ✗ | ✗ | **High** — second token column is plaintext |
| short_links | code | ✗ Plaintext | expires_at ✓ | hit_count ✓ | ✗ | ✗ | Medium — enumerable if sequential |
| **admin_action_links** | token (legacy) | **✗ Plaintext** | expires_at ✓ | used_at ✓ | revoked_at ✓ | ✗ | **High** — legacy `token` column plaintext; `token_hash` added later but old column remains |
| **mkt_rfqs** | guest_token | **✗ Plaintext** | **✗ No expiry** | guest_claimed_at ✓ | ✗ | ✗ | **Critical** — plaintext, never expires, guest portal access |
| rfq_vendor_links | invite_token | ✗ (check schema) | ✓ | ✓ | ✗ | ✗ | Medium — vendor invite links |
| portal_customers | (auth handled via sessions) | — | — | — | — | — | Low |

**Critical finding:** `mkt_rfqs.guest_token` is stored plaintext with NO expiry. A leaked token grants permanent guest access to an RFQ. Minimum fix: add `expires_at` + schedule cleanup.

---

## FASE 8 — Orphan / Unused Tables

| Table | Schema File | Evidence of Use | Risk | Recommendation |
|-------|-------------|----------------|------|----------------|
| **conversations** | conversations.ts | No route found | Medium | Cross-check with WA workers; may be legacy chat |
| **messages** | messages.ts | No route found | Medium | Cross-check with WA workers; may be legacy chat |
| **wa_ai_intake_log** | waAiIntakeLog.ts | No direct route found | Low | May be used by WA webhook worker, not a REST route |
| api_response_times | apiResponseTimes.ts | Middleware logging | Low | Keep — performance monitoring |
| audit_reports | auditReports.ts | auditReports.ts route | Low | Keep — active |
| storage_audit_log | storageAuditLog.ts | storage route | Low | Keep — active |
| quotation_reply_logs | quotationReplyLogs.ts | whatsapp route | Low | Keep — active |
| exceptions | exceptions.ts | exceptions.ts route | Low | Keep — active |
| fleet_intelligence | fleetIntelligence.ts | Worker only (no REST?) | Low | Verify worker usage |

---

## FASE 9 — Risk Matrix

### 🔴 CRITICAL

| Finding | Tables Affected | Description |
|---------|----------------|-------------|
| **payments table has no company_id** | `payments` | Every payment record is globally accessible across companies. Add `company_id` before multi-tenant scale. |
| **transactions table has no company_id** | `transactions` | Core financial table — cross-company data leakage risk. |
| **stocks table has no company_id** | `stocks` | Inventory visible across companies — financial misstatement risk. |
| **driver_jobs has no company_id** | `driver_jobs` | Job assignments from different companies could cross-contaminate. |
| **mkt_rfqs.guest_token is plaintext + never expires** | `mkt_rfqs` | Permanent marketplace guest access token. If leaked: perpetual unauthorized access. |
| **5 competing "Order" table concepts** | `orders`, `logistic_orders`, `mkt_purchase_orders`, `portal_product_orders`, `ppjk_orders` | Fragmented order domain — no single source of truth, reporting errors, FK gaps. |

---

### 🟠 HIGH

| Finding | Tables Affected | Description |
|---------|----------------|-------------|
| **payments.ref_id has no index + no FK** | `payments` | Every payment status lookup = sequential scan. Performance + integrity risk. |
| **Line-item tables have no index on parent FK** | `logistic_order_items`, `purchase_document_lines`, `sales_document_lines` | Every detail page triggers sequential scan. |
| **trusted_devices.device_token plaintext** | `trusted_devices` | Long-lived device token stored unhashed. DB read = account takeover. |
| **wa_otp_codes.verify_token plaintext** | `wa_otp_codes` | Second token column in OTP table is unhashed. |
| **admin_action_links legacy `token` column** | `admin_action_links` | Old plaintext column alongside new `token_hash`. Must be dropped or nulled. |
| **portal_customers ↔ customers not linked** | `portal_customers`, `customers` | Auth entity and billing entity are disconnected. Same person = 2 records. |
| **4 competing "Quote" table concepts** | `quote_requests`, `portal_quick_quotes`, `mkt_rfqs`, `customer_quote_links` | No unified quote lifecycle. Duplicated ~90% schema between `quote_requests` and `portal_quick_quotes`. |
| **vendor_fulfillment_links has no FKs** | `vendor_fulfillment_links` | Links order to vendor without enforced references. Orphan rows accumulate silently. |
| **logistic_orders.email not indexed** | `logistic_orders` | Public order tracking uses email lookup — full table scan for guests. |
| **mkt_purchase_orders.rfq_id not indexed** | `mkt_purchase_orders` | PO lookup from RFQ context = sequential scan. |

---

### 🟡 MEDIUM

| Finding | Tables Affected | Description |
|---------|----------------|-------------|
| **driver_jobs.status uses UPPER_SNAKE_CASE** | `driver_jobs` | Only table with uppercase enum — every status comparison requires explicit casing. |
| **customer_verification_docs uses UPPERCASE** | `customer_verification_docs` | Inconsistent with rest of codebase. |
| **~60% of status columns are untyped text** | 20+ tables | No DB-level constraint on allowed values; any string accepted. |
| **accounting_payments vs payments** | `payments`, `accounting_payments` | Dual payment concept — gateway vs ledger. No enforced 1:1 mapping. |
| **suppliers vs vendor_profiles** | `suppliers`, `vendor_profiles` | Two vendor master concepts. `vendor_profiles` has supplier_id FK but relationship semantics unclear. |
| **wh_stock no company_id** | `wh_stock` | Warehouse stock isolation depends entirely on warehouse→company chain. |
| **purchase_documents.created_by_id not indexed** | `purchase_documents` | "My documents" portal filter = sequential scan. |
| **logistic_orders missing composite (company_id, status)** | `logistic_orders` | Dashboard filters use both columns but no composite index. |
| **conversations / messages may be orphaned** | `conversations`, `messages` | No route usage found. May be legacy. |
| **short_links.code potentially enumerable** | `short_links` | No revocation mechanism. Sequential/predictable codes risk. |

---

### 🟢 LOW

| Finding | Tables Affected | Description |
|---------|----------------|-------------|
| **drivers.is_active not indexed** | `drivers` | Minor — small table. |
| **`cancelled` spelling consistent** | warehouse, freight, marketplace | Good — at least this is consistent. |
| **wa_ai_intake_log possibly orphaned** | `wa_ai_intake_log` | May be worker-only; verify before cleanup. |
| **fleet_outstanding uses `open` for active state** | `fleet_outstanding` | Inconsistent with `active` used elsewhere. |
| **portal_quick_quotes uses `new` as initial state** | `portal_quick_quotes` | Inconsistent with `draft` used in other modules. |
| **vendor_mini_form uses `phase` not `status`** | `vendor_mini_form_submissions` | Column naming inconsistency. |
| **token_access_log.user_id has no FK** | `token_access_log` | Log table — low risk, but orphan entries accumulate. |

---

## Recommended Migration Plan

> ⚠️ Semua tahap di bawah ini adalah **rekomendasi**. Tidak ada yang dieksekusi dalam audit ini.

### Tahap 1 — Security & Isolation (Lakukan Segera)

1. **`payments` + `transactions` + `stocks` + `driver_jobs`**: Tambah kolom `company_id NOT NULL` via additive migration. Isi dari parent record, lalu tambah index.
2. **`mkt_rfqs.guest_token`**: Tambah kolom `guest_token_expires_at TIMESTAMPTZ`. Update semua existing rows ke `NOW() + 30 days`. Tambah cleanup worker.
3. **`admin_action_links.token`** (legacy plaintext): Set ke NULL semua expired rows. Drop atau deprecate kolom setelah migration `token_hash` verified.
4. **`trusted_devices.device_token`**: Hash semua existing tokens (salted HMAC). Ubah read path ke hash comparison.
5. **`wa_otp_codes.verify_token`**: Hash token baru. Migrate existing bila ada yang active.

### Tahap 2 — Foreign Keys & Indexes

1. Tambah index: `payments(ref_id, ref_kind)`, `logistic_order_items(order_id)`, `purchase_document_lines(document_id)`, `sales_document_lines(document_id)`, `mkt_purchase_orders(rfq_id)`, `logistic_orders(email)`.
2. Tambah composite index: `logistic_orders(company_id, status)`.
3. Tambah index: `driver_jobs(driver_id)`, `driver_jobs(order_id)`, `purchase_documents(created_by_id)`.
4. Tambah application-level FK enforcement di service layer untuk: `vendor_fulfillment_links`, `pod_ocr_results`, `order_status_history`.

### Tahap 3 — Domain Overlap Consolidation

1. **Link `portal_customers` ↔ `customers`**: Tambah `customers.portal_customer_id FK` atau sebaliknya. Sync pada verification approval.
2. **Quote consolidation**: Migrate `quote_requests` + `portal_quick_quotes` ke `mkt_rfqs` dengan `channel` column (web/portal/whatsapp). Archive old tables.
3. **Vendor master**: Clarify `suppliers` vs `vendor_profiles` — tentukan mana source of truth, buat FK eksplisit.
4. **`accounting_payments` ↔ `payments` mapping**: Enforced via trigger atau service-layer constraint.

### Tahap 4 — Status Enum Standardization & Cleanup

1. **`driver_jobs.status`**: Migrate ke lowercase `snake_case` enum. Update semua consumers.
2. **`customer_verification_docs.verificationStatus`**: Lowercase. Rename ke `verification_status`.
3. Buat shared pgEnum definitions di `lib/db/src/schema/enums.ts` untuk: approval_status, document_status, payment_status. Migrate high-risk tables.
4. **Orphan cleanup**: Evaluate `conversations`, `messages`, `wa_ai_intake_log` — archive jika tidak dipakai.

---

## Do Not Change Yet (Butuh Approval Manual)

| Item | Alasan |
|------|--------|
| Drop `orders` table | Might still have historical data; need data migration plan |
| Merge `ppjk_orders` into `logistic_orders` | PPJK has unique customs fields (HS code, PIB, BC form); needs domain expert sign-off |
| Consolidate all quote tables | `mkt_rfqs` as replacement needs portal_quick_quotes migration plan |
| Remove `transactions` table | Need to verify if any external system writes directly to this table |
| Hash `sessions.sid` | express-session manages this; changes require framework-level decision |
| Drop `conversations` / `messages` | Need to confirm no WA workers write to these |
| `wh_stock` company isolation | Must trace warehouse→branch→company chain first to verify current isolation |

---

*Audit selesai. Tidak ada perubahan dilakukan pada schema, migration, atau kode.*
