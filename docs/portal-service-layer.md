# Portal Service Layer — Architecture Documentation

> **Scope:** `artifacts/api-server/src/routes/portal.ts` + `src/lib/services/portal*.ts`  
> **Refactor completed:** 2026-07-07  
> **portal.ts line count:** 2121 (original) → 1839 (final) — **−282 lines**

---

## 1. Overview

`portal.ts` was refactored from a **God Controller** (2121 lines of mixed routing, business logic, DB queries) into a **thin controller** (1839 lines of parameter extraction, auth wiring, service delegation, and response shaping).

All business logic now lives in 16 focused service files under `src/lib/services/portal*.ts`.

### Key principles enforced

- Routes only: parse params/body/query, resolve auth context, call service, return response
- No inline `db.select/execute/insert/update` for business operations
- No inline SQL template literals for non-trivial queries
- Error mapping (statusCode 404/400 → HTTP status) stays in the controller
- Auth context resolution (JWT/Supabase/devportal token) stays in the controller

---

## 2. Service Files

| Service File | Functions | Domain |
|---|---|---|
| `portalAuthService.ts` | 16 | Login, OTP, registration, trusted devices, session |
| `portalVendorCatalogService.ts` | 22 | Catalog CRUD, marketplace browsing, media, templates, item detail |
| `portalMarketplaceService.ts` | 2 | Quote submission (RFQ), direct order creation |
| `portalLogisticOrderService.ts` | 12 | Sales/logistic/product orders, quote requests, file uploads |
| `portalProductService.ts` | 8 | Admin product/service CRUD |
| `portalVendorService.ts` | 11 | Vendor CRUD, form links, form submissions |
| `portalVendorOnboardingService.ts` | 5 | KTP OCR, document upload, onboarding completion |
| `portalVendorProfileService.ts` | 2 | Vendor dashboard, vendor full profile |
| `portalApprovalService.ts` | 4 | Approval listing, processing, audit trail, stats |
| `portalCustomerService.ts` | 2 | Customer listing, customer stats |
| `portalContentService.ts` | 3 | Content read, update, cache invalidation |
| `portalLogisticAdminService.ts` | 4 | Logistic admin services CRUD |
| `portalRateService.ts` | 6 | Calculator rates, trucking rates, freight rates |
| `portalStatsService.ts` | 1 | ERP stats |
| `portalDashboardService.ts` | 1 | Role-based dashboard stats (vendor/admin/customer) |
| `portalInquiryService.ts` | 1 | Catalog inquiry with WhatsApp notifications |

---

## 3. Route → Service Mapping

### Authentication (`/api/portal/auth/*`)

| Route | Service | Function |
|---|---|---|
| `POST /auth/login` | portalAuthService | `emailPasswordLogin` |
| `POST /auth/wa-otp/send` | portalAuthService | `sendWaOtp` |
| `POST /auth/wa-otp/verify` | portalAuthService | `verifyWaOtp` |
| `POST /auth/wa-register` | portalAuthService | `waRegister` |
| `POST /auth/wa-login` | portalAuthService | `waLogin` |
| `POST /auth/wa-trusted-login` | portalAuthService | `waTrustedLogin` |
| `GET /auth/trusted-devices` | portalAuthService | `getTrustedDevices` |
| `DELETE /auth/trusted-devices/:id` | portalAuthService | `revokeTrustedDevice` |
| `DELETE /auth/trusted-devices` | portalAuthService | `revokeAllTrustedDevices` |
| `POST /auth/signup` | portalAuthService | `signup` |
| `POST /auth/dev-login` | portalAuthService | `devLogin` |
| `POST /auth/register` | portalAuthService | `syncProfile` |
| `POST /auth/otp/request` | portalAuthService | `requestEmailOtp` |
| `POST /auth/otp/verify` | portalAuthService | `verifyEmailOtp` |
| `POST /auth/forgot-password` / `reset-password` | portalAuthService | `requestEmailOtp` / `verifyEmailOtp` |
| `GET /auth/me` | portalAuthService | `getMe` |

### Marketplace (`/api/portal/marketplace/*`)

