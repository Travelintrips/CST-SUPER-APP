---
name: Enterprise DB Patch Phase 1
description: Company isolation + token security + index hardening — schema, boot migration, service/route changes applied 2026-07-07
---

## What was applied (additive only, no drops, no NOT NULL enforced yet)

### 1A — Company isolation
- `payments`, `transactions`, `stocks`, `driver_jobs`: added nullable `company_id INTEGER`
- Indexes: `payments_company_idx`, `transactions_company_idx`, `stocks_company_idx`, `driver_jobs_company_idx` (all partial WHERE IS NOT NULL)
- Backfill in boot migration: `driver_jobs.company_id` from `logistic_orders` via `logistic_order_id`; `payments.company_id` from `sales_documents` (ref_kind='sales') and `logistic_orders` (ref_kind='logistic')
- `transactions` and `stocks` have no clear backfill parent — remain NULL; document as known gap

### 1B — Token security (hash-first, plaintext fallback during transition)
- `mkt_rfqs`: added `guest_token_hash TEXT`, `guest_token_expires_at TIMESTAMPTZ`; index `mkt_rfqs_guest_token_hash_idx`
- `trusted_devices`: added `device_token_hash TEXT`; index `trusted_devices_token_hash_idx`
- `wa_otp_codes`: added `verify_token_hash TEXT`; index `wa_otp_verify_token_hash_idx`
- `admin_action_links`: added index `admin_action_links_token_hash_idx` on existing `token_hash` column
- `marketplaceRfqService.ts`: hashes guestToken → guestTokenHash; sets guestTokenExpiresAt = now + 30d
- `portalAuthService.ts`: hashes verifyToken on issue; hashes deviceToken on create; hash-first lookup (OR isNull fallback) for both; invalidation clears BOTH verifyToken + verifyTokenHash + forces expiresAt=epoch (true single-use)
- `adminAction.ts`: `adminTokenWhere(raw)` helper — `OR(token_hash=hash, isNull(token_hash) AND token=raw)`; applied to all 6 SELECT + UPDATE claim sites

### 1C — Missing indexes
- `payments_ref_idx` on `(ref_kind, ref_id)`
- `logistic_order_items_order_idx` on `logistic_order_items(order_id)`
- `sales_doc_lines_doc_idx` on `sales_document_lines(document_id)`
- `driver_jobs_driver_idx`, `driver_jobs_logistic_order_idx`
- `admin_action_links_order_idx`

## Key rules for future work
- **Never drop plaintext columns** (`token`, `deviceToken`, `verifyToken`, `guestToken`) until all rows have a hash and all consumers are hash-only
- `adminTokenWhere()` in adminAction.ts must be used for ALL lookups — do not add new `eq(adminActionLinksTable.token, ...)` calls
- `verifyTokenHash` must be nulled simultaneously with `verifyToken` on consume (single-use enforcement)
- Phase 2 work: enforce `NOT NULL` on company_id columns after validating backfill completeness; add FK to `companies.id`
