---
name: Marketplace Phase 2B + 2B.1 — Buyer Identity & Organization
description: How portal_customer_id and company_id are resolved for mkt_rfqs; buyer org snapshot pattern; gate rules.
---

## Rule — Feature Flag Gate
ALL Phase 2B/2B.1 enrichment (customer lookup + membership lookup) MUST live INSIDE the `if (newPipelineEnabled)` gate in portal.ts. Outside the gate = flag=false legacy path, which must be IDENTICAL to original. This was the critical failure in the first code review.

**Why:** FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE is a hard boundary.

## Auth Block (before flag gate — unchanged from original)
- Resolves `portalEmailFromToken: string | null` only.
- Priority: portalJwt → devportal token → Supabase token.
- All token failures: catch → `portalEmailFromToken = null`.

## Inside newPipelineEnabled gate — Phase 2B
1. Lookup `portal_customers` by `portalEmailFromToken` → `portalCustomer { id, email, name, phone, company }`.
2. Non-fatal: failure → `portalCustomer = null` (guest).

## Inside newPipelineEnabled gate — Phase 2B.1
3. If `portalCustomer != null`: query `portal_company_members` WHERE `portal_customer_id = portalCustomer.id AND is_active = true` ORDER BY `created_at ASC` LIMIT 1.
4. Non-fatal: failure or no row → `membershipCtx = null` → `company_id = null`.
5. Pass `companyId, buyerRole, buyerDepartment, buyerCostCenter, buyerApprovalLevel` from membershipCtx to `createMktRfqEntry()`.

## isGuest logic in marketplaceRfqService.ts
`isGuest = !opts.companyId && !opts.portalCustomerId`
Guest token generated only when both are null. buyer_role etc do NOT affect isGuest.

## Schema
- `portal_company_members` — bridge table. Migration 0016. UNIQUE (portal_customer_id, company_id).
- `mkt_rfqs.portal_customer_id` — FK to portal_customers. Migration 0015.
- `mkt_rfqs.company_id` — FK to companies. NOW FILLED if membership exists.
- `mkt_rfqs.buyer_role/department/cost_center/approval_level` — immutable snapshot. Migration 0016.
- buyer_role stored as TEXT (not pgEnum) — extensible without DDL.

## Multi-company edge case
Buyer dengan banyak company → ORDER BY created_at ASC LIMIT 1 (oldest = primary). Document as explicit business rule if this changes.

## Activity logs
- `mkt_rfq_created`: always fired; includes companyId + all buyer_* in newValue.
- `mkt_rfq_buyer_linked`: fired only when portalCustomerId set; includes hasCompanyMapping flag.