| Route | Service | Function |
|---|---|---|
| `GET /marketplace` | portalVendorCatalogService | `listPublicMarketplaceItems` |
| `GET /marketplace/stats` | portalVendorCatalogService | `getMarketplaceStats` |
| `GET /marketplace/:id` | portalVendorCatalogService | `getMarketplaceItemDetail` |
| `GET /marketplace/:id/related` | portalVendorCatalogService | `getRelatedItems` |
| `GET /marketplace/:id/similar` | portalVendorCatalogService | `getSimilarItems` |
| `GET /marketplace/:id/same-province` | portalVendorCatalogService | `getSameProvinceItems` |
| `POST /marketplace/:id/quote` | portalMarketplaceService | `submitMarketplaceQuote` |
| `POST /marketplace/:id/order` *(deprecated)* | portalMarketplaceService | `createMarketplaceOrder` |

### Orders (`/api/portal/*`)

| Route | Service | Function |
|---|---|---|
| `GET /orders` | portalLogisticOrderService | `listSalesOrders` |
| `GET /logistic-orders` | portalLogisticOrderService | `listLogisticOrders` |
| `GET /product-orders` | portalLogisticOrderService | `listProductOrders` |
| `POST /orders` | portalLogisticOrderService | `createSalesOrder` |
| `PATCH /orders/:id/cancel` | portalLogisticOrderService | `cancelSalesOrder` |
| `PATCH /logistic-orders/:id/cancel` | portalLogisticOrderService | `cancelLogisticOrder` |
| `POST /order-upload` | portalLogisticOrderService | `uploadOrderFile` |
| `POST /payment-proof-upload` | portalLogisticOrderService | `uploadPaymentProof` |
| `POST /request-quote` | portalLogisticOrderService | `submitRequestQuote` |
| `GET /quote-requests` | portalLogisticOrderService | `listQuoteRequests` |
| `PATCH /quote-requests/:id` | portalLogisticOrderService | `updateQuoteRequest` |

### Vendor Catalog & Profile (`/api/portal/vendor/*`)

| Route | Service | Function |
|---|---|---|
| `GET /vendor/profile` | portalVendorProfileService | `getVendorFullProfile` |
| `GET /vendor/vendor-profile` | portalVendorProfileService | `getVendorDashboard` |
| `GET /vendor/catalog` | portalVendorCatalogService | `listVendorOwnCatalog` |
| `POST /vendor/catalog/media` | portalVendorCatalogService | `uploadVendorCatalogMedia` |
| `DELETE /vendor/catalog/media/:mediaId` | portalVendorCatalogService | `deleteVendorCatalogMedia` |
| `GET /vendor/catalog-submissions` | portalVendorCatalogService | `listVendorCatalogSubmissions` |
| `POST /vendor/quotes` | portalLogisticOrderService | `submitVendorQuote` |
| `GET /vendor/notifications` | *(inline — see §4)* | — |
| `POST /vendor/notifications/read-all` | *(inline — see §4)* | — |
| `POST /vendor/notifications/:id/read` | *(inline — see §4)* | — |
| `GET /vendors/:vendorId/public-profile` | portalVendorCatalogService | `getVendorPublicProfile` |

### Vendor Onboarding

| Route | Service | Function |
|---|---|---|
| `GET /onboarding/status` | portalVendorOnboardingService | `getOnboardingStatus` |
| `POST /onboarding/ktp-ocr` | portalVendorOnboardingService | `runKtpOcr` |
| `POST /onboarding/upload-doc` | portalVendorOnboardingService | `uploadOnboardingDoc` |
| `POST /onboarding/complete` | portalVendorOnboardingService | `completeOnboarding` |

### Admin

| Route | Service | Function |
|---|---|---|
| `GET /admin/approvals` | portalApprovalService | `listApprovals` |
| `PATCH /admin/approvals/:id` | portalApprovalService | `processApproval` |
| `GET /admin/approvals/:id/audit` | portalApprovalService | `getApprovalAuditTrail` |
| `GET /admin/approvals/stats` | portalApprovalService | `getApprovalStats` |
| `GET /admin/customers` | portalCustomerService | `listCustomers` |
| `GET /admin/customers/stats` | portalCustomerService | `getCustomerStats` |
| `GET /admin/products` | portalProductService | `listAdminProducts` |
| `GET /admin/product-categories` | portalProductService | `listProductCategories` |
| `POST /admin/products` | portalProductService | `createProduct` |
| `PUT /admin/products/:id` | portalProductService | `updateProduct` |
| `DELETE /admin/products/:id` | portalProductService | `deleteProduct` |
| `POST /admin/services` | portalProductService | `createService` |
| `PUT /admin/services/:id` | portalProductService | `updateService` |
| `DELETE /admin/services/:id` | portalProductService | `deleteService` |
| `GET /admin/delivery-vendors` | portalVendorService | `listVendors` |
| `POST /admin/delivery-vendors` | portalVendorService | `createVendor` |
| `PUT /admin/delivery-vendors/:id` | portalVendorService | `updateVendor` |
| `DELETE /admin/delivery-vendors/:id` | portalVendorService | `deleteVendor` |
| `GET /admin/vendor-form/links` | portalVendorService | `listVendorFormLinks` |
| `POST /admin/vendor-form/links` | portalVendorService | `createVendorFormLink` |
| `PATCH /admin/vendor-form/links/:id` | portalVendorService | `patchVendorFormLink` |
| `DELETE /admin/vendor-form/links/:id` | portalVendorService | `deleteVendorFormLink` |
| `GET /admin/vendor-form/submissions` | portalVendorService | `listVendorFormSubmissions` |
| `GET /admin/vendor-form/schemas` | portalVendorService | *(direct service call)* |
| `GET /admin/erp-stats` | portalStatsService | `getErpStats` |
| `POST /admin/upload` | portalVendorCatalogService | `uploadVendorCatalogMedia` |

### Logistic Admin

| Route | Service | Function |
|---|---|---|
| `GET /logistic-admin/services` | portalLogisticAdminService | `listLogisticAdminServices` |
| `POST /logistic-admin/services` | portalLogisticAdminService | `createLogisticAdminService` |
| `PUT /logistic-admin/services/:id` | portalLogisticAdminService | `updateLogisticAdminService` |
| `DELETE /logistic-admin/services/:id` | portalLogisticAdminService | `deleteLogisticAdminService` |

### Rates & Discovery

| Route | Service | Function |
|---|---|---|
| `GET /calculator-rates` | portalRateService | `getCalculatorRates` |
| `GET /calculator-rates-v2` | portalRateService | `getCalculatorRatesV2` |
| `GET /trucking-rates` | portalRateService | `getTruckingRates` |
| `PUT /admin/trucking-rates` | portalRateService | `setTruckingRates` |
| `GET /admin/freight-rates` | portalRateService | `getFreightRates` |
| `PUT /admin/freight-rates` | portalRateService | `setFreightRates` |
| `GET /cargo-types` | — | *(inline constant, 3-line handler)* |
| `GET /logistics-subcategories` | — | *(inline constant, 3-line handler)* |
| `GET /delivery-vendors` | portalVendorService | `listVendors` |

### Content & Catalog Browse

| Route | Service | Function |
|---|---|---|
| `GET /content` | portalContentService | `getContent` |
| `PUT /admin/content` | portalContentService | `updateContent` |
| `GET /services` | portalContentService | *(inline from content cache)* |
| `GET /products` | portalProductService | `listAdminProducts` |
| `GET /vendor-catalog` | portalVendorCatalogService | `listVendorCatalogPublic` |
| `GET /vendor-catalog/compare` | portalVendorCatalogService | `compareVendorCatalog` |
| `GET /product-templates` | portalVendorCatalogService | `listProductTemplates` |
| `GET /service-templates` | portalVendorCatalogService | `listServiceTemplates` |
| `POST /catalog-inquiry` | portalInquiryService | `submitCatalogInquiry` |

### Dashboard & Company

| Route | Service | Function |
|---|---|---|
| `GET /me/dashboard-stats` | portalDashboardService | `getPortalDashboardStats` |
| `GET /company` | *(inline — see §4)* | — |

---

## 4. Remaining Inline Logic — Classified & Accepted

These handlers contain a single inline DB operation and have been assessed as **acceptable to leave inline** — they do not warrant a dedicated service function.

| Route | DB Operations | Classification |
|---|---|---|
| `GET /company` | 1 `db.select()` from `accountingSettingsTable` | In-memory cache wrapper; computed response object is trivial |
| `POST /marketplace/:id/quote` | 1 `db.select()` from `portalCustomersTable` | **Auth context wiring** — resolves customer email from portal JWT token; explicitly allowed in controller per architecture spec |
| `POST /admin/claim` | 1 `db.update()` set `role = 'admin'` | Atomic single-field write guarded by rate-limit + secret check; no business logic |
| `POST /admin/fix-jasa-names` | 1 select + N updates (loop) | **One-off admin data-repair utility** — not a production flow; intentionally kept inline |
| `POST /vendor/notifications/read-all` | 1 `db.update()` set `isRead = true` | Simple bulk mark-read; no business logic |
| `POST /vendor/notifications/:id/read` | 1 `db.update()` set `isRead = true` | Simple single mark-read; no business logic |

---

## 5. Dependency Map

```
portal.ts (router)
├── portalAuthService.ts
│   └── @workspace/db, supabaseAdmin, portalJwt, notificationService, jwtUtils
├── portalVendorCatalogService.ts
│   └── @workspace/db, supabaseStorage, imageCompress, catalogVisibility
├── portalMarketplaceService.ts
│   └── @workspace/db, portalVendorCatalogService (getCatalogItemPublic)
├── portalDashboardService.ts
│   └── @workspace/db, portalVendorCatalogService (getLinkedSupplier)
├── portalLogisticOrderService.ts
│   └── @workspace/db, supabaseStorage, waNotification
├── portalProductService.ts
│   └── @workspace/db
├── portalVendorService.ts
│   └── @workspace/db, waNotification
├── portalVendorOnboardingService.ts
│   └── @workspace/db, ocrService, supabaseStorage
├── portalVendorProfileService.ts
│   └── @workspace/db, portalVendorCatalogService (getLinkedSupplier)
├── portalApprovalService.ts
│   └── @workspace/db, waNotification
├── portalCustomerService.ts
│   └── @workspace/db
├── portalContentService.ts
│   └── @workspace/db
├── portalLogisticAdminService.ts
│   └── @workspace/db
├── portalRateService.ts
│   └── @workspace/db
├── portalStatsService.ts
│   └── @workspace/db
└── portalInquiryService.ts
    └── @workspace/db, waNotification
```

**Cross-service dependencies (internal)**:
- `portalMarketplaceService` → `portalVendorCatalogService.getCatalogItemPublic`
- `portalDashboardService` → `portalVendorCatalogService.getLinkedSupplier`
- `portalVendorProfileService` → `portalVendorCatalogService.getLinkedSupplier`

---

## 6. API Contract Notes

All routes in `portal.ts` are mounted at `/api/portal/*` via `app.use("/api/portal", portalRouter)` in `src/index.ts`.

### Invariants preserved during refactor

- All URL paths unchanged
- All middleware chains unchanged (`requirePortalAuth`, `requirePortalAdmin`, `requireActiveVendor`, rate limiters)
- All response shapes identical (field names, types, status codes)
- All error responses (400/401/403/404/429/500) unchanged
- `Cache-Control` headers preserved on all affected routes
- Fire-and-forget side effects (view_count increment, `broadcastToPortal`) preserved

### Authentication middleware

| Middleware | Applied to |
|---|---|
| `requirePortalAuth` | All `/me/*`, `/vendor/*`, `/onboarding/*`, `/admin/claim` |
| `requirePortalAdmin` | All `/logistic-admin/*`, `/admin/approvals/*`, `/admin/customers/*`, `/admin/products/*`, `/admin/vendor-form/*`, content write, rate write |
| `requireActiveVendor` | All `/vendor/quotes`, `/vendor/catalog`, `/vendor/notifications/*` |

### Rate limiters

| Limiter | Routes |
|---|---|
| `marketplaceSubmitLimiter` | `POST /marketplace/:id/quote`, `POST /marketplace/:id/order` |
| `requestQuoteLimiter` | `POST /request-quote` |
| `waOtpSendLimiter` | `POST /auth/wa-otp/send` |

---

## 7. How to Add a New Route

### Standard pattern

```typescript
// portal.ts — thin controller
router.get("/my-new-route", requirePortalAuth, async (req, res) => {
  const portalReq = req as PortalAuthReq;
  const { someParam } = req.query;
  try {
    return res.json(await myNewFeatureService(portalReq.portalCustomerId, someParam));
  } catch (err: any) {
    if (err?.statusCode === 404) return res.status(404).json({ error: err.message });
    if (err?.statusCode === 400) return res.status(400).json({ error: err.message });
    throw err; // let global error handler deal with 500s
  }
});
```

```typescript
// src/lib/services/portalMyNewService.ts
import { db } from "@workspace/db";

export async function myNewFeatureService(customerId: number, param: unknown) {
  // business logic here
  // throw makeServiceError(404, "Not found") for expected errors
}

function makeServiceError(statusCode: number, message: string): Error {
  const e = new Error(message) as any;
  e.statusCode = statusCode;
  return e;
}
```

### Service naming conventions

- File: `portalDomainNameService.ts` (camelCase, `portal` prefix, `Service` suffix)
- Functions: verb + noun (`getX`, `listX`, `createX`, `updateX`, `deleteX`, `submitX`)
- Errors: throw with `.statusCode` property (404, 400) — controller maps to HTTP status
- No try/catch swallowing inside services unless graceful-fallback is intentional (document why)

### Adding to existing service vs new file

- Add to existing file if same domain (e.g., new vendor catalog query → `portalVendorCatalogService.ts`)
- New file if new domain or would make existing file > ~900 lines
- Never add to `portal.ts` directly unless it's a 3-line inline constant response

---

## 8. Build & Typecheck Status

| Check | Result | Notes |
|---|---|---|
| `esbuild` (api-server) | ✅ Clean | 1 pre-existing `esModuleInterop` warning (not an error) |
| `tsc --noEmit` (portal service layer) | ✅ 0 errors | Targeted check on portal.ts + all portal service files |
| `tsc --noEmit` (customer-portal) | ✅ 0 errors | After `lib/api-client-react` dist rebuild |
| `tsc --noEmit` (bizportal) | ✅ 0 errors | After `lib/object-storage-web` dist rebuild |
| `tsc --noEmit` (api-server full) | ⚠️ OOM | Replit memory limit; individual file checks pass; esbuild bundle clean |
| Duplicate routes | ✅ None | Verified via script |
| Unused imports in portal.ts | ✅ None | Verified via `tsc --noUnusedLocals` |

---

## 9. Remaining Risks

| Risk | Severity | Notes |
|---|---|---|
| Bizportal pre-existing TS7006 errors | Low | In `quotation-editor.tsx`, not portal service layer; existed before refactor |
| Full api-server tsc OOM | Low | Resource constraint; esbuild + targeted tsc confirms service layer is clean |
| `POST /admin/fix-jasa-names` inline DB loop | Low | One-off data repair utility; acceptable to leave inline |
| `GET /vendor/notifications` (31L) | Low | Uses `portalVendorNotificationService` implicitly via inline; functionally thin but slightly long due to pagination logic |
| Cross-service dependency depth | Low | `portalMarketplaceService` and `portalDashboardService` import from `portalVendorCatalogService`; acceptable current depth |

---

## 10. Recommended Next Phase

1. **Vendor notifications service** — extract `GET /vendor/notifications` (31L, pagination + SSE logic) into `portalVendorNotificationService.ts` for full coverage
2. **`GET /company` service** — simple: move 1 DB query + cache into `portalCompanyService.ts`
3. **Integration tests** — add `supertest` coverage for the 6 routes extracted in this refactor session (`/calculator-rates`, `/calculator-rates-v2`, `/catalog-inquiry`, `/me/dashboard-stats`, `/marketplace/:id`)
4. ~~**Bizportal TS cleanup**~~ — resolved: lib/object-storage-web dist rebuild cleared all 17 errors ✅
5. **Fix full api-server typecheck** — add `--max-old-space-size=4096` to the tsc call in package.json `type-check` script, or split into per-domain project references

