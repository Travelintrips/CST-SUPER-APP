import { randomBytes } from "crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { LOGISTICS_SUBCATEGORIES as LOGISTICS_SUBCATEGORIES_FALLBACK } from "@workspace/logistics-constants";
import { rateLimit, ipKeyGenerator, type ValueDeterminingMiddleware } from "express-rate-limit";
const keyGen: ValueDeterminingMiddleware<string> = (req) => ipKeyGenerator(req.ip ?? "127.0.0.1");
import { db, productsTable, productCategoryMapTable, productCategoriesTable, portalCustomersTable, portalCustomerServicesTable, portalContentTable, accountingSettingsTable, vendorMiniFormLinksTable, vendorMiniFormSubmissionsTable, vendorCatalogItemsTable, productTemplatesTable, serviceTemplatesTable, vendorPerformanceTable, vendorNotificationsTable, vendorCatalogSubmissionsTable, notificationLogsTable, portalCustomerProfilesTable, supplierReviewsTable, mktPurchaseOrdersTable, mktRfqsTable, portalProductOrdersTable, suppliersTable, vendorProfilesTable, userProfilesTable } from "@workspace/db";
import { evaluateReviewEligibility } from "../lib/services/vendorReviewGuard.js";
import { deleteFromSupabase, uploadToSupabase } from "../lib/supabaseStorage.js";
import { invalidateTokenCache, SERVICE_SCHEMAS } from "./vendorMiniForm";
import { eq, inArray, and, ne, isNull, sql, desc, gte, lte, ilike, or, asc } from "drizzle-orm";
import { productMediaTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { validateUploadFile, validateMagicBytes } from "../lib/uploadValidation.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminWa } from "../lib/adminWa.js";
import { getAppConfig } from "../lib/appConfig.js";
import { validateMediaAssetsPayload } from "../lib/mediaAssetsValidation.js";
import { requirePortalAuth, requirePortalAdmin, requireActiveVendor, verifyDevPortalEmail, type PortalAuthReq, setPortalSessionCookie, clearPortalSessionCookie, PORTAL_SESSION_COOKIE } from "../lib/supabaseAuth";
import { writeAuditLog } from "../lib/auditLog.js";
import { requireClerkUser } from "../lib/requireAdmin";
import { isCatalogItemPublic, catalogPublicConditions } from "../lib/catalogVisibility.js";
import { resolveTemplate, hasInCodeTemplate } from "@workspace/product-templates";
import {
  listPublicMarketplaceItems,
  getCatalogItemPublic,
  getMarketplaceItemDetail,
  getRelatedItems,
  getSimilarItems,
  getSameProvinceItems,
  getVendorPublicProfile,
  listVendorCatalogPublic,
  compareVendorCatalog,
  listProductTemplates,
  listServiceTemplates,
  getLinkedSupplier,
  listVendorOwnCatalog,
  deleteVendorCatalogMedia,
  listVendorCatalogSubmissions,
  getMarketplaceStats,
  uploadVendorCatalogMedia,
  normalizeServiceCategory,
  SERVICE_CATEGORY_LABELS,
  getHeroCategoryTiles,
} from "../lib/services/portalVendorCatalogService.js";
import { normalizeMarketplaceStockStatus } from "../lib/catalogNormalization.js";
import { broadcastToAdmins, broadcastToPortal } from "../lib/sseManager";
import { NotificationService } from "../lib/services/notificationService.js";
import {
  listApprovals,
  processApproval,
  getApprovalAuditTrail,
  getApprovalStats,
  getApprovalIdentityDocs,
} from "../lib/services/portalApprovalService.js";
import { listCustomers, getCustomerStats } from "../lib/services/portalCustomerService.js";
import { getErpStats } from "../lib/services/portalStatsService.js";
import { getContent, updateContent } from "../lib/services/portalContentService.js";
import {
  listAdminProducts,
  listProductCategories,
  createProduct,
  updateProduct,
  deleteProduct,
  createService,
  updateService,
  deleteService,
} from "../lib/services/portalProductService.js";
import {
  listVendors,
  createVendor,
  updateVendor,
  deleteVendor,
  listVendorFormLinks,
  createVendorFormLink,
  patchVendorFormLink,
  deleteVendorFormLink,
  listVendorFormSubmissions,
} from "../lib/services/portalVendorService.js";
import {
  getTruckingRates,
  setTruckingRates,
  getFreightRates,
  setFreightRates,
  getCalculatorRates,
  getCalculatorRatesV2,
} from "../lib/services/portalRateService.js";
import { submitCatalogInquiry } from "../lib/services/portalInquiryService.js";
import { resolveVendorSupplierId } from "../lib/services/portalVendorProfileService.js";
import {
  FeaturedProductError,
  listFeaturedPackages,
  createFeaturedPackage,
  updateFeaturedPackage,
  deactivateFeaturedPackage,
  createFeaturedRequest,
  listFeaturedRequestsForVendor,
  getFeaturedRequestDetailForVendor,
  submitPaymentProofForVendor,
  cancelFeaturedRequestByVendor,
  listFeaturedRequests,
  getFeaturedRequestDetail,
  approveFeaturedRequest,
  rejectFeaturedRequest,
  verifyFeaturedPayment,
  activateFeaturedProduct,
  cancelFeaturedProduct,
  reorderFeaturedProducts,
  listFeaturedProductsForDisplay,
} from "../lib/services/marketplaceFeaturedProductService.js";
import { scanFeaturedIntegrity, repairFeaturedIntegrity } from "../lib/services/marketplaceFeaturedRepairService.js";
import { getPortalDashboardStats } from "../lib/services/portalDashboardService.js";
// isMarketplaceNewPipelineEnabled, createMktRfqEntry, linkMktRfqToLegacy
// moved to portalMarketplaceService.ts
import {
  submitMarketplaceQuote,
  createMarketplaceOrder,
} from "../lib/services/portalMarketplaceService.js";
import {
  listLogisticAdminServices,
  createLogisticAdminService,
  updateLogisticAdminService,
  deleteLogisticAdminService,
} from "../lib/services/portalLogisticAdminService.js";
import multer from "multer";
import { randomUUID } from "crypto";
import { compressImageBuffer } from "../lib/imageCompress.js";
import { verifyPortalJwt } from "../lib/portalJwt.js";
import { verifySupabaseToken } from "../lib/supabaseAdmin.js";
import {
  getOnboardingStatus,
  runKtpOcr,
  uploadOnboardingDoc,
  completeOnboarding,
  OnboardingServiceError,
} from "../lib/services/portalVendorOnboardingService.js";
import {
  getVendorDashboard,
  getVendorFullProfile,
} from "../lib/services/portalVendorProfileService.js";
import { validateBody } from "../lib/middleware/validateBody.js";
import {
  VendorSelfProfileSchema,
  CompleteOnboardingSchema,
  VendorInviteAcceptSchema,
} from "../lib/schemas/vendor/index.js";
import {
  logVendorAudit,
  actorFromReq as vendorActorFromReq,
  ipFromReq as vendorIpFromReq,
  uaFromReq as vendorUaFromReq,
} from "../lib/services/vendorAuditLogService.js";
import {
  AuthServiceError,
  emailPasswordLogin,
  sendWaOtp,
  verifyWaOtp,
  waRegister,
  waLogin,
  waTrustedLogin,
  getTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
  signup,
  devLogin,
  syncProfile,
  requestEmailOtp,
  verifyEmailOtp,
  getMe,
  normalizePhoneID,
  forgotPasswordCustom,
  resetPasswordWithToken,
} from "../lib/services/portalAuthService.js";
import {
  LogisticOrderServiceError,
  submitVendorQuote,
  listSalesOrders,
  listLogisticOrders,
  listProductOrders,
  createSalesOrder,
  cancelSalesOrder,
  cancelLogisticOrder,
  uploadOrderFile,
  uploadPaymentProof,
  submitRequestQuote,
  listQuoteRequests,
  updateQuoteRequest,
} from "../lib/services/portalLogisticOrderService.js";

const router = Router();


async function getProductCategories(productIds: number[]): Promise<Record<number, string[]>> {
  if (productIds.length === 0) return {};
  const rows = await db
    .select({ productId: productCategoryMapTable.productId, name: productCategoriesTable.name })
    .from(productCategoryMapTable)
    .innerJoin(productCategoriesTable, eq(productCategoryMapTable.categoryId, productCategoriesTable.id))
    .where(inArray(productCategoryMapTable.productId, productIds));
  const map: Record<number, string[]> = {};
  for (const r of rows) {
    if (!map[r.productId]) map[r.productId] = [];
    map[r.productId].push(r.name);
  }
  return map;
}

// ── In-memory cache for company settings (5 min TTL) ─────────────────────────
let _companyCache: { data: object; expiresAt: number } | null = null;
const COMPANY_TTL_MS = 5 * 60 * 1000;

// GET /api/portal/company
router.get("/company", async (_req, res) => {
  const FALLBACK = {
    name: "PT. Cahaya Sejati Teknologi",
    tagline: "Solusi Logistik Terintegrasi & Berbasis Teknologi",
    logoUrl: null as string | null,
    address: null as string | null,
    email: null as string | null,
    phone: null as string | null,
  };
  if (_companyCache && Date.now() < _companyCache.expiresAt) {
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    return res.json(_companyCache.data);
  }
  try {
    const [settings] = await db.select().from(accountingSettingsTable).limit(1);
    const adminWa = await getAdminWa();
    const data = {
      name: settings?.companyName ?? FALLBACK.name,
      tagline: FALLBACK.tagline,
      logoUrl: settings?.companyLogoUrl ?? null,
      address: settings?.companyAddress ?? null,
      email: null,
      phone: adminWa || null,
    };
    _companyCache = { data, expiresAt: Date.now() + COMPANY_TTL_MS };
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    return res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[portal/company] DB query failed — returning fallback", msg);
    res.setHeader("Cache-Control", "no-store");
    return res.json(FALLBACK);
  }
});

async function listByType(type: string) {
  const rows = await db
    .select()
    .from(productsTable)
    .where(and(
      eq(productsTable.isActive, true),
      eq(productsTable.itemType, type),
      or(isNull(productsTable.subcategory), ne(productsTable.subcategory, "bahan_thai_tea")),
    ));
  const ids = rows.map((p) => p.id);
  const catMap = await getProductCategories(ids);
  return rows.map((p) => {
    let mediaItems: Array<{ type: string; url: string }> = [];
    try { mediaItems = JSON.parse(p.mediaItems ?? "[]"); } catch { /* empty */ }
    let unitOptions: string[] = [];
    try { unitOptions = JSON.parse(p.unitOptions ?? "[]"); } catch { /* empty */ }
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      price: Number(p.price),
      stock: p.stock ?? 0,
      unit: p.unit,
      unitOptions,
      subcategory: p.subcategory ?? null,
      imageUrl: p.imageUrl ?? null,
      mediaItems,
      categories: catMap[p.id] ?? [],
      currencyCode: p.currencyCode ?? "IDR",
    };
  });
}

// GET /api/portal/services  — item_type = 'jasa' (active only, public)
router.get("/services", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(await listByType("jasa"));
});

// GET /api/portal/products  — item_type = 'barang'
router.get("/products", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(await listByType("barang"));
});

// normalizeServiceCategory, SERVICE_CATEGORY_LABELS — moved to portalVendorCatalogService.ts
// Re-exported from service so external consumers (if any) keep working.
export { normalizeServiceCategory, SERVICE_CATEGORY_LABELS } from "../lib/services/portalVendorCatalogService.js";

// ── GET /api/portal/marketplace/stats ─────────────────────────────────────────
// public summary stats — unified (used by hero trust bar + MarketplaceStatsBar)
router.get("/marketplace/stats", async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
  try {
    return res.json(await getMarketplaceStats());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[marketplace/stats] query failed — returning zeros", msg);
    return res.json({
      itemCount: 0, vendorCount: 0, categoryCount: 0,
      totalItems: 0, totalVendors: 0, verifiedVendors: 0, totalRfqs: 0, avgRating: null,
    });
  }
});

// ── GET /api/portal/marketplace ───────────────────────────────────────────────
// public vendor catalog (published only, NO priceBase)
router.get("/marketplace", async (req, res) => {
  const { kind, category, vendorId, q, search } = req.query as {
    kind?: string; category?: string; vendorId?: string; q?: string; search?: string;
  };
  // Skip cache when a search term is present (personalised result)
  if (q || search) {
    res.setHeader("Cache-Control", "no-store");
  } else {
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
  }
  return res.json(await listPublicMarketplaceItems({ kind, category, vendorId, q, search }));
});

// [merged into /marketplace/stats above — removed duplicate P5 handler]

// GET /api/portal/marketplace/featured — public: featured products for marketplace display.
// MUST be registered before /marketplace/:id below, or Express matches "featured" as :id.
router.get("/marketplace/featured", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 12;
    res.json(await listFeaturedProductsForDisplay(limit));
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// GET /api/portal/marketplace/hero-tiles — public: one tile per hero category, DB-sourced.
// MUST be before /marketplace/:id so Express doesn't match "hero-tiles" as an :id.
router.get("/marketplace/hero-tiles", async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
  try {
    res.json(await getHeroCategoryTiles());
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// ── Vendor public profile rate limit (unauthenticated) ───────────────────────
const vendorPublicProfileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: keyGen,
  message: { error: "Terlalu banyak permintaan. Coba lagi dalam 1 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Vendor invite token rate limit (public, token-based) ─────────────────────
const vendorInviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: keyGen,
  message: { error: "Terlalu banyak permintaan. Coba lagi dalam 15 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Marketplace rate limiting + bot protection ────────────────────────────────
const marketplaceSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: keyGen,
  message: { error: "Terlalu banyak permintaan. Coba lagi dalam 15 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

// normalizeMarketplaceStockStatus — moved to catalogNormalization.ts, imported above

// mkMarketplaceOrderNumber — moved to portalMarketplaceService.ts
// getCatalogItemPublic    — moved to portalVendorCatalogService.ts, imported above

// GET /api/portal/marketplace/:id — single published catalog item detail (NO priceBase)
router.get("/marketplace/:id", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "id tidak valid" });
  const detail = await getMarketplaceItemDetail(id);
  if (!detail) return res.status(404).json({ error: "Item tidak ditemukan atau belum dipublikasikan" });
  return res.json(detail);
});

// POST /api/portal/marketplace/:id/quote — buat Quote Request dari catalog item
router.post("/marketplace/:id/quote", marketplaceSubmitLimiter, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "id tidak valid" });

  const body = req.body as Record<string, unknown>;
  if (body._hp && String(body._hp).trim() !== "") {
    return res.status(400).json({ error: "Permintaan tidak valid" });
  }

  // Optional auth: resolve logged-in customer email to link quote to account.
  // Priority: devportal token (HMAC-verified, dev-only) → portal JWT → Supabase token.
  // SECURITY: devportal tokens MUST go through verifyDevPortalEmail() which enforces
  // HMAC-SHA256 signature check and IS_PROD guard. Never decode devportal.* tokens
  // inline — that allows forgery of any email without a valid signature.
  let portalEmailFromToken: string | null = null;
  const authHdr = req.headers.authorization;
  if (authHdr?.startsWith("Bearer ")) {
    try {
      const tok = authHdr.slice(7);
      if (tok.startsWith("devportal.")) {
        portalEmailFromToken = verifyDevPortalEmail(tok);
      }
      if (!portalEmailFromToken) {
        const pp = await verifyPortalJwt(tok);
        if (pp) {
          const [c] = await db.select({ email: portalCustomersTable.email }).from(portalCustomersTable).where(eq(portalCustomersTable.id, pp.customerId));
          if (c) portalEmailFromToken = c.email;
        }
      }
      if (!portalEmailFromToken) {
        const su = await verifySupabaseToken(tok);
        if (su?.email) portalEmailFromToken = su.email;
      }
    } catch { /* treat as anonymous */ }
  }

  try {
    const result = await submitMarketplaceQuote({
      catalogItemId:        id,
      portalEmailFromToken,
      ip:                   (req as Request & { ip?: string }).ip ?? null,
      body:                 req.body,
    });
    // Backward-compatible response — legacy fields unchanged.
    // New clients can read rfqId/rfqNumber when new pipeline is active.
    return res.status(201).json(result);
  } catch (e: any) {
    const code = (e as any)?.statusCode;
    if (code === 404) return res.status(404).json({ error: e.message });
    if (code === 400) return res.status(400).json({ error: e.message });
    throw e;
  }
});

// POST /api/portal/marketplace/:id/order — buat Order Now dari catalog item
// DEPRECATED: Marketplace frontend no longer uses direct order flow. Use /api/portal/marketplace/:id/quote for RFQ.
router.post("/marketplace/:id/order", marketplaceSubmitLimiter, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "id tidak valid" });

  const body = req.body as Record<string, unknown>;
  if (body._hp && String(body._hp).trim() !== "") {
    return res.status(400).json({ error: "Permintaan tidak valid" });
  }

  try {
    const result = await createMarketplaceOrder({ catalogItemId: id, body: req.body });
    return res.status(201).json(result);
  } catch (e: any) {
    const code = (e as any)?.statusCode;
    if (code === 404) return res.status(404).json({ error: e.message });
    if (code === 400) return res.status(400).json({ error: e.message });
    throw e;
  }
});

// ── Routes khusus untuk /logistic-admin (auth: portal admin JWT) ─────────────
// Security: these routes previously checked x-admin-password against a hardcoded
// fallback of "admin123" which was also embedded in the customer portal JS bundle.
// All /logistic-admin/* routes now require requirePortalAdmin — a Supabase Bearer
// token that belongs to an email on the server-side PORTAL_ADMIN_EMAILS allowlist.
// No shared secret is shipped to the browser.

// GET /api/portal/logistic-admin/services — semua jasa (incl. inactive)
router.get("/logistic-admin/services", requirePortalAdmin, async (_req, res) => {
  return res.json(await listLogisticAdminServices());
});

// POST /api/portal/logistic-admin/services — tambah jasa baru
router.post("/logistic-admin/services", requirePortalAdmin, async (req, res) => {
  try {
    const inserted = await createLogisticAdminService(req.body ?? {});
    return res.status(201).json(inserted);
  } catch (e: any) {
    if ((e as any)?.statusCode === 400) return res.status(400).json({ message: e.message });
    throw e;
  }
});

// PUT /api/portal/logistic-admin/services/:id
router.put("/logistic-admin/services/:id", requirePortalAdmin, async (req, res) => {
  const id = Number(String(req.params.id));
  try {
    const updated = await updateLogisticAdminService(id, req.body ?? {});
    // Notify Customer Portal: harga/data jasa diperbarui via logistic-admin portal.
    // Listener: jasa.tsx (invalidates ["listPortalServicesJasa"])
    broadcastToPortal("price_sync", { ts: Date.now() });
    return res.json(updated);
  } catch (e: any) {
    const code = (e as any)?.statusCode;
    if (code === 400) return res.status(400).json({ message: e.message });
    if (code === 404) return res.status(404).json({ message: e.message });
    throw e;
  }
});

// DELETE /api/portal/logistic-admin/services/:id
router.delete("/logistic-admin/services/:id", requirePortalAdmin, async (req, res) => {
  const id = Number(String(req.params.id));
  await deleteLogisticAdminService(id);
  return res.json({ ok: true });
});

// Emails yang otomatis mendapat role admin saat login (comma-separated)
const PORTAL_ADMIN_EMAILS = [
  "admcst001@gmail.com",
  "wangsamasindo@gmail.com",
  ...(process.env.PORTAL_ADMIN_EMAILS ?? "").split(","),
]
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// ── Auth rate limiters ────────────────────────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: keyGen,
  message: { message: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: keyGen,
  message: { message: "Terlalu banyak pendaftaran dari IP ini. Coba lagi dalam 1 jam." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /auth/otp/request — max 5 requests per IP per 15 min
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: keyGen,
  message: { message: "Terlalu banyak permintaan OTP. Coba lagi dalam 15 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /auth/otp/verify — max 10 attempts per IP per 15 min (prevents 6-digit brute force)
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: keyGen,
  message: { message: "Terlalu banyak percobaan verifikasi. Coba lagi dalam 15 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /auth/wa-otp/send — IP-level limiter (DB already limits per phone)
const waOtpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: keyGen,
  message: { message: "Terlalu banyak permintaan OTP. Coba lagi dalam 15 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /auth/wa-trusted-login — prevent device-token enumeration
const waTrustedLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: keyGen,
  message: { message: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/portal/auth/login — email/password login (non-Supabase)
router.post("/auth/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ message: "Email dan password diperlukan." });
  try {
    const result = await emailPasswordLogin(String(email), String(password));
    // C1-REMEDIATION: set HttpOnly session cookie (7-day expiry)
    setPortalSessionCookie(res, result.token);
    return res.json(result);
  } catch (err) {
    if (err instanceof AuthServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// POST /api/portal/auth/logout — clears the session cookie
router.post("/auth/logout", (req, res) => {
  clearPortalSessionCookie(res);
  res.json({ message: "Logged out." });
});

// POST /api/portal/auth/wa-otp/send — kirim OTP via WhatsApp
router.post("/auth/wa-otp/send", waOtpSendLimiter, async (req, res) => {
  const { phone } = req.body ?? {};
  if (!phone) return res.status(400).json({ message: "Nomor HP diperlukan." });
  try {
    const result = await sendWaOtp(String(phone));
    const payload: Record<string, unknown> = { message: result.message, phone: result.phone };
    if (result._dev_code) payload._dev_code = result._dev_code;
    return res.json(payload);
  } catch (err) {
    if (err instanceof AuthServiceError) {
      if (err.statusCode === 500) req.log?.error({ err: err.cause }, "wa-otp send failed");
      return res.status(err.statusCode).json({ message: err.message });
    }
    throw err;
  }
});

// POST /api/portal/auth/wa-otp/verify — verifikasi OTP, return verifyToken
router.post("/auth/wa-otp/verify", async (req, res) => {
  const { phone, code } = req.body ?? {};
  if (!phone || !code) return res.status(400).json({ message: "Nomor HP dan kode diperlukan." });
  try {
    return res.json(await verifyWaOtp(String(phone), String(code)));
  } catch (err) {
    if (err instanceof AuthServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// POST /api/portal/auth/wa-register — lengkapi profil & buat akun
router.post("/auth/wa-register", async (req, res) => {
  const { verifyToken, name, role, company, serviceIds, email, rememberDays } = req.body ?? {};
  if (!verifyToken || !name) return res.status(400).json({ message: "Token verifikasi dan nama diperlukan." });
  try {
    const result = await waRegister({ verifyToken: String(verifyToken), name: String(name), role, company, serviceIds, email, rememberDays });
    // C1-REMEDIATION: set HttpOnly session cookie on registration
    if ("token" in result && typeof result.token === "string") {
      setPortalSessionCookie(res, result.token);
    }
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof AuthServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// POST /api/portal/auth/wa-login — login pakai phone + OTP
router.post("/auth/wa-login", async (req, res) => {
  const { verifyToken, rememberDays } = req.body ?? {};
  if (!verifyToken) return res.status(400).json({ message: "Token verifikasi diperlukan." });
  try {
    const { user, token, deviceToken } = await waLogin(
      String(verifyToken),
      typeof rememberDays === "number" ? rememberDays : undefined,
      (phone) => req.log?.error({ phone }, "wa-login: multiple accounts share phone — refusing login")
    );
    // C1-REMEDIATION: set HttpOnly session cookie
    setPortalSessionCookie(res, token);
    return res.json({ token, deviceToken, user });
  } catch (err) {
    if (err instanceof AuthServiceError) return res.status(err.statusCode).json({ message: err.message, ...err.payload });
    throw err;
  }
});

// POST /api/portal/auth/wa-trusted-login — login tanpa OTP pakai device token tersimpan
router.post("/auth/wa-trusted-login", waTrustedLoginLimiter, async (req, res) => {
  const { phone, deviceToken } = req.body ?? {};
  if (!phone || !deviceToken) return res.status(400).json({ message: "phone dan deviceToken diperlukan." });
  try {
    const result = await waTrustedLogin(String(phone), String(deviceToken));
    // C1-REMEDIATION: set HttpOnly session cookie
    if ("token" in result && typeof result.token === "string") {
      setPortalSessionCookie(res, result.token);
    }
    return res.json(result);
  } catch (err) {
    if (err instanceof AuthServiceError) return res.status(err.statusCode).json({ message: err.message, ...err.payload });
    throw err;
  }
});

// GET /api/portal/auth/trusted-devices — daftar perangkat terpercaya milik user saat ini
router.get("/auth/trusted-devices", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  return res.json(await getTrustedDevices(customerId));
});

// DELETE /api/portal/auth/trusted-devices/:id — cabut perangkat terpercaya
router.delete("/auth/trusted-devices/:id", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const deviceId = parseInt(String(req.params.id), 10);
  if (isNaN(deviceId)) return res.status(400).json({ message: "ID tidak valid." });
  try {
    await revokeTrustedDevice(customerId, deviceId);
    return res.json({ message: "Perangkat berhasil dicabut." });
  } catch (err) {
    if (err instanceof AuthServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// DELETE /api/portal/auth/trusted-devices — cabut semua perangkat
router.delete("/auth/trusted-devices", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  try {
    await revokeAllTrustedDevices(customerId);
    return res.json({ message: "Semua perangkat berhasil dicabut." });
  } catch (err) {
    if (err instanceof AuthServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// POST /api/portal/auth/signup — standalone register (non-Supabase)
router.post("/auth/signup", signupLimiter, async (req, res) => {
  const { name, email, password, phone, company, role, serviceIds } = req.body ?? {};
  if (!name || !email || !password) {
    return res.status(400).json({ message: "Nama, email, dan password diperlukan." });
  }
  try {
    const result = await signup({ name: String(name), email: String(email), password: String(password), phone, company, role, serviceIds });
    // C1-REMEDIATION: set HttpOnly session cookie on registration
    if ("token" in result && typeof result.token === "string") {
      setPortalSessionCookie(res, result.token);
    }
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof AuthServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// POST /api/portal/auth/dev-login — hanya tersedia di non-production (dev & staging)
// Membuat/menemukan dev user dan mengembalikan signed dev token untuk testing tanpa Supabase.
router.post("/auth/dev-login", async (req, res) => {
  if (process.env.REPLIT_DEPLOYMENT === "1") {
    res.status(404).json({ message: "Not found" });
    return;
  }
  const { role } = req.body ?? {};
  const result = await devLogin(String(role ?? ""));
  // Set HttpOnly session cookie agar /admin dan route lain yang memerlukan
  // requirePortalAuth / requirePortalAdmin bisa membaca token dari cookie,
  // sama seperti flow login normal (email OTP, password, WA, dll).
  setPortalSessionCookie(res, result.token);
  return res.json(result);
});

// POST /api/portal/auth/register — sync profil ke DB setelah supabase.auth.signUp
router.post("/auth/register", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const { name, phone, company, role, serviceIds } = req.body ?? {};
  return res.json(await syncProfile(customerId, { name, phone, company, role, serviceIds }));
});

// POST /api/portal/auth/otp/request — kirim kode OTP ke email (passwordless login)
// Security: rate-limited per IP; uses CSPRNG; stores bcrypt hash (not plaintext)
router.post("/auth/otp/request", otpRequestLimiter, async (req, res) => {
  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ message: "Email diperlukan." });
  try {
    return res.json(await requestEmailOtp(String(email)));
  } catch (err) {
    if (err instanceof AuthServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// POST /api/portal/auth/otp/verify — verifikasi kode OTP dan login
// Security: rate-limited per IP; attempt counter prevents brute force; bcrypt compare (v2 format)
router.post("/auth/otp/verify", otpVerifyLimiter, async (req, res) => {
  const { email, code } = req.body ?? {};
  if (!email || !code) return res.status(400).json({ message: "Email dan kode diperlukan." });
  try {
    const result = await verifyEmailOtp(String(email), String(code));
    // C1-REMEDIATION: set HttpOnly session cookie
    if ("token" in result && typeof result.token === "string") {
      setPortalSessionCookie(res, result.token);
    }
    return res.json(result);
  } catch (err) {
    if (err instanceof AuthServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// POST /api/portal/auth/forgot-password — custom flow via portal_customers (not Supabase Auth)
router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email, origin: bodyOrigin } = req.body ?? {};
    if (!email || typeof email !== "string") return res.status(400).json({ message: "Email wajib diisi." });
    // Prefer origin sent by the frontend (public domain); fall back to request host
    const origin = (typeof bodyOrigin === "string" && bodyOrigin.startsWith("http"))
      ? bodyOrigin
      : `${req.protocol}://${req.get("host")}`;
    const result = await forgotPasswordCustom(email, origin);
    return res.json(result);
  } catch (e: any) {
    if (e instanceof AuthServiceError) return res.status(e.statusCode).json({ message: e.message });
    console.error("[portal] forgot-password error", e);
    return res.status(500).json({ message: "Terjadi kesalahan. Coba lagi." });
  }
});

// POST /api/portal/auth/reset-password-with-token — verify token and set new password
router.post("/auth/reset-password-with-token", async (req, res) => {
  try {
    const { email, token, password } = req.body ?? {};
    if (!email || !token || !password) return res.status(400).json({ message: "email, token, dan password wajib diisi." });
    const result = await resetPasswordWithToken(email, token, password);
    return res.json(result);
  } catch (e: any) {
    if (e instanceof AuthServiceError) return res.status(e.statusCode).json({ message: e.message });
    console.error("[portal] reset-password-with-token error", e);
    return res.status(500).json({ message: "Terjadi kesalahan. Coba lagi." });
  }
});

// GET /api/portal/auth/me
router.get("/auth/me", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  try {
    return res.json(await getMe(customerId));
  } catch (err) {
    if (err instanceof AuthServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// POST /api/portal/me/avatar — upload logo perusahaan / foto profil
const _avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.post("/me/avatar", requirePortalAuth, _avatarUpload.single("avatar"), async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  try {
    if (!req.file) return res.status(400).json({ error: "Tidak ada file yang diunggah" });
    const { buffer, mimetype } = req.file;
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowed.includes(mimetype)) return res.status(400).json({ error: "Format file tidak didukung (jpg/png/webp)" });
    // C2-REMEDIATION: magic-byte signature check
    const magicCheck = validateMagicBytes(buffer, mimetype);
    if (!magicCheck.ok) return res.status(400).json({ error: magicCheck.errorMessage });

    // Delete old avatar if exists
    const [cur] = await db.select({ avatarUrl: sql<string | null>`avatar_url` })
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, customerId))
      .limit(1);
    if (cur?.avatarUrl) await deleteFromSupabase(cur.avatarUrl);

    const { publicUrl } = await uploadToSupabase(buffer, mimetype, "avatars");
    await db.execute(sql`UPDATE portal_customers SET avatar_url = ${publicUrl} WHERE id = ${customerId}`);
    return res.json({ ok: true, avatarUrl: publicUrl });
  } catch (err) {
    console.error("[portal] POST /me/avatar error", err);
    return res.status(500).json({ error: "Gagal mengunggah foto" });
  }
});

// PUT /api/portal/me — update profile (name, company, phone, address)
router.put("/me", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const { name, company, phone, address } = req.body ?? {};

  // Helper: coerce a field value to a DB-safe string or null (never "null" string)
  function toStr(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  }

  try {
    // Build update object only for fields actually provided
    const customerUpdate: Record<string, string | null> = {};
    if (name    !== undefined) customerUpdate.name    = toStr(name);
    if (company !== undefined) customerUpdate.company = toStr(company);
    if (phone   !== undefined) customerUpdate.phone   = toStr(phone);

    if (Object.keys(customerUpdate).length > 0) {
      await db.update(portalCustomersTable)
        .set(customerUpdate)
        .where(eq(portalCustomersTable.id, customerId));
    }

    // Upsert address into portal_customer_profiles (only when provided)
    if (address !== undefined) {
      const addrValue = toStr(address);
      const [existing] = await db.select({ id: portalCustomerProfilesTable.id })
        .from(portalCustomerProfilesTable)
        .where(eq(portalCustomerProfilesTable.customerId, customerId))
        .limit(1);
      if (existing) {
        await db.update(portalCustomerProfilesTable)
          .set({ companyAddress: addrValue, updatedAt: new Date() })
          .where(eq(portalCustomerProfilesTable.customerId, customerId));
      } else if (addrValue) {
        await db.insert(portalCustomerProfilesTable)
          .values({ customerId, companyAddress: addrValue });
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[portal] PUT /me error", err);
    return res.status(500).json({ error: "Gagal menyimpan profil" });
  }
});


// ── VENDOR PORTAL ─────────────────────────────────────────────────────────
// GET /api/portal/vendor/profile — returns linked supplier + RFQs + quotes for a vendor user
// requireActiveVendor ensures pending/rejected vendors cannot access vendor dashboard data
router.get("/vendor/profile", requirePortalAuth, requireActiveVendor, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const result = await getVendorDashboard(customerId);
  if (!result) return res.status(401).json({ message: "Tidak ditemukan" });
  return res.json(result);
});

// POST /api/portal/vendor/quotes — submit or update a quote for an open RFQ
router.post("/vendor/quotes", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const { rfqId, vendorPrice, estimatedPickup, estimatedDelivery, estimatedDays, vendorNotes } = req.body as {
    rfqId: number; vendorPrice: number; estimatedPickup?: string; estimatedDelivery?: string;
    estimatedDays?: number; vendorNotes?: string;
  };
  try {
    return res.json(await submitVendorQuote(customerId, { rfqId, vendorPrice, estimatedPickup, estimatedDelivery, estimatedDays, vendorNotes }));
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// ── PORTAL CONTENT (Public) ───────────────────────────────────────────────

// GET /api/portal/content?locale=id-ID
router.get("/content", async (req, res) => {
  try {
    const locale = typeof req.query.locale === "string" && req.query.locale ? req.query.locale : undefined;
    const content = await getContent(locale);
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    return res.json(content);
  } catch (err) {
    console.error("[portal] getContent error", err);
    return res.status(500).json({ error: "Gagal memuat konten" });
  }
});

// ── PORTAL ADMIN ENDPOINTS ─────────────────────────────────────────────────
const MIN_ADMIN_KEY_LEN = 16;

// Rate limiter: max 5 claim attempts per IP per hour
const _claimAttempts = new Map<string, { count: number; resetAt: number }>();
function _claimRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = _claimAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    _claimAttempts.set(ip, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

// POST /api/portal/admin/claim  — claim admin role using secret key
router.post("/admin/claim", requirePortalAuth, async (req, res) => {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown";

  if (!_claimRateLimit(ip)) {
    return res.status(429).json({ message: "Terlalu banyak percobaan. Coba lagi dalam 1 jam." });
  }

  const PORTAL_ADMIN_KEY = await getAppConfig("PORTAL_ADMIN_KEY");
  if (!PORTAL_ADMIN_KEY || PORTAL_ADMIN_KEY.length < MIN_ADMIN_KEY_LEN) {
    return res.status(503).json({ message: "Admin claim belum dikonfigurasi dengan benar." });
  }

  const { key } = req.body ?? {};
  const customerId = (req as PortalAuthReq).portalCustomerId;

  if (String(key) !== PORTAL_ADMIN_KEY) {
    console.warn(`[SECURITY] admin/claim FAILED — ip=${ip} customerId=${customerId}`);
    return res.status(403).json({ message: "Kunci admin tidak valid" });
  }

  await db.update(portalCustomersTable).set({ role: "admin" }).where(eq(portalCustomersTable.id, customerId));
  console.warn(`[SECURITY] admin/claim SUCCESS — ip=${ip} customerId=${customerId}`);
  _claimAttempts.delete(ip);
  return res.json({ role: "admin" });
});

// PUT /api/portal/admin/content  — update CMS content (admin only)
router.put("/admin/content", requirePortalAdmin, async (req, res) => {
  const updates = req.body as Record<string, string>;
  if (!updates || typeof updates !== "object") {
    return res.status(400).json({ message: "Body harus berupa objek key-value" });
  }
  try {
    const locale = typeof req.query.locale === "string" && req.query.locale ? req.query.locale : undefined;
    await updateContent(updates, locale);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[portal] updateContent error", err);
    return res.status(500).json({ error: "Gagal update konten" });
  }
});

// PUT /api/portal/admin/services/:id  — update service (admin only)
router.put("/admin/services/:id", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const updated = await updateService(id, req.body ?? {});
    broadcastToPortal("price_sync", { ts: Date.now() });
    return res.json(updated);
  } catch (err: any) {
    if (err?.statusCode === 400) return res.status(400).json({ message: err.message });
    console.error("[portal] updateService error", err);
    return res.status(500).json({ error: "Gagal update layanan" });
  }
});

// POST /api/portal/admin/services — tambah jasa baru (JWT admin)
router.post("/admin/services", requirePortalAdmin, async (req, res) => {
  const { name, description, price, imageUrl, subcategory, unit } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ message: "Nama layanan harus diisi" });
  }
  try {
    const created = await createService({ name, description, price, imageUrl, subcategory, unit });
    return res.status(201).json(created);
  } catch (err) {
    console.error("[portal] createService error", err);
    return res.status(500).json({ error: "Gagal membuat layanan" });
  }
});

// DELETE /api/portal/admin/services/:id — hapus jasa (JWT admin)
router.delete("/admin/services/:id", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const { mediaUrlsToDelete } = await deleteService(id);
    for (const url of mediaUrlsToDelete) deleteFromSupabase(url).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error("[portal] deleteService error", err);
    return res.status(500).json({ error: "Gagal hapus layanan" });
  }
});

// GET /api/portal/admin/products  — semua produk aktif (admin only, semua item_type)
router.get("/admin/products", requirePortalAdmin, async (_req, res) => {
  try {
    return res.json(await listAdminProducts());
  } catch (err) {
    console.error("[portal] listAdminProducts error", err);
    return res.status(500).json({ error: "Gagal memuat produk" });
  }
});

// GET /api/portal/admin/product-categories
router.get("/admin/product-categories", requirePortalAdmin, async (_req, res) => {
  try {
    return res.json(await listProductCategories());
  } catch (err) {
    return res.status(500).json({ error: "Gagal memuat kategori" });
  }
});

// POST /api/portal/admin/products  — create a new product (admin only)
router.post("/admin/products", requirePortalAdmin, async (req, res) => {
  const { name, description, price, imageUrl, mediaItems, unit, unitOptions, categories } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ message: "Nama produk harus diisi" });
  }
  try {
    const created = await createProduct({ name, description, price, imageUrl, mediaItems, unit, unitOptions, categories });
    return res.status(201).json(created);
  } catch (err) {
    console.error("[portal] createProduct error", err);
    return res.status(500).json({ error: "Gagal membuat produk" });
  }
});

// PUT /api/portal/admin/products/:id  — update product (admin only)
router.put("/admin/products/:id", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const result = await updateProduct(id, req.body ?? {});
    broadcastToPortal("price_sync", { ts: Date.now() });
    return res.json(result);
  } catch (err: any) {
    if (err?.statusCode === 400) return res.status(400).json({ message: err.message });
    console.error("[portal] updateProduct error", err);
    return res.status(500).json({ error: "Gagal update produk" });
  }
});

// DELETE /api/portal/admin/products/:id — hapus produk (admin only)
router.delete("/admin/products/:id", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const { mediaUrlsToDelete } = await deleteProduct(id);
    for (const url of mediaUrlsToDelete) deleteFromSupabase(url).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error("[portal] deleteProduct error", err);
    return res.status(500).json({ error: "Gagal hapus produk" });
  }
});

// POST /api/portal/admin/upload  — direct image upload, returns { url } (admin only)
const _objectStorage = new ObjectStorageService();
const _multerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/admin/upload", requirePortalAdmin, _multerUpload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: "File gambar wajib diisi" });
  const _ADMIN_IMG_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);
  if (!_ADMIN_IMG_MIME.has(file.mimetype)) return res.status(415).json({ message: "Hanya file gambar (JPG, PNG, WebP, HEIC) yang diizinkan" });
  // C2-REMEDIATION: magic-byte signature check
  const magicCheck = validateMagicBytes(file.buffer, file.mimetype);
  if (!magicCheck.ok) return res.status(400).json({ message: magicCheck.errorMessage });
  try {
    const { buffer, contentType } = await compressImageBuffer(file.buffer, file.mimetype, "photo");
    const objectId = randomUUID();
    const url = await _objectStorage.uploadPublicAsset(buffer, objectId, contentType);
    return res.json({ url });
  } catch (err) {
    req.log?.error({ err }, "admin/upload: Supabase upload gagal");
    return res.status(500).json({ message: "Gagal mengunggah gambar" });
  }
});

const _portalUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB hard cap enforced by multer/server
});

// POST /api/portal/order-upload
// Server-side proxy upload: file goes through the API server so multer enforces
// the 20 MB size limit before any byte reaches object storage.  This replaces
// the old presigned-URL flow (/order-upload-url) which issued unconstrained GCS
// PUT URLs that bypassed all server-side size limits.
router.post("/order-upload", requirePortalAuth, (req, res, next) => {
  _portalUpload.single("file")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ message: "Ukuran file melebihi batas 20 MB." }); return;
      }
      res.status(400).json({ message: "Upload gagal: " + (err as Error).message }); return;
    }
    next();
  });
}, async (req, res) => {
  const customerId = (req as unknown as PortalAuthReq).portalCustomerId;
  if (!req.file) return res.status(400).json({ message: "File wajib diunggah" });
  // C2-REMEDIATION: magic-byte signature check
  const magicCheck = validateMagicBytes(req.file.buffer, req.file.mimetype);
  if (!magicCheck.ok) return res.status(400).json({ message: magicCheck.errorMessage });
  try {
    return res.json(await uploadOrderFile(customerId, req.file));
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) return res.status(err.statusCode).json({ message: err.message });
    return res.status(500).json({ message: "Gagal mengunggah file" });
  }
});

// POST /api/portal/payment-proof-upload — requires portal auth (RC2.1 blocker fix)
// Auth enforced before multer so unauthenticated requests are rejected before
// any file bytes are processed or written to object storage.
const _proofUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.post("/payment-proof-upload", requirePortalAuth, (req, res, next) => {
  _proofUpload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ message: "Ukuran file melebihi batas 10 MB." }); return;
    }
    if (err) { res.status(400).json({ message: "Upload gagal" }); return; }
    next();
  });
}, async (req, res) => {
  const ip = ((req.ip ?? req.socket?.remoteAddress) || "unknown").replace(/^::ffff:/, "");
  if (!req.file) return res.status(400).json({ message: "File wajib diunggah" });
  // C2-REMEDIATION: magic-byte signature check
  const magicCheck = validateMagicBytes(req.file.buffer, req.file.mimetype);
  if (!magicCheck.ok) return res.status(400).json({ message: magicCheck.errorMessage });
  try {
    return res.json(await uploadPaymentProof(ip, req.file));
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) return res.status(err.statusCode).json({ message: err.message });
    return res.status(500).json({ message: "Gagal mengunggah file" });
  }
});

// POST /api/portal/order-upload-url  — DEPRECATED, kept for backward compat.
// Returns 410 Gone so old clients fail visibly rather than silently.
router.post("/order-upload-url", requirePortalAuth, (_req, res) => {
  return res.status(410).json({ message: "Endpoint ini sudah tidak aktif. Gunakan /api/portal/order-upload (multipart/form-data)." });
});

// GET /api/portal/orders — returns sales orders for the authenticated portal customer
router.get("/orders", requirePortalAuth, async (req, res) => {
  const portalCustId = (req as PortalAuthReq).portalCustomerId;
  try {
    return res.json(await listSalesOrders(portalCustId));
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// GET /api/portal/logistic-orders — returns logistic orders for the authenticated portal customer
router.get("/logistic-orders", requirePortalAuth, async (req, res) => {
  const portalCustId = (req as PortalAuthReq).portalCustomerId;
  try {
    return res.json(await listLogisticOrders(portalCustId));
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// GET /api/portal/product-orders — returns portal product orders for the customer
router.get("/product-orders", requirePortalAuth, async (req, res) => {
  const portalCustId = (req as PortalAuthReq).portalCustomerId;
  try {
    return res.json(await listProductOrders(portalCustId));
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// POST /api/portal/orders — place a new order from the portal
router.post("/orders", requirePortalAuth, async (req, res) => {
  const portalCustId = (req as PortalAuthReq).portalCustomerId;
  const { items, notes, expectedDate, paymentType } = req.body ?? {};
  try {
    const result = await createSalesOrder(portalCustId, { items, notes, expectedDate, paymentType });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// PATCH /api/portal/orders/:id/cancel — cancel a portal sales order (owning customer only)
router.patch("/orders/:id/cancel", requirePortalAuth, async (req, res) => {
  const portalCustId = (req as PortalAuthReq).portalCustomerId;
  const id = Number(String(req.params.id));
  try {
    return res.json(await cancelSalesOrder(portalCustId, id));
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// PATCH /api/portal/logistic-orders/:id/cancel — cancel a portal logistic order (owning customer only)
router.patch("/logistic-orders/:id/cancel", requirePortalAuth, async (req, res) => {
  const portalCustId = (req as PortalAuthReq).portalCustomerId;
  const id = Number(String(req.params.id));
  try {
    return res.json(await cancelLogisticOrder(portalCustId, id));
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// ── Delivery Vendors ────────────────────────────────────────────────────────

// GET /api/portal/delivery-vendors — public: return active vendors (sorted)
router.get("/delivery-vendors", async (_req, res) => {
  try {
    return res.json(await listVendors(false));
  } catch (err) {
    console.error("[portal] listVendors error", err);
    return res.status(500).json({ error: "Gagal memuat vendor" });
  }
});

// GET /api/portal/admin/delivery-vendors — admin: return ALL vendors
router.get("/admin/delivery-vendors", requirePortalAdmin, async (_req, res) => {
  try {
    return res.json(await listVendors(true));
  } catch (err) {
    console.error("[portal] listVendors (admin) error", err);
    return res.status(500).json({ error: "Gagal memuat vendor" });
  }
});

// POST /api/portal/admin/delivery-vendors — create vendor
router.post("/admin/delivery-vendors", requirePortalAdmin, async (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim())
    return res.status(400).json({ message: "Nama vendor harus diisi" });
  try {
    const created = await createVendor(req.body ?? {});
    return res.status(201).json(created);
  } catch (err) {
    console.error("[portal] createVendor error", err);
    return res.status(500).json({ error: "Gagal membuat vendor" });
  }
});

// PUT /api/portal/admin/delivery-vendors/:id — update vendor
router.put("/admin/delivery-vendors/:id", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const updated = await updateVendor(id, req.body ?? {});
    return res.json(updated);
  } catch (err: any) {
    if (err?.statusCode === 400) return res.status(400).json({ message: err.message });
    if (err?.statusCode === 404) return res.status(404).json({ message: err.message });
    console.error("[portal] updateVendor error", err);
    return res.status(500).json({ error: "Gagal update vendor" });
  }
});

// DELETE /api/portal/admin/delivery-vendors/:id — delete vendor
router.delete("/admin/delivery-vendors/:id", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const { logoUrl } = await deleteVendor(id);
    if (logoUrl) deleteFromSupabase(logoUrl).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error("[portal] deleteVendor error", err);
    return res.status(500).json({ error: "Gagal hapus vendor" });
  }
});

// ---- Pricing Rates (Trucking & Freight) ----

// GET /api/portal/trucking-rates — public
router.get("/trucking-rates", async (_req, res) => {
  return res.json(await getTruckingRates());
});

// GET /api/portal/admin/trucking-rates
router.get("/admin/trucking-rates", requirePortalAdmin, async (_req, res) => {
  return res.json(await getTruckingRates());
});

// PUT /api/portal/admin/trucking-rates
router.put("/admin/trucking-rates", requirePortalAdmin, async (req, res) => {
  const rates = req.body as Record<string, { ratePerKm: number; loadingFee: number }>;
  if (!rates || typeof rates !== "object") return res.status(400).json({ message: "Format tidak valid" });
  await setTruckingRates(rates);
  broadcastToPortal("price_sync", { ts: Date.now(), type: "trucking_rates" });
  return res.json({ ok: true });
});

// GET /api/portal/admin/freight-rates
router.get("/admin/freight-rates", requirePortalAdmin, async (_req, res) => {
  return res.json(await getFreightRates());
});

// PUT /api/portal/admin/freight-rates
router.put("/admin/freight-rates", requirePortalAdmin, async (req, res) => {
  if (!req.body || typeof req.body !== "object") return res.status(400).json({ message: "Format tidak valid" });
  await setFreightRates(req.body);
  broadcastToPortal("price_sync", { ts: Date.now(), type: "freight_rates" });
  return res.json({ ok: true });
});

// POST /api/portal/admin/fix-jasa-names — one-time: strip 'Jasa ' prefix from product names
router.post("/admin/fix-jasa-names", requirePortalAdmin, async (req, res) => {
  const key = req.headers["x-admin-key"];
  const adminKey = await getAppConfig("PORTAL_ADMIN_KEY");
  if (!adminKey || key !== adminKey) { res.status(401).json({ message: "Unauthorized" }); return; }
  const rows = await db
    .select({ id: productsTable.id, name: productsTable.name })
    .from(productsTable)
    .where(sql`${productsTable.name} ILIKE 'Jasa %'`);

  const updated: { id: number; oldName: string; newName: string }[] = [];
  for (const row of rows) {
    const newName = row.name.replace(/^Jasa\s+/i, "");
    await db.update(productsTable).set({ name: newName }).where(eq(productsTable.id, row.id));
    updated.push({ id: row.id, oldName: row.name, newName });
  }
  return res.json({ fixed: updated.length, items: updated });
});

// GET /api/portal/cargo-types — public, returns cargo type list
router.get("/cargo-types", async (_req, res) => {
  try {
    const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, "cargo_types"));
    const types = row ? JSON.parse(row.value) : ["Electronics", "Textiles", "Furniture", "Food & Beverage", "Chemicals", "Machinery", "Automotive Parts", "Medical Supplies", "Paper & Printing", "Raw Materials"];
    return res.json(types);
  } catch {
    return res.json(["Electronics", "Textiles", "Furniture", "Food & Beverage", "Chemicals"]);
  }
});

// GET /api/portal/logistics-subcategories — public, returns logistics subcategory list
router.get("/logistics-subcategories", async (_req, res) => {
  try {
    const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, "logistics_subcategories"));
    const cats = row ? JSON.parse(row.value) : LOGISTICS_SUBCATEGORIES_FALLBACK;
    return res.json(cats);
  } catch {
    return res.json(LOGISTICS_SUBCATEGORIES_FALLBACK);
  }
});

const requestQuoteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: keyGen,
  message: { error: "Terlalu banyak permintaan. Coba lagi dalam 1 jam." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/portal/request-quote — public, no auth required
router.post("/request-quote", requestQuoteLimiter, async (req, res) => {
  const {
    name, email, whatsapp, service, origin, destination,
    weight, length, width, height, incoterms, insurance, express, result,
  } = req.body as {
    name: string; email?: string; whatsapp: string;
    service: string; origin: string; destination: string;
    weight?: string; length?: string; width?: string; height?: string;
    incoterms?: string; insurance?: boolean; express?: boolean;
    result?: {
      baseCost?: number; weightCost?: number; handlingFee?: number;
      customsFee?: number; insuranceFee?: number; expressFee?: number;
      total?: number; chargeableWeight?: number; cbm?: number;
    };
  };
  try {
    return res.json(await submitRequestQuote({
      name, email, whatsapp, service, origin, destination,
      weight, length, width, height, incoterms, insurance, express, result,
    }));
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) {
      return res.status(err.statusCode).json({ error: err.message, ...(err.payload ?? {}) });
    }
    throw err;
  }
});

// GET /api/portal/quote-requests — daftar semua request quote (BizPortal admin)
router.get("/quote-requests", async (req, res) => {
  if (!(await requireClerkUser(req, res))) return;
  const status = req.query.status as string | undefined;
  try {
    return res.json(await listQuoteRequests(status));
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) return res.status(err.statusCode).json({ message: err.message });
    throw err;
  }
});

// PATCH /api/portal/quote-requests/:id — update status/notes/handledBy (BizPortal admin)
router.patch("/quote-requests/:id", async (req, res): Promise<void> => {
  if (!(await requireClerkUser(req, res))) return;
  const id = Number(String(req.params.id));
  if (!id) { res.status(400).json({ error: "invalid id" }); return; }
  const { status, notes, handledBy } = req.body ?? {};
  try {
    res.json(await updateQuoteRequest(id, { status, notes, handledBy }));
  } catch (err) {
    if (err instanceof LogisticOrderServiceError) { res.status(err.statusCode).json({ message: err.message }); return; }
    throw err;
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ONBOARDING ROUTES
// ════════════════════════════════════════════════════════════════════════════

const onboardingUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/portal/onboarding/status
router.get("/onboarding/status", requirePortalAuth, async (req, res): Promise<void> => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const result = await getOnboardingStatus(customerId);
  res.json(result);
});

// Rate limit KTP OCR: max 5 calls per customer per hour (gpt-4o is expensive)
const _ktpOcrRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Terlalu banyak permintaan OCR. Coba lagi dalam 1 jam." },
  keyGenerator: (req) => {
    const customerId = (req as PortalAuthReq).portalCustomerId?.toString();
    if (customerId) return customerId;
    const raw =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.socket.remoteAddress ??
      "unknown";
    return ipKeyGenerator(raw);
  },
});

// KTP OCR hanya menerima gambar — PDF dan dokumen lain ditolak sebelum OCR dipanggil
const _KTP_OCR_ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

// POST /api/portal/onboarding/ktp-ocr — upload KTP image → OCR
router.post("/onboarding/ktp-ocr", requirePortalAuth, _ktpOcrRateLimit, onboardingUpload.single("file"), async (req, res): Promise<void> => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  if (!req.file) { res.status(400).json({ ok: false, error: "File tidak ditemukan." }); return; }

  // C2-REMEDIATION: validasi MIME + magic byte sebelum OCR dipanggil
  const mimeCheck = validateUploadFile(req.file, {
    allowedMime: _KTP_OCR_ALLOWED_MIME,
    allowedExt: ["jpg", "jpeg", "png", "webp"],
    maxSizeBytes: 10 * 1024 * 1024,
  });
  if (!mimeCheck.ok) { res.status(415).json({ ok: false, error: mimeCheck.errorMessage }); return; }
  const magicCheck = validateMagicBytes(req.file.buffer, req.file.mimetype);
  if (!magicCheck.ok) { res.status(400).json({ ok: false, error: magicCheck.errorMessage }); return; }

  try {
    const data = await runKtpOcr(customerId, req.file.buffer, req.file.mimetype);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("[ktp-ocr]", err);
    res.status(500).json({ ok: false, error: "OCR gagal. Pastikan OpenAI API key dikonfigurasi." });
  }
});

// POST /api/portal/onboarding/upload-doc — upload any document to object storage (PRIVATE)
// Dokumen identitas (KTP, SIM, STNK, legality) disimpan di private bucket,
// bukan public, karena mengandung data sensitif pelanggan.
router.post("/onboarding/upload-doc", requirePortalAuth, onboardingUpload.single("file"), async (req, res): Promise<void> => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  if (!req.file) { res.status(400).json({ ok: false, error: "File tidak ditemukan." }); return; }
  const docType = String(req.body?.docType ?? "doc");

  // C2-REMEDIATION: magic-byte check — verifikasi konten buffer cocok dengan MIME sebelum disimpan
  const magicCheck = validateMagicBytes(req.file.buffer, req.file.mimetype);
  if (!magicCheck.ok) { res.status(400).json({ ok: false, error: magicCheck.errorMessage }); return; }

  try {
    const result = await uploadOnboardingDoc(customerId, req.file.buffer, req.file.mimetype, req.file.originalname, docType);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    if (err instanceof OnboardingServiceError && err.statusCode === 415) {
      res.status(415).json({ ok: false, error: err.message }); return;
    }
    console.error("[upload-doc]", err);
    res.status(500).json({ ok: false, error: "Gagal upload file." });
  }
});

// POST /api/portal/onboarding/complete — submit full profile
router.post(
  "/onboarding/complete",
  requirePortalAuth,
  validateBody(CompleteOnboardingSchema),
  async (req, res): Promise<void> => {
    const customerId = (req as PortalAuthReq).portalCustomerId;
    const { fullName, phone, address, accountType, ktpUrl, ocrData, vendor, driver, employee } = req.body ?? {};

    try {
      const result = await completeOnboarding(customerId, { fullName, phone, address, accountType, ktpUrl, ocrData, vendor, driver, employee });
      res.json(result);
    } catch (err: any) {
      if (err instanceof OnboardingServiceError && err.statusCode === 409) {
        res.status(409).json({ ok: false, error: err.message }); return;
      }
      throw err;
    }
  }
);

// GET /api/portal/admin/approvals — list approval requests (portal admin)
router.get("/admin/approvals", requirePortalAdmin, async (req, res): Promise<void> => {
  try {
    const data = await listApprovals({
      status:      req.query.status as string | undefined,
      accountType: req.query.accountType as string | undefined,
    });
    res.json(data);
  } catch (err) {
    console.error("[portal] listApprovals error", err);
    res.status(500).json({ error: "Gagal memuat approvals" });
  }
});

// PATCH /api/portal/admin/approvals/:id — approve or reject
router.patch("/admin/approvals/:id", requirePortalAdmin, async (req, res): Promise<void> => {
  const id = Number(String(req.params.id));
  const { status, adminNote, reviewedBy } = req.body ?? {};
  if (!id || !["approved", "rejected"].includes(status)) {
    res.status(400).json({ error: "status must be approved or rejected" });
    return;
  }
  try {
    const result = await processApproval({
      id,
      status,
      adminNote,
      reviewedBy,
      adminPortalCustomerId: (req as import("../lib/supabaseAuth.js").PortalAuthReq).portalCustomerId,
      ip: ((req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim())
          ?? req.socket?.remoteAddress
          ?? "unknown",
      userAgent: (req.headers["user-agent"] as string) ?? "unknown",
    });
    res.json(result);
  } catch (err: any) {
    if (err?.statusCode === 404) { res.status(404).json({ error: "Not found" }); return; }
    console.error("[portal] processApproval error", err);
    res.status(500).json({ error: "Approval transaction failed" });
  }
});

// GET /api/portal/admin/approvals/:id/identity-docs — dokumen identitas vendor/driver
router.get("/admin/approvals/:id/identity-docs", requirePortalAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID tidak valid" }); return; }
  try {
    const result = await getApprovalIdentityDocs(id);
    if (!result) { res.status(404).json({ error: "Approval tidak ditemukan" }); return; }
    res.json(result);
  } catch (err) {
    console.error("[portal] identity-docs error", err);
    res.status(500).json({ error: "Gagal memuat dokumen" });
  }
});

// GET /api/portal/admin/approvals/:id/audit — audit trail untuk 1 approval
router.get("/admin/approvals/:id/audit", requirePortalAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: "ID tidak valid" });
    return;
  }
  try {
    const data = await getApprovalAuditTrail(id);
    res.json(data);
  } catch (err) {
    console.error("[portal] audit trail error", err);
    res.status(500).json({ ok: false, error: "Gagal memuat audit trail" });
  }
});

// GET /api/portal/admin/approvals/stats — quick stats for admin dashboard
router.get("/admin/approvals/stats", requirePortalAdmin, async (_req, res): Promise<void> => {
  try {
    const stats = await getApprovalStats();
    res.json(stats);
  } catch (err) {
    console.error("[portal] approvalStats error", err);
    res.status(500).json({ error: "Gagal memuat stats" });
  }
});

// GET /api/portal/admin/wa-logs — daftar log notifikasi WhatsApp (admin only)
router.get("/admin/wa-logs", requirePortalAdmin, async (req, res): Promise<void> => {
  try {
    const status  = String(req.query["status"]  ?? "").trim() || null;
    const context = String(req.query["context"] ?? "").trim() || null;
    const refId   = String(req.query["refId"]   ?? "").trim() || null;
    const from    = req.query["from"] ? new Date(String(req.query["from"])) : null;
    const to      = req.query["to"]   ? new Date(String(req.query["to"]))   : null;
    const limit   = Math.min(parseInt(String(req.query["limit"]  ?? "50"), 10) || 50, 200);
    const offset  = Math.max(parseInt(String(req.query["offset"] ?? "0"),  10) || 0, 0);

    const conditions = [eq(notificationLogsTable.channel, "wa")];
    if (status)  conditions.push(eq(notificationLogsTable.status, status));
    if (context) conditions.push(eq(notificationLogsTable.context, context));
    if (refId)   conditions.push(eq(notificationLogsTable.refId, refId));
    if (from && !isNaN(from.getTime())) conditions.push(gte(notificationLogsTable.createdAt, from));
    if (to   && !isNaN(to.getTime()))   conditions.push(lte(notificationLogsTable.createdAt, to));

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id:               notificationLogsTable.id,
          recipient:        notificationLogsTable.recipient,
          status:           notificationLogsTable.status,
          context:          notificationLogsTable.context,
          refType:          notificationLogsTable.refType,
          refId:            notificationLogsTable.refId,
          errorMsg:         notificationLogsTable.errorMsg,
          retryCount:       notificationLogsTable.retryCount,
          nextRetryAt:      notificationLogsTable.nextRetryAt,
          waMessageId:      notificationLogsTable.waMessageId,
          waDeliveryStatus: notificationLogsTable.waDeliveryStatus,
          deliveredAt:      notificationLogsTable.deliveredAt,
          readAt:           notificationLogsTable.readAt,
          createdAt:        notificationLogsTable.createdAt,
        })
        .from(notificationLogsTable)
        .where(and(...conditions))
        .orderBy(desc(notificationLogsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(notificationLogsTable)
        .where(and(...conditions)),
    ]);

    res.json({
      total, limit, offset,
      rows: rows.map((r) => ({
        ...r,
        nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        readAt:      r.readAt?.toISOString() ?? null,
        createdAt:   r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[portal] waLogs error", err);
    res.status(500).json({ error: "Gagal memuat log WhatsApp" });
  }
});

// GET /api/portal/admin/wa-logs/stats — ringkasan sukses/gagal notifikasi WA (admin only)
router.get("/admin/wa-logs/stats", requirePortalAdmin, async (_req, res): Promise<void> => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [allTime, today] = await Promise.all([
      db.select({
          status: notificationLogsTable.status,
          count:  sql<number>`COUNT(*)::int`,
        })
        .from(notificationLogsTable)
        .where(eq(notificationLogsTable.channel, "wa"))
        .groupBy(notificationLogsTable.status),
      db.select({
          status: notificationLogsTable.status,
          count:  sql<number>`COUNT(*)::int`,
        })
        .from(notificationLogsTable)
        .where(and(eq(notificationLogsTable.channel, "wa"), gte(notificationLogsTable.createdAt, todayStart)))
        .groupBy(notificationLogsTable.status),
    ]);

    function agg(rows: { status: string; count: number }[]) {
      const r = { sent: 0, failed: 0, deduped: 0 };
      for (const row of rows) {
        if (row.status === "sent")    r.sent    += row.count;
        if (row.status === "failed") r.failed += row.count;
        if (row.status === "deduped") r.deduped += row.count;
      }
      return r;
    }

    res.json({ allTime: agg(allTime), today: agg(today) });
  } catch (err) {
    console.error("[portal] waLogsStats error", err);
    res.status(500).json({ error: "Gagal memuat stats WhatsApp" });
  }
});

// POST /api/portal/admin/wa-logs/:id/retry — kirim ulang manual notifikasi WA gagal (admin only)
router.post("/admin/wa-logs/:id/retry", requirePortalAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ message: "ID tidak valid" }); return; }

  const [row] = await db
    .select()
    .from(notificationLogsTable)
    .where(and(eq(notificationLogsTable.id, id), eq(notificationLogsTable.channel, "wa")))
    .limit(1);

  if (!row) { res.status(404).json({ message: "Log tidak ditemukan" }); return; }
  if (row.status !== "failed") { res.status(400).json({ message: "Hanya log berstatus 'failed' yang bisa di-retry" }); return; }
  if ((row.retryCount ?? 0) >= 3) { res.status(400).json({ message: "Sudah mencapai batas maksimum retry (3x)" }); return; }

  const fonnteToken = process.env["FONNTE_TOKEN"] ?? "";
  if (!fonnteToken) { res.status(500).json({ message: "FONNTE_TOKEN tidak dikonfigurasi" }); return; }

  try {
    const params: Record<string, string> = { target: row.recipient, message: row.message };
    if (row.mediaUrl?.trim()) params["url"] = row.mediaUrl.trim();

    const fRes = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: fonnteToken, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const fBody = await fRes.json() as Record<string, unknown>;
    const ok = fRes.ok && fBody["status"] !== false && fBody["status"] !== "false";
    const rawId = fBody["id"] ?? fBody["message_id"] ?? fBody["messageId"];
    const waMessageId = ok && rawId ? String(Array.isArray(rawId) ? rawId[0] : rawId) : undefined;
    const newRetryCount = (row.retryCount ?? 0) + 1;

    if (ok) {
      await db.update(notificationLogsTable).set({
        status: "sent",
        retryCount: newRetryCount,
        nextRetryAt: null,
        errorMsg: null,
        waMessageId: waMessageId ?? null,
        waDeliveryStatus: waMessageId ? "sent" : null,
      }).where(eq(notificationLogsTable.id, id));

      res.json({ ok: true, waMessageId });
      return;
    } else {
      const errMsg = String(fBody["reason"] ?? fBody["message"] ?? `HTTP ${fRes.status}`);
      const backoffMs = 5 * 60 * 1000 * Math.pow(2, newRetryCount - 1);
      const nextRetry = newRetryCount < 3 ? new Date(Date.now() + backoffMs) : null;

      await db.update(notificationLogsTable).set({
        retryCount: newRetryCount,
        nextRetryAt: nextRetry,
        errorMsg: `[retry ${newRetryCount}] ${errMsg}`,
      }).where(eq(notificationLogsTable.id, id));

      res.status(502).json({ ok: false, message: errMsg });
      return;
    }
  } catch (err) {
    console.error("[portal] waLogsRetry error", err);
    res.status(500).json({ message: "Gagal melakukan retry" });
  }
});

// GET /api/portal/admin/customers/:id — detail satu customer (admin only)
router.get("/admin/customers/:id", requirePortalAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID tidak valid" }); return; }
  try {
    const [cust] = await db
      .select({
        id:          portalCustomersTable.id,
        name:        portalCustomersTable.name,
        email:       portalCustomersTable.email,
        phone:       portalCustomersTable.phone,
        company:     portalCustomersTable.company,
        role:        portalCustomersTable.role,
        avatarUrl:   sql<string | null>`${portalCustomersTable}.avatar_url`,
        oauthProvider: portalCustomersTable.oauthProvider,
        createdAt:   portalCustomersTable.createdAt,
      })
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, id))
      .limit(1);
    if (!cust) { res.status(404).json({ error: "Customer tidak ditemukan" }); return; }

    const [prof] = await db
      .select()
      .from(portalCustomerProfilesTable)
      .where(eq(portalCustomerProfilesTable.customerId, id))
      .limit(1);

    res.json({ ...cust, profile: prof ?? null });
  } catch (err) {
    console.error("[portal] GET /admin/customers/:id error", err);
    res.status(500).json({ error: "Gagal memuat data customer" });
  }
});

// GET /api/portal/admin/customers — list all portal customers (with onboarding status)
router.get("/admin/customers", requirePortalAdmin, async (req, res): Promise<void> => {
  try {
    const data = await listCustomers({
      role: req.query.role as string | undefined,
      q:    req.query.q    as string | undefined,
    });
    res.json(data);
  } catch (err) {
    console.error("[portal] listCustomers error", err);
    res.status(500).json({ error: "Gagal memuat customers" });
  }
});

// GET /api/portal/admin/customers/stats — quick stats
router.get("/admin/customers/stats", requirePortalAdmin, async (_req, res): Promise<void> => {
  try {
    const stats = await getCustomerStats();
    res.json(stats);
  } catch (err) {
    console.error("[portal] customerStats error", err);
    res.status(500).json({ error: "Gagal memuat statistik customers" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// VENDOR MINI FORM — portal admin routes
// ════════════════════════════════════════════════════════════════════════════

router.get("/admin/vendor-form/links", requirePortalAdmin, async (req, res) => {
  try {
    const formTarget = (req.query["formTarget"] as string) || "vendor";
    return res.json(await listVendorFormLinks(formTarget));
  } catch (err) {
    console.error("[portal] listVendorFormLinks error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/vendor-form/schemas", requirePortalAdmin, async (_req, res) => {
  return res.json(SERVICE_SCHEMAS);
});

router.post("/admin/vendor-form/links", requirePortalAdmin, async (req, res) => {
  try {
    const link = await createVendorFormLink(req.body ?? {});
    return res.status(201).json(link);
  } catch (err: any) {
    if (err?.statusCode === 400) return res.status(400).json({ error: err.message });
    req.log?.error({ err }, "portal admin POST vendor-form/links error");
    return res.status(500).json({ error: "Gagal membuat link" });
  }
});

router.patch("/admin/vendor-form/links/:id", requirePortalAdmin, async (req, res) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const updated = await patchVendorFormLink(id, req.body ?? {});
    invalidateTokenCache(updated.token);
    return res.json(updated);
  } catch (err: any) {
    if (err?.statusCode === 400) return res.status(400).json({ error: err.message });
    if (err?.statusCode === 404) return res.status(404).json({ error: err.message });
    req.log?.error({ err }, "portal admin PATCH vendor-form/links error");
    return res.status(500).json({ error: "Gagal update link" });
  }
});

router.delete("/admin/vendor-form/links/:id", requirePortalAdmin, async (req, res) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const { token } = await deleteVendorFormLink(id);
    invalidateTokenCache(token);
    return res.json({ ok: true });
  } catch (err: any) {
    if (err?.statusCode === 404) return res.status(404).json({ error: err.message });
    req.log?.error({ err }, "portal admin DELETE vendor-form/links error");
    return res.status(500).json({ error: "Gagal hapus link" });
  }
});

router.get("/admin/vendor-form/submissions", requirePortalAdmin, async (_req, res) => {
  try {
    return res.json(await listVendorFormSubmissions());
  } catch (err) {
    console.error("[vendor-form/submissions] error:", err);
    return res.status(500).json({ error: "Internal server error", detail: String(err) });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CALCULATOR RATES
// ════════════════════════════════════════════════════════════════════════════

// GET /api/portal/admin/erp-stats — quick stats for the BizPortal ERP tab (portal admin only)
router.get("/admin/erp-stats", requirePortalAdmin, async (_req, res) => {
  try {
    const stats = await getErpStats();
    return res.json(stats);
  } catch (err) {
    console.error("[erp-stats]", err);
    return res.status(500).json({ error: "Gagal mengambil statistik ERP" });
  }
});

// ════════════════════════════════════════════════════════════════════════════

// GET /api/portal/calculator-rates — public, returns current calculator rates (legacy)
router.get("/calculator-rates", async (_req, res) => {
  return res.json(await getCalculatorRates());
});

// GET /api/portal/calculator-rates-v2 — public, returns extended service-specific rates
router.get("/calculator-rates-v2", async (_req, res) => {
  return res.json(await getCalculatorRatesV2());
});

// ── Customer / Vendor Dashboard Stats ──────────────────────────────────────
// GET /api/portal/me/dashboard-stats
// Returns role-based stats: customer gets order/invoice stats, vendor gets RFQ stats
router.get("/me/dashboard-stats", requirePortalAuth, async (req, res) => {
  const portalReq = req as PortalAuthReq;
  const { portalCustomerId: customerId, portalRole: role } = portalReq;
  try {
    return res.json(await getPortalDashboardStats(customerId, role));
  } catch (err) {
    req.log?.error({ err }, "dashboard-stats error");
    // Graceful fallback — don't break the dashboard if tables don't exist yet
    if (role === "vendor") {
      return res.json({ rfqReceived: 0, rfqSubmitted: 0, fulfillmentPending: 0, completedOrders: 0 });
    }
    return res.json({
      totalOrders: 0, activeOrders: 0, completedOrders: 0,
      invoiceOutstandingCount: 0, invoiceOutstandingAmount: 0, trackingActive: 0,
    });
  }
});

// GET /api/portal/me/invoices — Customer invoice list (from sales_documents)
router.get("/me/invoices", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  try {
    const result = await db.execute<{
      id: number;
      invoiceNumber: string;
      amount: string;
      status: string;
      dueDate: string | null;
      createdAt: string;
      orderNumber: string | null;
    }>(sql`
      SELECT
        id,
        doc_number      AS "invoiceNumber",
        grand_total     AS amount,
        invoice_status  AS status,
        due_date        AS "dueDate",
        created_at      AS "createdAt",
        order_number    AS "orderNumber"
      FROM sales_documents
      WHERE status NOT IN ('cancelled', 'draft')
        AND LOWER(customer_name) = LOWER(
          (SELECT name FROM portal_customers WHERE id = ${customerId} LIMIT 1)
        )
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return res.json(result.rows.map(r => ({
      ...r,
      amount: Number(r.amount ?? 0),
    })));
  } catch (err) {
    req.log?.error({ err }, "portal me/invoices error");
    return res.status(500).json({ error: "Gagal memuat invoice" });
  }
});

// ── GET /api/portal/vendor-catalog/compare — Perbandingan harga antar vendor ──
router.get("/vendor-catalog/compare", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { type } = req.query as Record<string, string>;
    return res.json(await compareVendorCatalog(type));
  } catch (err) {
    req.log?.error({ err }, "vendor-catalog/compare error");
    return res.status(500).json({ message: "Gagal memuat perbandingan" });
  }
});

// ── GET /api/portal/vendor-catalog — Etalase vendor publik ───────────────────
router.get("/vendor-catalog", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { type, kategori } = req.query as Record<string, string>;
    return res.json(await listVendorCatalogPublic({ type, kategori }));
  } catch (err) {
    req.log?.error({ err }, "vendor-catalog error");
    return res.status(500).json({ message: "Gagal memuat katalog vendor" });
  }
});

// ── GET /api/portal/product-templates — Template produk publik ────────────────
router.get("/product-templates", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    return res.json(await listProductTemplates());
  } catch (err) {
    req.log?.error({ err }, "product-templates error");
    return res.status(500).json({ message: "Gagal memuat template produk" });
  }
});

// ── GET /api/portal/service-templates — Template layanan publik ───────────────
router.get("/service-templates", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    return res.json(await listServiceTemplates());
  } catch (err) {
    req.log?.error({ err }, "service-templates error");
    return res.status(500).json({ message: "Gagal memuat template layanan" });
  }
});

// Rate limiter untuk catalog inquiry
const catalogInquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: keyGen,
  message: { message: "Terlalu banyak permintaan. Coba lagi dalam 15 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── POST /api/portal/catalog-inquiry — Minta penawaran dari katalog ──────────
router.post("/catalog-inquiry", catalogInquiryLimiter, async (req, res) => {
  try {
    await submitCatalogInquiry(req.body ?? {}, req.log);
    return res.json({ success: true, message: "Permintaan penawaran berhasil dikirim" });
  } catch (err: unknown) {
    const e = err as Error & { status?: number };
    if (e.status === 400) return res.status(400).json({ message: e.message });
    req.log?.error({ err }, "catalog-inquiry error");
    return res.status(500).json({ message: "Gagal mengirim permintaan" });
  }
});

// primaryImageSubquery, CATALOG_PUBLIC_COLS — moved to portalVendorCatalogService.ts

// GET /api/portal/marketplace/:id/related — items from the same vendor
router.get("/marketplace/:id/related", async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "id tidak valid" });
  const item = await getCatalogItemPublic(id);
  if (!item) return res.status(404).json({ error: "Item tidak ditemukan" });
  try {
    return res.json(await getRelatedItems(id, item));
  } catch (err) {
    req.log?.error({ err }, "related items error");
    return res.status(500).json({ error: "Gagal memuat related items" });
  }
});

// GET /api/portal/marketplace/:id/similar — "customers also viewed" (other vendors)
router.get("/marketplace/:id/similar", async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "id tidak valid" });
  const item = await getCatalogItemPublic(id);
  if (!item) return res.status(404).json({ error: "Item tidak ditemukan" });
  try {
    return res.json(await getSimilarItems(id, item));
  } catch (err) {
    req.log?.error({ err }, "similar items error");
    return res.status(500).json({ error: "Gagal memuat similar items" });
  }
});

// GET /api/portal/marketplace/:id/same-province — products from other vendors in the same province
router.get("/marketplace/:id/same-province", async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "id tidak valid" });
  const item = await getCatalogItemPublic(id);
  if (!item) return res.status(404).json({ error: "Item tidak ditemukan" });
  try {
    return res.json(await getSameProvinceItems(id, item));
  } catch (err) {
    req.log?.error({ err }, "same-province items error");
    return res.status(500).json({ error: "Gagal memuat item provinsi yang sama" });
  }
});

// GET /api/portal/vendors/:vendorId/public-profile — vendor mini profile (no auth, rate limited)
router.get("/vendors/:vendorId/public-profile", vendorPublicProfileLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
  const vendorId = parseInt(String(req.params.vendorId));
  if (isNaN(vendorId)) return res.status(400).json({ error: "vendorId tidak valid" });
  const result = await getVendorPublicProfile(vendorId);
  if (!result) return res.status(404).json({ error: "Vendor tidak ditemukan" });
  return res.json(result);
});

// GET /api/portal/vendors/:vendorId/reviews — public: hanya review published + approved
router.get("/vendors/:vendorId/reviews", async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=60");
  const vendorId = parseInt(String(req.params.vendorId));
  if (isNaN(vendorId)) return res.status(400).json({ error: "vendorId tidak valid" });

  const rows = await db
    .select({
      id: supplierReviewsTable.id,
      ratingOverall: supplierReviewsTable.ratingOverall,
      ratingDelivery: supplierReviewsTable.ratingDelivery,
      ratingCommunication: supplierReviewsTable.ratingCommunication,
      ratingQuality: supplierReviewsTable.ratingQuality,
      reviewText: supplierReviewsTable.reviewText,
      createdAt: supplierReviewsTable.createdAt,
    })
    .from(supplierReviewsTable)
    .where(
      and(
        eq(supplierReviewsTable.supplierId, vendorId),
        eq(supplierReviewsTable.isPublished, true),
        eq(supplierReviewsTable.moderationStatus, "approved"),
      )
    )
    .orderBy(desc(supplierReviewsTable.createdAt))
    .limit(50);

  return res.json(rows);
});

// POST /api/portal/vendors/:vendorId/reviews — buyer membuat review setelah transaksi selesai
// Satu review per transaksi (ditegakkan oleh unique index di DB). Butuh moderasi admin
// sebelum tampil publik (moderationStatus dimulai "pending", isPublished=false).
router.post("/vendors/:vendorId/reviews", requirePortalAuth, async (req, res) => {
  const vendorId = parseInt(String(req.params.vendorId));
  if (isNaN(vendorId)) return res.status(400).json({ error: "vendorId tidak valid" });
  const customerId = (req as PortalAuthReq).portalCustomerId;

  const {
    sourceTransactionType,
    sourceTransactionId,
    ratingOverall,
    ratingDelivery,
    ratingCommunication,
    ratingQuality,
    reviewText,
  } = req.body ?? {};

  const txId = parseInt(String(sourceTransactionId));
  if (!sourceTransactionType || isNaN(txId)) {
    return res.status(400).json({ error: "sourceTransactionType dan sourceTransactionId wajib diisi" });
  }
  const rating = Number(ratingOverall);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "ratingOverall harus angka 1-5" });
  }

  // Akun portal customer ini mungkin terhubung (email/phone) ke supplier tertentu
  // (mis. akun vendor yang juga login sebagai portal customer) — dipakai anti self-review.
  const linkedSupplier = await getLinkedSupplier(customerId).catch(() => null);

  // Verifikasi kepemilikan transaksi + status selesai — tidak semua vendor/customer
  // boleh diklaim, hanya buyer yang benar-benar bertransaksi dengan vendor ini.
  let transactionFound = false;
  let transactionVendorId: number | null = null;
  let transactionCustomerId: number | null = null;
  let transactionStatusEligible = false;

  if (sourceTransactionType === "mkt_purchase_order") {
    const [row] = await db
      .select({ vendorId: mktPurchaseOrdersTable.vendorId, status: mktPurchaseOrdersTable.status, portalCustomerId: mktRfqsTable.portalCustomerId })
      .from(mktPurchaseOrdersTable)
      .innerJoin(mktRfqsTable, eq(mktRfqsTable.id, mktPurchaseOrdersTable.rfqId))
      .where(eq(mktPurchaseOrdersTable.id, txId))
      .limit(1);
    transactionFound = !!row;
    transactionVendorId = row?.vendorId ?? null;
    transactionCustomerId = row?.portalCustomerId ?? null;
    transactionStatusEligible = !!row && ["completed", "closed", "delivered"].includes(String(row.status));
  } else if (sourceTransactionType === "product_order") {
    // portal_product_orders tidak punya kolom portalCustomerId maupun vendorId eksplisit
    // (hanya vendorNameSelected berupa teks bebas dan email/phone pemesan) — verifikasi
    // kepemilikan via kecocokan email/phone dengan akun customer yang login, dan verifikasi
    // vendor via kecocokan nama vendor dengan supplier yang sedang dinilai.
    const [row] = await db
      .select({
        companyId: portalProductOrdersTable.companyId,
        status: portalProductOrdersTable.status,
        email: portalProductOrdersTable.email,
        phone: portalProductOrdersTable.phone,
        vendorNameSelected: portalProductOrdersTable.vendorNameSelected,
      })
      .from(portalProductOrdersTable)
      .where(eq(portalProductOrdersTable.id, txId))
      .limit(1);
    transactionFound = !!row && row.companyId != null;
    transactionStatusEligible = !!row && String(row.status ?? "").toLowerCase().includes("complete");

    if (row) {
      const [requestingCustomer] = await db
        .select({ email: portalCustomersTable.email, phone: portalCustomersTable.phone })
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, customerId))
        .limit(1);
      const normPhone = (p: string | null | undefined) => (p ? p.replace(/[^\d]/g, "").replace(/^0/, "62") : null);
      const emailMatch = !!requestingCustomer?.email && requestingCustomer.email.toLowerCase() === String(row.email ?? "").toLowerCase();
      const phoneMatch = !!requestingCustomer?.phone && normPhone(requestingCustomer.phone) === normPhone(row.phone);
      transactionCustomerId = (emailMatch || phoneMatch) ? customerId : -1;

      // Ambil nama supplier untuk dicocokkan (case-insensitive) — hanya dianggap transaksi
      // milik vendor ini jika nama vendor yang tercatat pada order cocok dengan nama supplier.
      if (row.vendorNameSelected) {
        const [supplierRow] = await db.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, vendorId)).limit(1);
        transactionVendorId = supplierRow && supplierRow.name.trim().toLowerCase() === String(row.vendorNameSelected).trim().toLowerCase() ? vendorId : null;
      }
    }
  } else {
    return res.status(400).json({ error: "sourceTransactionType tidak dikenali" });
  }

  const guard = evaluateReviewEligibility({
    linkedSupplierId: linkedSupplier?.id ?? null,
    vendorId,
    transactionVendorId,
    transactionCustomerId,
    requestingCustomerId: customerId,
    transactionStatusEligible,
    transactionFound,
  });
  if (!guard.ok) {
    return res.status(guard.status).json({ success: false, code: guard.code, message: guard.message });
  }

  try {
    const [created] = await db
      .insert(supplierReviewsTable)
      .values({
        supplierId: vendorId,
        customerId,
        sourceTransactionType,
        sourceTransactionId: txId,
        ratingOverall: String(rating),
        ratingDelivery: ratingDelivery != null ? String(Number(ratingDelivery)) : null,
        ratingCommunication: ratingCommunication != null ? String(Number(ratingCommunication)) : null,
        ratingQuality: ratingQuality != null ? String(Number(ratingQuality)) : null,
        reviewText: reviewText ? String(reviewText).slice(0, 2000) : null,
        isPublished: false,
        moderationStatus: "pending",
      })
      .returning();
    return res.status(201).json({ ok: true, review: created, message: "Review terkirim, menunggu moderasi admin" });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("supplier_reviews_one_per_transaction_idx")) {
      return res.status(409).json({ error: "Anda sudah memberikan review untuk transaksi ini" });
    }
    return res.status(500).json({ error: "Gagal menyimpan review" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR BOOKMARKS — authenticated portal customer can save/unsave vendors
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/portal/vendors/:vendorId/bookmark — check if current user has bookmarked this vendor
router.get("/vendors/:vendorId/bookmark", requirePortalAuth, async (req, res) => {
  const vendorId = parseInt(String(req.params.vendorId));
  if (isNaN(vendorId)) return res.status(400).json({ error: "vendorId tidak valid" });
  const customerId = (req as PortalAuthReq).portalCustomerId;
  try {
    const result = await db.execute(sql`
      SELECT id FROM vendor_bookmarks
      WHERE customer_id = ${customerId} AND vendor_id = ${vendorId}
      LIMIT 1
    `);
    const rows = (result as { rows?: unknown[] }).rows ?? [];
    return res.json({ bookmarked: rows.length > 0 });
  } catch (err) {
    req.log?.warn({ err }, "vendor bookmark check error");
    return res.status(500).json({ error: "Gagal memeriksa bookmark" });
  }
});

// POST /api/portal/vendors/:vendorId/bookmark — add bookmark
router.post("/vendors/:vendorId/bookmark", requirePortalAuth, async (req, res) => {
  const vendorId = parseInt(String(req.params.vendorId));
  if (isNaN(vendorId)) return res.status(400).json({ error: "vendorId tidak valid" });
  const customerId = (req as PortalAuthReq).portalCustomerId;
  try {
    await db.execute(sql`
      INSERT INTO vendor_bookmarks (customer_id, vendor_id)
      VALUES (${customerId}, ${vendorId})
      ON CONFLICT ON CONSTRAINT vendor_bookmarks_customer_vendor_uidx DO NOTHING
    `);
    return res.json({ bookmarked: true });
  } catch (err) {
    req.log?.warn({ err }, "vendor bookmark add error");
    return res.status(500).json({ error: "Gagal menyimpan bookmark" });
  }
});

// DELETE /api/portal/vendors/:vendorId/bookmark — remove bookmark
router.delete("/vendors/:vendorId/bookmark", requirePortalAuth, async (req, res) => {
  const vendorId = parseInt(String(req.params.vendorId));
  if (isNaN(vendorId)) return res.status(400).json({ error: "vendorId tidak valid" });
  const customerId = (req as PortalAuthReq).portalCustomerId;
  try {
    await db.execute(sql`
      DELETE FROM vendor_bookmarks
      WHERE customer_id = ${customerId} AND vendor_id = ${vendorId}
    `);
    return res.json({ bookmarked: false });
  } catch (err) {
    req.log?.warn({ err }, "vendor bookmark delete error");
    return res.status(500).json({ error: "Gagal menghapus bookmark" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR GALLERY — public product media for a vendor
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/portal/vendors/:vendorId/gallery — fetch product_media images for this vendor
router.get("/vendors/:vendorId/gallery", async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
  const vendorId = parseInt(String(req.params.vendorId));
  if (isNaN(vendorId)) return res.status(400).json({ error: "vendorId tidak valid" });
  try {
    const result = await db.execute(sql`
      SELECT
        pm.id,
        pm.vendor_catalog_item_id,
        pm.vendor_id,
        pm.media_type,
        pm.file_url,
        pm.thumbnail_url,
        pm.title,
        pm.description,
        pm.sort_order,
        pm.is_primary,
        vci.name AS item_name,
        vci.template_kind
      FROM product_media pm
      LEFT JOIN vendor_catalog_items vci ON vci.id = pm.vendor_catalog_item_id
      WHERE pm.vendor_id = ${vendorId}
        AND pm.is_active = true
        AND pm.file_url IS NOT NULL
        AND (pm.media_type = 'image' OR pm.media_type IS NULL)
      ORDER BY pm.is_primary DESC, pm.sort_order ASC, pm.id ASC
      LIMIT 100
    `);
    const rows = (result as { rows?: unknown[] }).rows ?? [];
    return res.json(rows);
  } catch (err) {
    req.log?.error({ err }, "vendor gallery error");
    return res.status(500).json({ error: "Gagal memuat galeri" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR CONTACT INQUIRY — submit a contact form to a specific vendor
// ─────────────────────────────────────────────────────────────────────────────

const _contactInquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: keyGen,
  message: { error: "Terlalu banyak permintaan. Coba lagi dalam 15 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/portal/vendors/:vendorId/contact — submit contact inquiry
router.post("/vendors/:vendorId/contact", _contactInquiryLimiter, async (req, res) => {
  const vendorId = parseInt(String(req.params.vendorId));
  if (isNaN(vendorId)) return res.status(400).json({ error: "vendorId tidak valid" });

  const { name, company, email, phone, country, productInterested, quantity, message } = req.body ?? {};

  if (!name || !String(name).trim()) return res.status(400).json({ error: "Nama wajib diisi" });
  if (!phone || !String(phone).trim()) return res.status(400).json({ error: "Nomor telepon wajib diisi" });

  // Generate short inquiry number
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = randomBytes(3).toString("hex").toUpperCase();
  const inquiryNumber = `INQ-${ts}-${rnd}`;

  try {
    // Save to DB
    await db.execute(sql`
      INSERT INTO vendor_contact_inquiries (
        inquiry_number, vendor_id, name, company, email, phone,
        country, product_interested, quantity, message
      ) VALUES (
        ${inquiryNumber},
        ${vendorId},
        ${String(name).trim()},
        ${company ? String(company).trim() : null},
        ${email ? String(email).trim() : null},
        ${String(phone).trim()},
        ${country ? String(country).trim() : null},
        ${productInterested ? String(productInterested).trim() : null},
        ${quantity ? String(quantity).trim() : null},
        ${message ? String(message).trim() : null}
      )
    `);

    // Send WA notification to admin (non-fatal)
    try {
      const adminWa = await getAdminWa();
      const appName = await getAppConfig("APP_NAME", "B2B Marketplace and Logistic");
      if (adminWa) {
        const msg = [
          `📬 *CONTACT SUPPLIER INQUIRY*`,
          `No: ${inquiryNumber}`,
          ``,
          `👤 *Nama:* ${String(name).trim()}`,
          company ? `🏢 *Perusahaan:* ${company}` : null,
          email ? `📧 *Email:* ${email}` : null,
          `📱 *Phone:* ${String(phone).trim()}`,
          country ? `🌏 *Negara:* ${country}` : null,
          ``,
          productInterested ? `📦 *Produk diminati:* ${productInterested}` : null,
          quantity ? `🔢 *Qty:* ${quantity}` : null,
          message ? `📝 *Pesan:* ${message}` : null,
          ``,
          `_${appName}_`,
        ].filter(Boolean).join("\n");
        await sendWhatsApp(adminWa, msg);
      }
    } catch (waErr) {
      req.log?.warn({ waErr }, "WA notification failed for contact inquiry (non-fatal)");
    }

    return res.status(201).json({ success: true, inquiryNumber });
  } catch (err: unknown) {
    req.log?.error({ err }, "vendor contact inquiry error");
    return res.status(500).json({ error: "Gagal mengirim inquiry. Silakan coba lagi." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR CATALOG MEDIA — vendor self-service photo upload
// ─────────────────────────────────────────────────────────────────────────────

// _getLinkedSupplier — moved to portalVendorCatalogService.ts as getLinkedSupplier, imported above

const _vendorImgUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/portal/vendor/catalog — list vendor's own catalog items with media
router.get("/vendor/catalog", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const supplier = await getLinkedSupplier(customerId);
  if (!supplier) return res.status(403).json({ message: "Akun belum terhubung ke data vendor" });
  try {
    return res.json(await listVendorOwnCatalog(supplier.id, supplier.name));
  } catch (e: any) {
    return res.status(500).json({ error: e?.message });
  }
});

// POST /api/portal/vendor/catalog/:itemId/media/upload
router.post(
  "/vendor/catalog/:itemId/media/upload",
  requirePortalAuth,
  (req: any, res: any, next: any) =>
    (_vendorImgUpload.single("file") as any)(req, res, (err: any) => {
      if (err?.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "Ukuran foto maks 5 MB" });
      }
      next(err);
    }),
  async (req: any, res: any) => {
    const customerId = (req as PortalAuthReq).portalCustomerId;
    const itemId = parseInt(String(req.params.itemId));
    if (isNaN(itemId)) return res.status(400).json({ error: "ID item tidak valid" });
    if (!req.file) return res.status(400).json({ error: "Tidak ada file yang diunggah" });

    const supplier = await getLinkedSupplier(customerId);
    if (!supplier) return res.status(403).json({ message: "Akun belum terhubung ke data vendor" });

    const [customer] = await db
      .select({ email: portalCustomersTable.email })
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, customerId));

    try {
      const inserted = await uploadVendorCatalogMedia({
        itemId,
        supplierId:    supplier.id,
        uploaderEmail: customer?.email ?? null,
        buffer:        req.file.buffer as Buffer,
        mimetype:      req.file.mimetype as string,
      });
      return res.status(201).json({ media: inserted });
    } catch (e: any) {
      const code = (e as any)?.statusCode;
      if (code === 415) return res.status(415).json({ error: e.message });
      if (code === 404) return res.status(404).json({ error: e.message });
      if (code === 403) return res.status(403).json({ error: e.message });
      return res.status(500).json({ error: e?.message });
    }
  },
);

// DELETE /api/portal/vendor/catalog/media/:mediaId
router.delete("/vendor/catalog/media/:mediaId", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const mediaId = parseInt(String(req.params.mediaId));
  if (isNaN(mediaId)) return res.status(400).json({ error: "ID media tidak valid" });

  const supplier = await getLinkedSupplier(customerId);
  if (!supplier) return res.status(403).json({ message: "Akun belum terhubung ke data vendor" });

  try {
    const result = await deleteVendorCatalogMedia(mediaId, supplier.id);
    if (result.storagePath) await deleteFromSupabase(result.storagePath);
    return res.json({ success: true });
  } catch (e: any) {
    const code = (e as any)?.statusCode;
    if (code === 404) return res.status(404).json({ error: e.message });
    if (code === 403) return res.status(403).json({ error: e.message });
    return res.status(500).json({ error: e?.message });
  }
});

// ── Vendor: direct catalog CRUD ───────────────────────────────────────────────

// POST /api/portal/vendor/catalog — Create new catalog item (draft, direct — no approval flow)
router.post("/vendor/catalog", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const supplier = await getLinkedSupplier(customerId);
  if (!supplier) return res.status(403).json({ message: "Akun belum terhubung ke data vendor" });

  const { name, templateKind, description, kategori, categoryKey, priceSell, unit, moq, origin, hsCode } = req.body ?? {};
  if (!String(name ?? "").trim()) return res.status(400).json({ message: "Nama produk wajib diisi" });

  try {
    const [row] = await db
      .insert(vendorCatalogItemsTable)
      .values({
        vendorId:     supplier.id,
        vendorName:   supplier.name ?? null,
        name:         String(name).trim().slice(0, 200),
        templateKind: templateKind ?? "product",
        description:  description ?? null,
        kategori:     kategori ?? null,
        categoryKey:  categoryKey ?? null,
        priceSell:    priceSell != null ? String(priceSell) : null,
        unit:         unit ?? null,
        moq:          moq != null ? String(moq) : null,
        origin:       origin ?? null,
        hsCode:       hsCode ?? null,
        status:       "draft",
        isPublished:  false,
        isActive:     true,
        mediaAssets:  [],
      })
      .returning({ id: vendorCatalogItemsTable.id });
    return res.status(201).json({ id: row.id, ok: true });
  } catch (e: any) {
    console.error("[portal] POST vendor/catalog error", e);
    return res.status(500).json({ error: e?.message });
  }
});

// PUT /api/portal/vendor/catalog/:id — Edit own catalog item details
router.put("/vendor/catalog/:id", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const supplier = await getLinkedSupplier(customerId);
  if (!supplier) return res.status(403).json({ message: "Akun belum terhubung ke data vendor" });

  const { name, templateKind, description, kategori, categoryKey, priceSell, unit, moq, origin, hsCode, specValues } = req.body ?? {};
  if (!String(name ?? "").trim()) return res.status(400).json({ message: "Nama produk wajib diisi" });

  try {
    const result = await db.execute(sql`
      UPDATE vendor_catalog_items
      SET name          = ${String(name).trim().slice(0, 200)},
          template_kind = ${templateKind ?? null},
          description   = ${description ?? null},
          kategori      = ${kategori ?? null},
          category_key  = ${categoryKey ?? null},
          price_sell    = ${priceSell != null ? String(priceSell) : null},
          unit          = ${unit ?? null},
          moq           = ${moq != null ? String(moq) : null},
          origin        = ${origin ?? null},
          hs_code       = ${hsCode ?? null},
          spec_values   = ${specValues != null ? JSON.stringify(specValues) : null}::jsonb,
          updated_at    = NOW()
      WHERE id = ${id} AND vendor_id = ${supplier.id}
      RETURNING id
    `);
    if (!(result as any).rows?.length) return res.status(404).json({ message: "Item tidak ditemukan atau bukan milik vendor ini" });
    return res.json({ ok: true });
  } catch (e: any) {
    console.error("[portal] PUT vendor/catalog error", e);
    return res.status(500).json({ error: e?.message });
  }
});

// POST /api/portal/vendor/catalog/:id/media-assets/upload
// Upload file → Replit Object Storage → return URL. Frontend manages the array and PATCHes below.
router.post(
  "/vendor/catalog/:id/media-assets/upload",
  requirePortalAuth,
  (req: any, res: any, next: any) =>
    (_portalUpload.single("file") as any)(req, res, (err: any) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE")
        return res.status(413).json({ message: "Ukuran file terlalu besar (maks 20 MB)" });
      next(err);
    }),
  async (req: any, res: any) => {
    const customerId = (req as PortalAuthReq).portalCustomerId;
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
    if (!req.file) return res.status(400).json({ message: "File wajib disertakan" });

    const supplier = await getLinkedSupplier(customerId);
    if (!supplier) return res.status(403).json({ message: "Akun belum terhubung ke data vendor" });

    const ownerRows = await db.execute(sql`
      SELECT id FROM vendor_catalog_items WHERE id = ${id} AND vendor_id = ${supplier.id}
    `);
    if (!(ownerRows as any).rows?.length) return res.status(404).json({ message: "Item tidak ditemukan atau bukan milik vendor ini" });

    const ALLOWED = [
      "image/jpeg","image/jpg","image/png","image/webp",
      "video/mp4","video/webm","video/quicktime",
      "application/pdf",
    ];
    if (!ALLOWED.includes(req.file.mimetype as string))
      return res.status(415).json({ message: "Tipe file tidak didukung (JPG, PNG, WebP, MP4, WebM, PDF)" });

    try {
      const mime = req.file.mimetype as string;
      const folder = mime.startsWith("video/")
        ? "catalog-videos"
        : mime === "application/pdf"
          ? "catalog-docs"
          : `product-media/vendor-${supplier.id}/item-${id}`;
      const { publicUrl, storagePath } = await uploadToSupabase(req.file.buffer as Buffer, mime, folder);
      return res.status(201).json({
        url:        publicUrl,
        objectPath: storagePath,
        mimeType:   mime,
        sizeBytes:  req.file.size,
      });
    } catch (e: any) {
      console.error("[portal] vendor media-assets upload error", e);
      return res.status(500).json({ message: e?.message ?? "Upload gagal" });
    }
  },
);

// PATCH /api/portal/vendor/catalog/:id/media-assets — Replace media_assets JSONB
router.patch("/vendor/catalog/:id/media-assets", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const supplier = await getLinkedSupplier(customerId);
  if (!supplier) return res.status(403).json({ message: "Akun belum terhubung ke data vendor" });

  const { mediaAssets } = req.body ?? {};
  if (!Array.isArray(mediaAssets)) return res.status(400).json({ message: "mediaAssets harus berupa array" });

  const [ownerRow] = await db
    .select({ documents: vendorCatalogItemsTable.documents })
    .from(vendorCatalogItemsTable)
    .where(and(eq(vendorCatalogItemsTable.id, id), eq(vendorCatalogItemsTable.vendorId, supplier.id)));
  if (!ownerRow) return res.status(404).json({ message: "Item tidak ditemukan atau bukan milik vendor ini" });

  const validation = validateMediaAssetsPayload(mediaAssets, ownerRow.documents);
  if (!validation.ok) return res.status(400).json({ message: validation.message });

  try {
    await db.execute(sql`
      UPDATE vendor_catalog_items
      SET media_assets = ${JSON.stringify(validation.clean)}::jsonb, updated_at = NOW()
      WHERE id = ${id} AND vendor_id = ${supplier.id}
    `);
    return res.json({ ok: true, count: validation.clean.length });
  } catch (e: any) {
    console.error("[portal] vendor PATCH media-assets error", e);
    return res.status(500).json({ message: e?.message ?? "Gagal menyimpan media assets" });
  }
});

// POST /api/portal/vendor/catalog/:id/publish
router.post("/vendor/catalog/:id/publish", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const supplier = await getLinkedSupplier(customerId);
  if (!supplier) return res.status(403).json({ message: "Akun belum terhubung ke data vendor" });
  try {
    const result = await db.execute(sql`
      UPDATE vendor_catalog_items
      SET is_published = true, is_active = true, status = 'published',
          published_at = COALESCE(published_at, NOW()), updated_at = NOW()
      WHERE id = ${id} AND vendor_id = ${supplier.id}
      RETURNING id
    `);
    if (!(result as any).rows?.length) return res.status(404).json({ message: "Item tidak ditemukan atau bukan milik vendor ini" });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message });
  }
});

// POST /api/portal/vendor/catalog/:id/unpublish
router.post("/vendor/catalog/:id/unpublish", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const supplier = await getLinkedSupplier(customerId);
  if (!supplier) return res.status(403).json({ message: "Akun belum terhubung ke data vendor" });
  try {
    const result = await db.execute(sql`
      UPDATE vendor_catalog_items
      SET is_published = false, status = 'draft', updated_at = NOW()
      WHERE id = ${id} AND vendor_id = ${supplier.id}
      RETURNING id
    `);
    if (!(result as any).rows?.length) return res.status(404).json({ message: "Item tidak ditemukan atau bukan milik vendor ini" });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message });
  }
});

// POST /api/portal/vendor/catalog/:id/archive — Soft delete (no hard DELETE)
router.post("/vendor/catalog/:id/archive", requirePortalAuth, async (req, res) => {
  const customerId = (req as PortalAuthReq).portalCustomerId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const supplier = await getLinkedSupplier(customerId);
  if (!supplier) return res.status(403).json({ message: "Akun belum terhubung ke data vendor" });
  try {
    const result = await db.execute(sql`
      UPDATE vendor_catalog_items
      SET is_active = false, is_published = false, status = 'archived', updated_at = NOW()
      WHERE id = ${id} AND vendor_id = ${supplier.id}
      RETURNING id
    `);
    if (!(result as any).rows?.length) return res.status(404).json({ message: "Item tidak ditemukan atau bukan milik vendor ini" });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message });
  }
});

// ── Vendor: notification endpoints ────────────────────────────────────────────

// GET /api/portal/vendor/notifications — list this vendor's in-app notifications
router.get("/vendor/notifications", requirePortalAuth, requireActiveVendor, async (req: PortalAuthReq, res) => {
  try {
    const customerId = (req as PortalAuthReq).portalCustomerId;
    if (!customerId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const limit = Math.min(Number(req.query["limit"] ?? 50), 100);
    const onlyUnread = req.query["unread"] === "1";

    const conditions = [eq(vendorNotificationsTable.vendorId, customerId)];
    if (onlyUnread) conditions.push(eq(vendorNotificationsTable.isRead, false));

    const rows = await db
      .select()
      .from(vendorNotificationsTable)
      .where(and(...conditions))
      .orderBy(desc(vendorNotificationsTable.createdAt))
      .limit(limit);

    const [unreadCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(vendorNotificationsTable)
      .where(and(
        eq(vendorNotificationsTable.vendorId, customerId),
        eq(vendorNotificationsTable.isRead, false),
      ));

    res.json({ notifications: rows, unreadCount: unreadCount?.count ?? 0 });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// POST /api/portal/vendor/notifications/read-all — mark all as read
router.post("/vendor/notifications/read-all", requirePortalAuth, requireActiveVendor, async (req: PortalAuthReq, res) => {
  try {
    const customerId = (req as PortalAuthReq).portalCustomerId;
    if (!customerId) { res.status(401).json({ error: "Unauthorized" }); return; }

    await db.update(vendorNotificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(and(
        eq(vendorNotificationsTable.vendorId, customerId),
        eq(vendorNotificationsTable.isRead, false),
      ));

    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// POST /api/portal/vendor/notifications/:id/read — mark one as read
router.post("/vendor/notifications/:id/read", requirePortalAuth, requireActiveVendor, async (req: PortalAuthReq, res) => {
  try {
    const customerId = (req as PortalAuthReq).portalCustomerId;
    if (!customerId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const notifId = Number(req.params.id);

    await db.update(vendorNotificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(and(
        eq(vendorNotificationsTable.id, notifId),
        eq(vendorNotificationsTable.vendorId, customerId),
      ));

    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// ── Vendor: profile detail ─────────────────────────────────────────────────────

// GET /api/portal/vendor/vendor-profile — full vendor_profiles record
router.get("/vendor/vendor-profile", requirePortalAuth, requireActiveVendor, async (req: PortalAuthReq, res) => {
  try {
    const customerId = (req as PortalAuthReq).portalCustomerId;
    if (!customerId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const result = await getVendorFullProfile(customerId);
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// PATCH /api/portal/vendor/profile — vendor self-edit profil sendiri (P1 — G9 fix)
// Vendor hanya dapat mengubah field profil miliknya: picName, phone, email, fullAddress,
// companyDescription, logoUrl. Tidak dapat mengubah status, marketplace status, atau dokumen.
router.patch(
  "/vendor/profile",
  requirePortalAuth,
  requireActiveVendor,
  validateBody(VendorSelfProfileSchema),
  async (req: PortalAuthReq, res) => {
    try {
      const customerId = req.portalCustomerId;
      if (!customerId) { res.status(401).json({ error: "Unauthorized" }); return; }

      const {
        picName, phone, email, fullAddress, companyDescription, logoUrl, expectedUpdatedAt,
      } = req.body as {
        picName?: string | null; phone?: string | null; email?: string | null;
        fullAddress?: string | null;
        companyDescription?: string | null; logoUrl?: string | null;
        expectedUpdatedAt?: string;
      };

      // Ambil data sebelum update untuk audit + optimistic locking
      const [vp] = await db
        .select({
          supplierId: vendorProfilesTable.supplierId,
          picName: vendorProfilesTable.picName,
          phone: vendorProfilesTable.phone,
          email: vendorProfilesTable.email,
          fullAddress: vendorProfilesTable.fullAddress,
          companyDescription: vendorProfilesTable.companyDescription,
        })
        .from(vendorProfilesTable)
        .where(eq(vendorProfilesTable.customerId, customerId))
        .limit(1);

      if (!vp) {
        res.status(404).json({ error: "Profil vendor tidak ditemukan" });
        return;
      }

      // Optimistic locking via suppliers.updated_at (opsional, backward compat)
      if (expectedUpdatedAt && vp.supplierId) {
        const [sup] = await db
          .select({ updatedAt: suppliersTable.updatedAt })
          .from(suppliersTable)
          .where(eq(suppliersTable.id, vp.supplierId))
          .limit(1);
        if (sup?.updatedAt) {
          const expected = new Date(expectedUpdatedAt).getTime();
          const actual = new Date(sup.updatedAt).getTime();
          if (Math.abs(expected - actual) > 1000) {
            res.status(409).json({
              message: "Conflict: data telah diubah. Refresh dan coba lagi.",
              currentUpdatedAt: sup.updatedAt,
            });
            return;
          }
        }
      }

      // Update vendor_profiles
      const vpUpdates: Record<string, unknown> = {};
      if (picName !== undefined) vpUpdates.picName = picName;
      if (phone !== undefined) vpUpdates.phone = phone;
      if (email !== undefined) vpUpdates.email = email;
      if (fullAddress !== undefined) vpUpdates.fullAddress = fullAddress;
      if (companyDescription !== undefined) vpUpdates.companyDescription = companyDescription;

      if (Object.keys(vpUpdates).length > 0) {
        await db.update(vendorProfilesTable).set(vpUpdates).where(eq(vendorProfilesTable.customerId, customerId));
      }

      // Update suppliers (logoUrl — jika disertakan dan ada supplierId)
      if (vp.supplierId && logoUrl !== undefined) {
        await db
          .update(suppliersTable)
          .set({ logoUrl, updatedAt: new Date() })
          .where(eq(suppliersTable.id, vp.supplierId));
      }

      const actor = vendorActorFromReq(req);
      if (vp.supplierId) {
        void logVendorAudit({
          supplierId: vp.supplierId,
          action: "profile_edited_vendor",
          actor,
          before: {
            picName: vp.picName,
            phone: vp.phone,
            email: vp.email,
            fullAddress: vp.fullAddress,
            companyDescription: vp.companyDescription,
          },
          after: { picName, phone, email, fullAddress, companyDescription, logoUrl },
          ip: vendorIpFromReq(req),
          userAgent: vendorUaFromReq(req),
        });
      }

      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
    }
  }
);

// ── Vendor: catalog submissions ────────────────────────────────────────────────

// GET /api/portal/vendor/catalog-submissions — submissions this vendor has made
router.get("/vendor/catalog-submissions", requirePortalAuth, requireActiveVendor, async (req: PortalAuthReq, res) => {
  try {
    const customerId = (req as PortalAuthReq).portalCustomerId;
    if (!customerId) { res.status(401).json({ error: "Unauthorized" }); return; }
    return res.json(await listVendorCatalogSubmissions(customerId));
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// ── Vendor: Featured Product / Produk Unggulan ──────────────────────────────
// Vendors are portal_customers rows with a vendor role; resolveVendorSupplierId
// maps the logged-in customer to their suppliers.id (same heuristic as the
// vendor dashboard). requireActiveVendor blocks pending/rejected vendors.

async function _requireVendorSupplierId(req: PortalAuthReq, res: Response): Promise<number | null> {
  const customerId = req.portalCustomerId;
  if (!customerId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const vendorId = await resolveVendorSupplierId(customerId);
  if (!vendorId) { res.status(403).json({ error: "Akun ini tidak terhubung ke profil vendor" }); return null; }
  return vendorId;
}

// GET /api/portal/vendor/featured-packages — packages a vendor can pick from
router.get("/vendor/featured-packages", requirePortalAuth, requireActiveVendor, async (_req, res) => {
  try {
    res.json(await listFeaturedPackages(false));
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// GET /api/portal/vendor/featured-requests — this vendor's own requests
router.get("/vendor/featured-requests", requirePortalAuth, requireActiveVendor, async (req: PortalAuthReq, res) => {
  try {
    const vendorId = await _requireVendorSupplierId(req, res);
    if (!vendorId) return;
    res.json(await listFeaturedRequestsForVendor(vendorId));
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// GET /api/portal/vendor/featured-requests/:id — detail of one owned request
router.get("/vendor/featured-requests/:id", requirePortalAuth, requireActiveVendor, async (req: PortalAuthReq, res) => {
  try {
    const vendorId = await _requireVendorSupplierId(req, res);
    if (!vendorId) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    res.json(await getFeaturedRequestDetailForVendor(vendorId, id));
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// POST /api/portal/vendor/featured-requests — submit a new featured-product request
router.post("/vendor/featured-requests", requirePortalAuth, requireActiveVendor, async (req: PortalAuthReq, res) => {
  try {
    const vendorId = await _requireVendorSupplierId(req, res);
    if (!vendorId) return;
    const { catalogItemId, packageId, requestedStartAt } = req.body ?? {};
    const row = await createFeaturedRequest(vendorId, {
      catalogItemId: Number(catalogItemId),
      packageId: Number(packageId),
      requestedStartAt: requestedStartAt ? new Date(requestedStartAt) : new Date(),
    });
    res.status(201).json(row);
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// POST /api/portal/vendor/featured-requests/:id/cancel — vendor cancels own request
router.post("/vendor/featured-requests/:id/cancel", requirePortalAuth, requireActiveVendor, async (req: PortalAuthReq, res) => {
  try {
    const vendorId = await _requireVendorSupplierId(req, res);
    if (!vendorId) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    res.json(await cancelFeaturedRequestByVendor(vendorId, id));
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// POST /api/portal/vendor/featured-requests/:id/payment-proof — upload payment proof
const _featuredProofUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.post(
  "/vendor/featured-requests/:id/payment-proof",
  requirePortalAuth,
  requireActiveVendor,
  (req, res, next) => {
    _featuredProofUpload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "Ukuran file melebihi batas 10 MB." }); return;
      }
      if (err) { res.status(400).json({ error: "Upload gagal" }); return; }
      next();
    });
  },
  async (req: PortalAuthReq, res) => {
    try {
      const vendorId = await _requireVendorSupplierId(req, res);
      if (!vendorId) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
      if (!req.file) return res.status(400).json({ error: "File wajib diunggah" });

      const storage = new ObjectStorageService();
      const ext = (req.file.originalname.split(".").pop() || "jpg").toLowerCase();
      const storagePath = `featured-product-proofs/${vendorId}-${id}-${Date.now()}.${ext}`;
      const url = await storage.uploadPublicFile(req.file.buffer, storagePath, req.file.mimetype);

      const paymentReference = typeof req.body?.paymentReference === "string" ? req.body.paymentReference : null;
      res.json(await submitPaymentProofForVendor(vendorId, id, url, paymentReference));
    } catch (e: unknown) {
      if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
      res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
    }
  },
);

// ── Admin: Featured Product / Produk Unggulan ───────────────────────────────
// Shared by Customer Portal admin UI and BizPortal admin UI — same backend,
// same requirePortalAdmin (accepts BizPortal internal session OR portal admin token).

function _adminIdOf(req: PortalAuthReq): string | null {
  const u = req.user as { id?: string } | undefined;
  if (u?.id) return String(u.id);
  const pcid = req.portalCustomerId;
  return pcid != null ? String(pcid) : null;
}

// ── Packages ──
router.get("/admin/featured-packages", requirePortalAdmin, async (req, res) => {
  try {
    res.json(await listFeaturedPackages(req.query.includeInactive === "true"));
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

router.post("/admin/featured-packages", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  try {
    res.status(201).json(await createFeaturedPackage(req.body ?? {}, _adminIdOf(req)));
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

router.patch("/admin/featured-packages/:id", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    res.json(await updateFeaturedPackage(id, req.body ?? {}, _adminIdOf(req)));
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

router.post("/admin/featured-packages/:id/deactivate", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    await deactivateFeaturedPackage(id, _adminIdOf(req));
    res.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// ── Featured Maintenance (RC3 Fase 2/3 — legacy data repair) ──
// Read-only scan: aman dipanggil kapan saja, tidak pernah menulis apapun.
router.get("/admin/featured-maintenance/scan", requirePortalAdmin, async (_req, res) => {
  try {
    res.json(await scanFeaturedIntegrity());
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// Repair: default dry-run kecuali body eksplisit { mode: "execute" }.
router.post("/admin/featured-maintenance/repair", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  try {
    const mode = req.body?.mode === "execute" ? "execute" : "dry-run";
    res.json(await repairFeaturedIntegrity(mode, _adminIdOf(req)));
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// ── Requests (Daftar Pengajuan / Riwayat) ──
router.get("/admin/featured-requests", requirePortalAdmin, async (req, res) => {
  try {
    const { status, paymentStatus, vendorId, limit, offset } = req.query;
    res.json(
      await listFeaturedRequests({
        status: typeof status === "string" ? status : undefined,
        paymentStatus: typeof paymentStatus === "string" ? paymentStatus : undefined,
        vendorId: vendorId ? Number(vendorId) : undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      }),
    );
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

router.get("/admin/featured-requests/:id", requirePortalAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    res.json(await getFeaturedRequestDetail(id));
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

router.post("/admin/featured-requests/:id/approve", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    const { approvedStartAt, approvedEndAt, adminNotes, waivePayment } = req.body ?? {};
    res.json(
      await approveFeaturedRequest(id, _adminIdOf(req), {
        approvedStartAt: approvedStartAt ? new Date(approvedStartAt) : undefined,
        approvedEndAt: approvedEndAt ? new Date(approvedEndAt) : undefined,
        adminNotes,
        waivePayment: !!waivePayment,
      }),
    );
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

router.post("/admin/featured-requests/:id/reject", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    res.json(await rejectFeaturedRequest(id, _adminIdOf(req), String(req.body?.reason ?? "")));
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

router.post("/admin/featured-requests/:id/verify-payment", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    const { approve, reason } = req.body ?? {};
    res.json(await verifyFeaturedPayment(id, _adminIdOf(req), !!approve, reason));
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

router.post("/admin/featured-requests/:id/activate", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    res.json(await activateFeaturedProduct(id, _adminIdOf(req), { overridePayment: !!req.body?.overridePayment }));
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

router.post("/admin/featured-requests/:id/cancel", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id tidak valid" });
    res.json(await cancelFeaturedProduct(id, _adminIdOf(req), req.body?.reason));
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

router.post("/admin/featured-requests/reorder", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    await reorderFeaturedProducts(items, _adminIdOf(req));
    res.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof FeaturedProductError) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: (e as Error)?.message ?? "Server error" });
  }
});

// ── Portal Admin: Vendor Invitations ─────────────────────────────────────────
// Boot migration — idempotent, split per pgBouncer transaction-mode constraint
async function _ensureVendorInvTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS portal_vendor_invitations (
      id          SERIAL PRIMARY KEY,
      vendor_name TEXT NOT NULL,
      phone       TEXT,
      email       TEXT,
      service_type TEXT,
      notes       TEXT,
      token       TEXT NOT NULL UNIQUE,
      status      TEXT NOT NULL DEFAULT 'pending',
      valid_until TIMESTAMPTZ NOT NULL,
      sent_via_wa BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pvi_created_at_idx
      ON portal_vendor_invitations(created_at DESC)
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::jsonb
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS products JSONB NOT NULL DEFAULT '[]'::jsonb
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS vendor_message TEXT
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS category TEXT
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS category_label TEXT
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS contact_name TEXT
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS company_name TEXT
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE portal_vendor_invitations
      ADD COLUMN IF NOT EXISTS approved_by TEXT
  `).catch(() => {});
}
_ensureVendorInvTable().catch(e => console.error("[portal] vendor-inv migration error", e));

// GET /api/portal/admin/vendor-invitations — list all invitations
router.get("/admin/vendor-invitations", requirePortalAdmin, async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT id, vendor_name, phone, email, service_type, notes,
             token, status, valid_until, sent_via_wa, created_at, documents,
             rejection_reason, rejected_at, products, vendor_message, accepted_at,
             category, category_label, contact_name, company_name,
             supplier_id, approved_at, approved_by
      FROM portal_vendor_invitations
      ORDER BY created_at DESC
      LIMIT 200
    `);
    const invitations = (rows.rows ?? []) as any[];

    // Documents are stored in the private bucket — mint a short-lived signed
    // URL per document here (admin-only route) instead of ever persisting or
    // returning a public URL. Never leak the raw storage path to the client.
    const withSignedDocs = await Promise.all(
      invitations.map(async (inv) => {
        const docs: any[] = Array.isArray(inv.documents) ? inv.documents : [];
        const signedDocs = await Promise.all(
          docs.map(async (d) => {
            if (!d?.path) return d; // legacy rows stored a direct public URL — pass through
            try {
              const signedUrl = await _objectStorage.getSignedUrl(d.path, 300);
              return { docType: d.docType, url: signedUrl, fileName: d.fileName };
            } catch {
              return { docType: d.docType, url: null, fileName: d.fileName };
            }
          }),
        );
        return { ...inv, documents: signedDocs };
      }),
    );

    return res.json(withSignedDocs);
  } catch (e) {
    console.error("[portal] GET vendor-invitations error", e);
    return res.status(500).json({ error: "Gagal memuat undangan" });
  }
});

// POST /api/portal/admin/vendor-invitations — create invitation + optional WA
router.post("/admin/vendor-invitations", requirePortalAdmin, async (req, res) => {
  const { vendor_name, phone, email, service_type, notes, send_wa } = req.body ?? {};
  if (!vendor_name || typeof vendor_name !== "string" || !vendor_name.trim()) {
    return res.status(400).json({ message: "Nama vendor harus diisi" });
  }

  const token = randomBytes(32).toString("hex");
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  try {
    await db.execute(sql`
      INSERT INTO portal_vendor_invitations
        (vendor_name, phone, email, service_type, notes, token, valid_until, sent_via_wa)
      VALUES
        (${vendor_name.trim()}, ${phone ?? null}, ${email ?? null},
         ${service_type ?? null}, ${notes ?? null}, ${token}, ${validUntil}, ${false})
    `);

    let sentWa = false;
    if (send_wa && phone) {
      const cleanPhone = String(phone).replace(/\D/g, "");
      const portalOrigin = process.env.PORTAL_ORIGIN ?? "https://cstlogistic.co.id";
      const link = `${portalOrigin}/vendor-register?token=${token}`;
      const msg = [
        `Halo *${vendor_name.trim()}*! 👋`,
        ``,
        `Anda mendapat undangan dari *CST Logistic* untuk bergabung sebagai mitra vendor di platform B2B kami.`,
        ``,
        `Klik link berikut untuk mendaftar:`,
        link,
        ``,
        `Link berlaku hingga ${validUntil.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}.`,
        ``,
        `Terima kasih 🙏`,
      ].join("\n");

      try {
        await sendWhatsApp(cleanPhone, msg);
        await db.execute(sql`
          UPDATE portal_vendor_invitations SET sent_via_wa = TRUE WHERE token = ${token}
        `);
        sentWa = true;
      } catch (waErr) {
        console.error("[portal] vendor-inv WA send error", waErr);
      }
    }

    return res.status(201).json({ token, sent_via_wa: sentWa, valid_until: validUntil });
  } catch (e) {
    console.error("[portal] POST vendor-invitations error", e);
    return res.status(500).json({ error: "Gagal membuat undangan" });
  }
});

// ── PUBLIC: POST /vendor-invite/:token/upload — vendor uploads a supporting document ──
const _vendorInviteUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const VENDOR_INVITE_UPLOAD_ALLOWED_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "application/pdf",
  "video/mp4", "video/quicktime", "video/x-msvideo", "video/webm",
]);
const VENDOR_INVITE_UPLOAD_ALLOWED_EXT = new Set(["jpg", "jpeg", "png", "webp", "pdf", "mp4", "mov", "avi", "webm"]);
const VENDOR_INVITE_DOC_TYPES = new Set(["npwp", "siup_nib", "akta", "ktp_pic", "other", "product_photo", "product_video"]);
const VENDOR_INVITE_REQUIRED_DOC_TYPES = ["npwp", "siup_nib", "ktp_pic"];
const VENDOR_INVITE_SERVICE_LABEL: Record<string, string> = {
  marketplace: "Produk Marketplace B2B",
  sea_freight: "Layanan Sea Freight (FCL/LCL)",
  air_freight: "Layanan Air Freight",
  trucking:    "Layanan Trucking / Darat",
  ppjk:        "Layanan PPJK / Custom Clearance",
  warehousing: "Layanan Pergudangan",
  other:       "Layanan Lainnya",
};
// Doc types that support multiple uploads (append, not replace)
const VENDOR_INVITE_MULTI_DOC_TYPES = new Set(["product_photo", "product_video"]);
// Only "marketplace" invitations submit a product catalog; every other
// service_type registers a service capability (no per-item category to
// validate against). Must stay in sync with MARKETPLACE_PRODUCT_CATEGORIES
// in the vendor-register.tsx frontend.
const VENDOR_INVITE_MARKETPLACE_CATEGORIES = new Set([
  "Elektronik",
  "Fashion & Tekstil",
  "Makanan & Minuman",
  "Kesehatan & Kecantikan",
  "Rumah Tangga & Furnitur",
  "Otomotif & Sparepart",
  "Bahan Baku & Industri",
  "Alat Tulis & Kantor",
  "Lainnya",
]);
// Per-IP: max 60 uploads/hour (raised to cover multi-product media uploads)
const _vendorInviteUploadIpLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Terlalu banyak upload dari jaringan ini. Coba lagi dalam 1 jam." },
  keyGenerator: (req) => ipKeyGenerator(
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress
      ?? "unknown"
  ),
});
const _vendorInviteUploadTokenAttempts = new Map<string, { count: number; resetAt: number }>();
const _VENDOR_INVITE_TOKEN_ATTEMPTS_MAX_ENTRIES = 5000;
function _checkVendorInviteTokenLimit(token: string): boolean {
  const now = Date.now();
  // Opportunistic sweep of expired entries to keep this bounded; also hard-cap
  // total tracked tokens so an attacker spamming random tokens can't grow this
  // map without limit (oldest entries evicted first once at capacity).
  if (_vendorInviteUploadTokenAttempts.size > _VENDOR_INVITE_TOKEN_ATTEMPTS_MAX_ENTRIES) {
    for (const [k, v] of _vendorInviteUploadTokenAttempts) {
      if (v.resetAt < now) _vendorInviteUploadTokenAttempts.delete(k);
    }
    while (_vendorInviteUploadTokenAttempts.size > _VENDOR_INVITE_TOKEN_ATTEMPTS_MAX_ENTRIES) {
      const oldestKey = _vendorInviteUploadTokenAttempts.keys().next().value;
      if (oldestKey === undefined) break;
      _vendorInviteUploadTokenAttempts.delete(oldestKey);
    }
  }
  const rec = _vendorInviteUploadTokenAttempts.get(token);
  if (!rec || rec.resetAt < now) {
    _vendorInviteUploadTokenAttempts.set(token, { count: 1, resetAt: now + 60 * 60_000 });
    return true;
  }
  if (rec.count >= 20) return false;
  rec.count += 1;
  return true;
}

router.post(
  "/vendor-invite/:token/upload",
  _vendorInviteUploadIpLimiter,
  _vendorInviteUpload.single("file"),
  async (req, res) => {
    const token = String(req.params.token ?? "").trim();
    if (!token) return res.status(400).json({ message: "Token tidak valid" });
    if (!_checkVendorInviteTokenLimit(token)) {
      return res.status(429).json({ message: "Batas upload untuk link ini telah tercapai. Coba lagi dalam 1 jam." });
    }
    if (!req.file) return res.status(400).json({ message: "Tidak ada file" });

    const rawDocType = String((req.body as any)?.docType ?? "other").trim();
    const docType = VENDOR_INVITE_DOC_TYPES.has(rawDocType) ? rawDocType : "other";

    // Product media (photo/video) allows up to 50 MB; legal docs stay at 10 MB
    const isProductMedia = VENDOR_INVITE_MULTI_DOC_TYPES.has(docType);
    const validation = validateUploadFile(req.file, {
      allowedMime: VENDOR_INVITE_UPLOAD_ALLOWED_MIME,
      allowedExt: VENDOR_INVITE_UPLOAD_ALLOWED_EXT,
      maxSizeBytes: isProductMedia ? 50 * 1024 * 1024 : 10 * 1024 * 1024,
    });
    if (!validation.ok) return res.status(415).json({ message: validation.errorMessage });

    try {
      // Re-check token validity + re-fetch documents right before the DB write below to
      // minimize (not fully eliminate) the TOCTOU window against concurrent accept calls.
      const rows = await db.execute(sql`
        SELECT id, status, valid_until, documents FROM portal_vendor_invitations WHERE token = ${token} LIMIT 1
      `);
      const inv = (rows as any).rows?.[0];
      if (!inv) return res.status(404).json({ message: "Token tidak valid" });
      if (new Date(inv.valid_until) < new Date()) return res.status(410).json({ message: "Link sudah kadaluarsa" });
      if (inv.status === "accepted") return res.status(409).json({ message: "Undangan ini sudah pernah diterima." });

      const existingDocs: any[] = Array.isArray(inv.documents) ? inv.documents : [];
      if (existingDocs.length >= 30) {
        return res.status(400).json({ message: "Jumlah dokumen sudah mencapai batas maksimum." });
      }

      const fileName = req.file.originalname ?? "";
      // Legal identity documents (NPWP/NIB/Akta/KTP/other) are sensitive — store
      // them in the PRIVATE bucket. Only admins can ever read them back, via a
      // short-lived signed URL minted server-side in GET /admin/vendor-invitations.
      // Product photos/videos are meant for public catalog display, so those
      // still go to the public bucket as before.
      const isLegalDoc = !VENDOR_INVITE_MULTI_DOC_TYPES.has(docType);
      let docEntry: { docType: string; url: string | null; fileName: string; path?: string };
      if (isLegalDoc) {
        const path = await _objectStorage.uploadPrivateEntity(req.file.buffer, req.file.mimetype);
        docEntry = { docType, url: null, fileName, path };
      } else {
        const objectId = randomUUID();
        const ext = req.file.originalname?.split(".").pop()?.toLowerCase() ?? "bin";
        const subPath = `vendor-invite-documents/${objectId}.${ext}`;
        const url = await _objectStorage.uploadPublicRaw(subPath, req.file.buffer, req.file.mimetype);
        docEntry = { docType, url, fileName };
      }

      // Multi-upload types (product_photo, product_video) append; others replace same slot.
      const isMulti = VENDOR_INVITE_MULTI_DOC_TYPES.has(docType);
      const nextDocs = isMulti
        ? [...existingDocs, docEntry]
        : [...existingDocs.filter((d: any) => d?.docType !== docType), docEntry];
      await db.execute(sql`
        UPDATE portal_vendor_invitations
        SET documents = ${JSON.stringify(nextDocs)}::jsonb
        WHERE token = ${token} AND status != 'accepted'
      `);

      // For legal docs there is no public url to hand back (private bucket) —
      // the client only needs to know the upload succeeded and which slot it filled.
      return res.json({ url: docEntry.url, fileName, docType, uploaded: true });
    } catch (e) {
      console.error("[portal] vendor-invite upload error", e);
      return res.status(500).json({ message: "Gagal upload" });
    }
  }
);

// GET /api/portal/vendor-invite/:token — public: validate invitation token (rate limited)
router.get("/vendor-invite/:token", vendorInviteLimiter, async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  if (!token) return res.status(400).json({ message: "Token tidak valid" });
  try {
    const rows = await db.execute(sql`
      SELECT id, vendor_name, service_type, notes, status, valid_until
      FROM portal_vendor_invitations
      WHERE token = ${token}
      LIMIT 1
    `);
    const inv = (rows as any).rows?.[0];
    if (!inv) return res.status(404).json({ message: "Undangan tidak ditemukan atau sudah dicabut" });
    const expired = new Date(inv.valid_until) < new Date();
    if (expired) return res.status(410).json({ message: "Link undangan sudah kadaluarsa (30 hari). Hubungi admin untuk link baru." });
    if (inv.status === "accepted") return res.status(409).json({ message: "Undangan ini sudah pernah diterima." });
    return res.json({
      ok: true,
      vendor_name: inv.vendor_name,
      service_type: inv.service_type,
      notes: inv.notes,
      valid_until: inv.valid_until,
    });
  } catch (e) {
    console.error("[portal] GET vendor-invite error", e);
    return res.status(500).json({ error: "Gagal validasi token" });
  }
});

// POST /api/portal/vendor-invite/:token/accept — public: vendor submits their data (rate limited)
router.post("/vendor-invite/:token/accept", vendorInviteLimiter, validateBody(VendorInviteAcceptSchema), async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  const { contact_name, phone, email, company_name, message, products } = req.body ?? {};
  if (!token) return res.status(400).json({ message: "Token tidak valid" });

  try {
    const rows = await db.execute(sql`
      SELECT id, vendor_name, status, valid_until, documents, service_type
      FROM portal_vendor_invitations
      WHERE token = ${token}
      LIMIT 1
    `);
    const inv = (rows as any).rows?.[0];
    if (!inv) return res.status(404).json({ message: "Undangan tidak ditemukan" });
    if (new Date(inv.valid_until) < new Date()) return res.status(410).json({ message: "Link sudah kadaluarsa" });
    if (inv.status === "accepted") return res.status(409).json({ message: "Sudah diterima sebelumnya" });

    // Documents are bound server-side via the /upload endpoint (never trust
    // client-supplied document URLs/types here) — just check the required
    // slots were actually uploaded for this token before accepting.
    const existingDocs: any[] = Array.isArray(inv.documents) ? inv.documents : [];
    const uploadedTypes = new Set(existingDocs.map((d: any) => d?.docType));
    const missing = VENDOR_INVITE_REQUIRED_DOC_TYPES.filter((t) => !uploadedTypes.has(t));
    if (missing.length > 0) {
      return res.status(400).json({ message: `Dokumen wajib belum diunggah: ${missing.join(", ")}` });
    }

    // Category always comes from the invitation's own service_type (set by
    // admin when the invite was created) — never from the client request
    // body — so the recorded scope always matches what the vendor was
    // actually invited to join as, regardless of what the form submits.
    // Products/message are stored as structured JSON (not squashed into the
    // free-text `notes` field) so the admin UI can render them properly and
    // validate product entries against the invited category later.
    const serviceLabel = VENDOR_INVITE_SERVICE_LABEL[inv.service_type as string] ?? inv.service_type ?? "Umum";
    const isMarketplaceInvite = !inv.service_type || inv.service_type === "marketplace";
    const productList: { name: string; description: string; category: string; mediaUrls: string[] }[] =
      (Array.isArray(products) ? products.slice(0, 10) : [])
        .map((p: any) => ({
          name: String(p?.name ?? "").slice(0, 200),
          description: String(p?.description ?? "").slice(0, 2000),
          category: typeof p?.category === "string" ? p.category.trim().slice(0, 100) : "",
          mediaUrls: Array.isArray(p?.mediaUrls) ? p.mediaUrls.filter((u: unknown) => typeof u === "string").slice(0, 8) : [],
        }));

    // Products in a marketplace invitation must declare a category from the
    // fixed taxonomy so admin can verify the vendor is offering products
    // that match the category they were invited to sell under — a bare
    // free-text `notes` blob can't be validated or filtered this way.
    if (isMarketplaceInvite) {
      const invalidProducts = productList.filter(
        (p) => p.name.trim() && !VENDOR_INVITE_MARKETPLACE_CATEGORIES.has(p.category),
      );
      if (invalidProducts.length > 0) {
        return res.status(400).json({
          message: `Kategori produk tidak valid untuk: ${invalidProducts.map((p) => p.name).join(", ")}. Pilih kategori dari daftar yang tersedia.`,
        });
      }
    }

    const vendorMessage = typeof message === "string" && message.trim() ? message.trim().slice(0, 2000) : null;

    await db.execute(sql`
      UPDATE portal_vendor_invitations
      SET status = 'accepted',
          category = ${inv.service_type ?? null},
          category_label = ${serviceLabel},
          products = ${JSON.stringify(productList)}::jsonb,
          vendor_message = ${vendorMessage},
          accepted_at = NOW(),
          contact_name = ${typeof contact_name === "string" ? contact_name.slice(0, 200) : null},
          company_name = ${typeof company_name === "string" ? company_name.slice(0, 200) : null},
          phone = COALESCE(phone, ${phone ?? null}),
          email = COALESCE(email, ${email ?? null})
      WHERE token = ${token} AND status != 'accepted'
    `);

    NotificationService.saveAndBroadcast("admin_notification", {
      type: "vendor_invitation_accepted",
      orderNumber: String(inv.id),
      customerName: company_name || inv.vendor_name,
      title: "Vendor Baru Mendaftar",
      body: `${contact_name || inv.vendor_name} (${company_name || inv.vendor_name}) telah melengkapi pendaftaran mitra vendor dan mengunggah ${existingDocs.length} dokumen.`,
      targetRole: "admin",
    } as any).catch((e: unknown) => console.error("[portal] notify vendor-invite accepted failed:", e));

    (async () => {
      try {
        const adminWa = await getAdminWa();
        if (!adminWa) return;
        const waMessage = [
          `*Vendor Baru Mendaftar*`,
          ``,
          `Vendor: ${company_name || inv.vendor_name}`,
          `Kontak: ${contact_name || "-"}`,
          `Kategori: ${serviceLabel}`,
          `Dokumen: ${existingDocs.length} berkas`,
          ``,
          `Silakan tinjau & setujui di panel admin (tab "Undang Vendor").`,
        ].join("\n");
        await sendWhatsApp(adminWa, waMessage, {
          context: "vendor_invitation_accepted",
          refType: "portal_vendor_invitations",
          refId: String(inv.id),
        });
      } catch (e) {
        console.error("[portal] WA notify admin vendor-invite accepted failed:", e);
      }
    })();

    return res.json({ ok: true, vendor_name: inv.vendor_name });
  } catch (e) {
    console.error("[portal] POST vendor-invite accept error", e);
    return res.status(500).json({ error: "Gagal menyimpan data" });
  }
});

// POST /api/portal/vendor-invite/:token/reject — public: vendor declines terms and sends a reason
router.post("/vendor-invite/:token/reject", async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  const reason = String(req.body?.reason ?? "").trim();
  if (!token) return res.status(400).json({ message: "Token tidak valid" });
  if (!reason) return res.status(400).json({ message: "Alasan tidak boleh kosong" });

  try {
    const rows = await db.execute(sql`
      SELECT id, vendor_name, status, valid_until
      FROM portal_vendor_invitations
      WHERE token = ${token}
      LIMIT 1
    `);
    const inv = (rows as any).rows?.[0];
    if (!inv) return res.status(404).json({ message: "Undangan tidak ditemukan" });
    if (new Date(inv.valid_until) < new Date()) return res.status(410).json({ message: "Link sudah kadaluarsa" });
    if (inv.status === "accepted") return res.status(409).json({ message: "Undangan ini sudah pernah diterima." });
    if (inv.status === "rejected") return res.status(409).json({ message: "Anda sudah pernah mengirim alasan untuk undangan ini." });

    // Strict predicate + affected-row check so a second/duplicate submission
    // (e.g. two rapid clicks) never overwrites the reason or re-notifies admin.
    const updated = await db.execute(sql`
      UPDATE portal_vendor_invitations
      SET status = 'rejected',
          rejection_reason = ${reason},
          rejected_at = NOW()
      WHERE token = ${token} AND status = 'pending' AND valid_until >= NOW()
      RETURNING id
    `);
    if (((updated as any).rows?.length ?? 0) === 0) {
      return res.status(409).json({ message: "Undangan ini tidak lagi dapat diperbarui." });
    }

    NotificationService.saveAndBroadcast("admin_notification", {
      type: "vendor_invitation_rejected",
      orderNumber: String(inv.id),
      customerName: inv.vendor_name,
      title: "Vendor Menolak Syarat dan Ketentuan",
      body: `${inv.vendor_name} tidak menyetujui Syarat dan Ketentuan Vendor. Alasan: ${reason}`,
      targetRole: "admin",
    } as any).catch((e: unknown) => console.error("[portal] notify vendor-invite rejected failed:", e));

    return res.json({ ok: true });
  } catch (e) {
    console.error("[portal] POST vendor-invite reject error", e);
    return res.status(500).json({ error: "Gagal mengirim alasan" });
  }
});

// POST /api/portal/admin/vendor-invitations/:id/approve — admin approves an
// accepted invitation and auto-activates the vendor as a live ERP supplier
// (and, for marketplace category, publishes their submitted products).
router.post("/admin/vendor-invitations/:id/approve", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  try {
    const rows = await db.execute(sql`
      SELECT id, vendor_name, company_name, contact_name, phone, email,
             service_type, category_label, vendor_message, products, supplier_id, status
      FROM portal_vendor_invitations
      WHERE id = ${id}
      LIMIT 1
    `);
    const inv = (rows as any).rows?.[0];
    if (!inv) return res.status(404).json({ message: "Undangan tidak ditemukan" });
    if (inv.status !== "accepted") {
      return res.status(409).json({ message: "Hanya undangan yang sudah diterima vendor yang bisa disetujui" });
    }
    // Idempotent: already activated → return existing IDs without re-running writes
    if (inv.supplier_id) {
      const existingPc = await db.execute(sql`
        SELECT id FROM portal_customers WHERE email = ${typeof inv.email === "string" ? inv.email.toLowerCase().trim() : ""} LIMIT 1
      `);
      return res.json({
        ok: true,
        supplier_id: inv.supplier_id,
        portal_customer_id: (existingPc as any).rows?.[0]?.id ?? null,
        already_activated: true,
      });
    }

    const supplierName   = String(inv.company_name || inv.vendor_name);
    const adminIdentity  = (req as PortalAuthReq).portalCustomerId != null
      ? String((req as PortalAuthReq).portalCustomerId)
      : "admin";
    const vendorEmail    = typeof inv.email === "string" ? inv.email.toLowerCase().trim() : null;
    const vendorPhone    = inv.phone ? normalizePhoneID(String(inv.phone)) : null;
    const vendorName     = String(inv.contact_name || inv.company_name || inv.vendor_name);

    // ── Core approval: single atomic transaction ────────────────────────────
    // Rolls back entirely if any step fails.
    // Covered: supplier, invitation update, portal_customer, vendor_profile,
    //          user_profiles (required by requireActiveVendor middleware).
    const { supplierId, portalCustomerId } = await db.transaction(async (tx) => {
      // 1. Create supplier
      const supplierResult = await tx.execute(sql`
        INSERT INTO suppliers (name, contact_email, contact_person, phone, tax_id, service_type, note, is_active)
        VALUES (${supplierName}, ${vendorEmail ?? null}, ${inv.contact_name ?? null}, ${vendorPhone ?? null},
                NULL, ${inv.service_type ?? null}, ${inv.vendor_message ?? null}, TRUE)
        RETURNING id
      `);
      const supplierId = (supplierResult as any).rows?.[0]?.id as number | undefined;
      if (!supplierId) throw new Error("Gagal membuat data supplier");

      // 2. Mark invitation as approved
      await tx.execute(sql`
        UPDATE portal_vendor_invitations
        SET supplier_id = ${supplierId}, approved_at = NOW(), approved_by = ${adminIdentity}
        WHERE id = ${id}
      `);

      // 3. Create or upgrade portal_customers account
      let portalCustomerId: number | null = null;
      if (vendorEmail) {
        const existingRows = await tx.execute(sql`
          SELECT id, role FROM portal_customers WHERE email = ${vendorEmail} LIMIT 1
        `);
        const existing = (existingRows as any).rows?.[0];
        if (existing) {
          portalCustomerId = existing.id as number;
          await tx.execute(sql`
            UPDATE portal_customers
            SET role  = 'vendor',
                name  = COALESCE(NULLIF(name, ''), ${vendorName}),
                phone = COALESCE(phone, ${vendorPhone})
            WHERE id = ${existing.id}
          `);
        } else {
          const inserted = await tx.execute(sql`
            INSERT INTO portal_customers (name, email, phone, role, password_hash)
            VALUES (${vendorName}, ${vendorEmail}, ${vendorPhone}, 'vendor', '')
            RETURNING id
          `);
          portalCustomerId = (inserted as any).rows?.[0]?.id as number ?? null;
        }
      }

      // 4. Upsert vendor_profiles
      if (portalCustomerId) {
        const vpRows = await tx.execute(sql`
          SELECT id FROM vendor_profiles WHERE customer_id = ${portalCustomerId} LIMIT 1
        `);
        if ((vpRows as any).rows?.length > 0) {
          await tx.execute(sql`
            UPDATE vendor_profiles
            SET company_name        = ${supplierName},
                service_type        = ${inv.service_type ?? null},
                supplier_id         = ${supplierId},
                verification_status = 'verified'
            WHERE customer_id = ${portalCustomerId}
          `);
        } else {
          await tx.execute(sql`
            INSERT INTO vendor_profiles (customer_id, company_name, service_type, supplier_id, verification_status)
            VALUES (${portalCustomerId}, ${supplierName}, ${inv.service_type ?? null}, ${supplierId}, 'verified')
          `);
        }

        // 5. Upsert user_profiles with status='active'
        // requireActiveVendor checks user_profiles.status = 'active' before
        // granting access to /vendor/profile and all vendor-only routes.
        const upRows = await tx.execute(sql`
          SELECT id FROM user_profiles WHERE customer_id = ${portalCustomerId} LIMIT 1
        `);
        if ((upRows as any).rows?.length > 0) {
          await tx.execute(sql`
            UPDATE user_profiles
            SET status       = 'active',
                account_type = 'vendor',
                updated_at   = NOW()
            WHERE customer_id = ${portalCustomerId}
          `);
        } else {
          await tx.execute(sql`
            INSERT INTO user_profiles (customer_id, full_name, phone, account_type, status, completed_at)
            VALUES (${portalCustomerId}, ${vendorName}, ${vendorPhone ?? null}, 'vendor', 'active', NOW())
          `);
        }
      }

      return { supplierId, portalCustomerId };
    });

    // ── Catalog items: best-effort, outside transaction ─────────────────────
    // Marketplace product publishing failure must NOT roll back the approval.
    const isMarketplace = !inv.service_type || inv.service_type === "marketplace";
    const products: any[] = Array.isArray(inv.products) ? inv.products : [];
    if (isMarketplace && products.length > 0) {
      for (const p of products) {
        if (!p?.name?.trim()) continue;
        const pCat    = typeof p.category === "string" ? p.category.trim() : null;
        const pCatKey = pCat && hasInCodeTemplate(pCat) ? pCat : null;
        const pTpl    = pCatKey ? resolveTemplate(pCatKey) : null;
        await db.execute(sql`
          INSERT INTO vendor_catalog_items
            (vendor_id, vendor_name, type, name, description, kategori,
             category_key, template_id, template_version, template_snapshot,
             status, is_published, is_active, media_assets)
          VALUES
            (${supplierId}, ${supplierName}, 'product', ${String(p.name).slice(0, 200)},
             ${p.description ?? null}, ${pCat},
             ${pCatKey}, ${pTpl?.category ?? null}, ${pTpl?.version ?? null},
             ${pTpl ? JSON.stringify(pTpl) : null}::jsonb,
             'published', TRUE, TRUE,
             ${JSON.stringify((p.mediaUrls ?? []).map((u: string) => ({ url: u })))}::jsonb)
        `).catch((e: unknown) => console.error("[portal] approve: gagal insert vendor_catalog_items", e));
      }
    }

    return res.json({ ok: true, supplier_id: supplierId, portal_customer_id: portalCustomerId });
  } catch (e) {
    console.error("[portal] POST vendor-invitations approve error", e);
    return res.status(500).json({ error: "Gagal menyetujui & mengaktifkan vendor" });
  }
});

// DELETE /api/portal/admin/vendor-invitations/:id — revoke invitation
router.delete("/admin/vendor-invitations/:id", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    await db.execute(sql`DELETE FROM portal_vendor_invitations WHERE id = ${id}`);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[portal] DELETE vendor-invitations error", e);
    return res.status(500).json({ error: "Gagal hapus undangan" });
  }
});

// ─── Supplier Marketplace Management ──────────────────────────────────────────

// GET /api/portal/admin/suppliers — daftar semua supplier dengan status marketplace
router.get("/admin/suppliers", requirePortalAdmin, async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        s.id,
        s.name,
        s.phone,
        s.status,
        s.is_active,
        s.is_verified,
        s.marketplace_status,
        s.is_premium,
        s.created_at,
        COUNT(vci.id) FILTER (WHERE vci.is_published = true AND vci.is_active = true)::int AS published_items,
        COUNT(vci.id)::int AS total_items
      FROM suppliers s
      LEFT JOIN vendor_catalog_items vci ON vci.vendor_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `);
    return res.json((rows as any).rows ?? []);
  } catch (e) {
    console.error("[portal] GET admin/suppliers error", e);
    return res.status(500).json({ error: "Gagal mengambil data supplier" });
  }
});

// PATCH /api/portal/admin/suppliers/:id/marketplace — set is_verified + marketplace_status
router.patch("/admin/suppliers/:id/marketplace", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const { isVerified, marketplaceStatus } = req.body as {
    isVerified?: boolean;
    marketplaceStatus?: "draft" | "published" | "unpublished";
  };

  const validStatuses = ["draft", "published", "unpublished"];
  if (marketplaceStatus !== undefined && !validStatuses.includes(marketplaceStatus)) {
    return res.status(400).json({ message: "marketplaceStatus tidak valid" });
  }
  if (isVerified !== undefined && typeof isVerified !== "boolean") {
    return res.status(400).json({ message: "isVerified harus boolean" });
  }

  try {
    const existing = await db.select({ id: suppliersTable.id })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, id))
      .limit(1);
    if (!existing.length) return res.status(404).json({ message: "Supplier tidak ditemukan" });

    const updates: Record<string, unknown> = {};
    if (isVerified !== undefined)        updates.is_verified        = isVerified;
    if (marketplaceStatus !== undefined) updates.marketplace_status = marketplaceStatus;
    if (!Object.keys(updates).length) return res.status(400).json({ message: "Tidak ada perubahan" });

    await db.execute(sql`
      UPDATE suppliers SET
        is_verified        = COALESCE(${isVerified        ?? null}, is_verified),
        marketplace_status = COALESCE(${marketplaceStatus ?? null}, marketplace_status)
      WHERE id = ${id}
    `);

    const adminId = req.portalCustomerId ? String(req.portalCustomerId) : "admin";
    try {
      await writeAuditLog({
        action:     "supplier.marketplace.update",
        module:     "portal",
        entityType: "suppliers",
        entityId:   String(id),
        userId:     adminId,
        newData:    updates,
      });
    } catch { /* audit log failure is non-fatal */ }

    return res.json({ ok: true, id, ...updates });
  } catch (e) {
    console.error("[portal] PATCH admin/suppliers/:id/marketplace error", e);
    return res.status(500).json({ error: "Gagal mengupdate status marketplace" });
  }
});

// GET /api/portal/admin/vendor-catalog-items — list ALL vendor catalog items with media.
// No invitation filter — shows items regardless of how the vendor was onboarded.
router.get("/admin/vendor-catalog-items", requirePortalAdmin, async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT vci.id, vci.vendor_id, vci.vendor_name, vci.name, vci.description,
             vci.kategori, vci.type, vci.status, vci.is_published, vci.is_active,
             vci.price_base, vci.markup_pct, vci.price_sell, vci.currency, vci.created_at,
             COALESCE(vci.media_assets, '[]'::jsonb) AS media_assets,
             COALESCE(vci.documents, '[]'::jsonb) AS documents,
             s.service_type AS supplier_service_type, s.contact_email, s.phone,
             COALESCE(s.is_internal_vendor, FALSE) AS is_internal_vendor,
             COALESCE(
               json_agg(
                 json_build_object('id', pm.id, 'file_url', pm.file_url, 'is_primary', pm.is_primary)
                 ORDER BY pm.created_at
               ) FILTER (WHERE pm.id IS NOT NULL),
               '[]'::json
             ) AS media
      FROM vendor_catalog_items vci
      LEFT JOIN suppliers s ON s.id = vci.vendor_id
      LEFT JOIN product_media pm ON pm.vendor_catalog_item_id = vci.id
      GROUP BY vci.id, vci.vendor_id, vci.vendor_name, vci.name, vci.description,
               vci.kategori, vci.type, vci.status, vci.is_published, vci.is_active,
               vci.price_base, vci.markup_pct, vci.price_sell, vci.currency, vci.created_at,
               vci.media_assets, vci.documents,
               s.service_type, s.contact_email, s.phone, s.is_internal_vendor
      ORDER BY vci.vendor_name ASC, vci.created_at DESC
      LIMIT 500
    `);
    return res.json(rows.rows ?? []);
  } catch (e) {
    console.error("[portal] GET vendor-catalog-items error", e);
    return res.status(500).json({ error: "Gagal memuat katalog vendor" });
  }
});

// POST /api/portal/admin/vendor-catalog-items — admin creates a new vendor catalog item
// Uses same tables as BizPortal/vendor-dashboard — no extra sync needed.
router.post("/admin/vendor-catalog-items", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  const {
    vendor_id, master_item_id,
    name, description, kategori, type,
    price_base, markup_pct, currency,
    moq, lead_time, origin, hs_code, unit,
    is_published, is_featured,
  } = req.body ?? {};

  const vid = parseInt(String(vendor_id ?? ""), 10);
  if (!vid || isNaN(vid))
    return res.status(400).json({ message: "vendor_id wajib diisi" });
  if (!String(name ?? "").trim())
    return res.status(400).json({ message: "Nama produk wajib diisi" });

  // ── Validate price_base (must be >= 0) ────────────────────────────────────
  const rawBase = (price_base != null && price_base !== "")
    ? (typeof price_base === "string" ? parseFloat(price_base) : Number(price_base))
    : 0;
  if (!isFinite(rawBase) || isNaN(rawBase))
    return res.status(400).json({ message: "Harga dasar tidak valid (harus angka)" });
  if (rawBase < 0)
    return res.status(400).json({ message: "Harga dasar tidak boleh negatif" });
  const baseNum = rawBase;

  // ── Validate markup_pct (must be 0–100) ───────────────────────────────────
  const rawMarkup = (markup_pct != null && markup_pct !== "")
    ? (typeof markup_pct === "string" ? parseFloat(markup_pct) : Number(markup_pct))
    : 0;
  if (!isFinite(rawMarkup) || isNaN(rawMarkup))
    return res.status(400).json({ message: "Markup tidak valid (harus angka)" });
  if (rawMarkup < 0)
    return res.status(400).json({ message: "Markup tidak boleh negatif" });
  if (rawMarkup > 100)
    return res.status(400).json({ message: "Markup tidak boleh melebihi 100%" });
  const markupN = rawMarkup;

  const sellNum  = baseNum > 0 ? Math.ceil(baseNum * (1 + markupN / 100)) : null;

  // Duplicate guard: same vendor + master item
  if (master_item_id) {
    const mid = parseInt(String(master_item_id), 10);
    if (!isNaN(mid)) {
      const dup = await db.execute(sql`
        SELECT id FROM vendor_catalog_items
        WHERE vendor_id = ${vid} AND master_item_id = ${mid} AND is_active = true
        LIMIT 1
      `).catch(() => ({ rows: [] }));
      if (((dup as any).rows ?? []).length > 0)
        return res.status(409).json({ message: "Vendor sudah memiliki item ini di katalog" });
    }
  }

  try {
    // Resolve vendor name
    const vRow = await db.execute(sql`SELECT name FROM suppliers WHERE id = ${vid}`).catch(() => ({ rows: [] }));
    const resolvedVendorName = ((vRow as any).rows?.[0] as any)?.name ?? null;

    const [row] = await db
      .insert(vendorCatalogItemsTable)
      .values({
        vendorId:     vid,
        vendorName:   resolvedVendorName,
        masterItemId: master_item_id ? (parseInt(String(master_item_id), 10) || null) : null,
        type:         String(type ?? "product"),
        name:         String(name).trim().slice(0, 200),
        description:  description ? String(description).trim() : null,
        kategori:     kategori     ? String(kategori).trim()    : null,
        unit:         unit         ? String(unit).trim()        : null,
        priceBase:    String(baseNum),
        markupPct:    String(markupN),
        priceSell:    sellNum != null ? String(sellNum) : null,
        currency:     String(currency ?? "IDR"),
        moq:          moq  != null ? String(parseFloat(String(moq))  || 0) : null,
        leadTime:     lead_time ? String(lead_time).trim() : null,
        origin:       origin    ? String(origin).trim()   : null,
        hsCode:       hs_code   ? String(hs_code).trim()  : null,
        status:       is_published ? "published" : "draft",
        isPublished:  !!is_published,
        isFeatured:   !!is_featured,
        isActive:     true,
        mediaAssets:  [],
      })
      .returning({ id: vendorCatalogItemsTable.id });

    // Audit trail (best-effort)
    const actor = String((req as any).portalCustomerId ?? "admin");
    await db.execute(sql`
      INSERT INTO vendor_audit_logs (supplier_id, action, actor, after)
      VALUES (${vid}, 'catalog_item_created', ${actor},
              ${JSON.stringify({ id: row.id, name: String(name).trim(), price_base: baseNum, markup_pct: markupN, created_by: "admin" })}::jsonb)
    `).catch(() => {});

    return res.status(201).json({ id: row.id, ok: true });
  } catch (e: any) {
    console.error("[portal] POST admin/vendor-catalog-items error", e);
    return res.status(500).json({ error: e?.message ?? "Gagal membuat produk" });
  }
});

// POST /api/portal/admin/vendor-catalog-items/bulk — bulk publish / unpublish / delete
router.post("/admin/vendor-catalog-items/bulk", requirePortalAdmin, async (req, res) => {
  const { action, ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ message: "ids wajib berisi setidaknya 1 item" });
  if (!["publish", "unpublish", "delete"].includes(action))
    return res.status(400).json({ message: "action tidak valid" });

  const intIds = ids.map((id: unknown) => parseInt(String(id), 10)).filter((n: number) => !isNaN(n));
  if (intIds.length === 0) return res.status(400).json({ message: "ids tidak valid" });

  try {
    if (action === "publish") {
      await db.update(vendorCatalogItemsTable)
        .set({ isPublished: true, status: "published", updatedAt: new Date() })
        .where(inArray(vendorCatalogItemsTable.id, intIds));
    } else if (action === "unpublish") {
      await db.update(vendorCatalogItemsTable)
        .set({ isPublished: false, status: "draft", updatedAt: new Date() })
        .where(inArray(vendorCatalogItemsTable.id, intIds));
    } else {
      // Soft delete
      await db.update(vendorCatalogItemsTable)
        .set({ isActive: false, status: "archived", updatedAt: new Date() })
        .where(inArray(vendorCatalogItemsTable.id, intIds));
    }
    return res.json({ ok: true, affected: intIds.length });
  } catch (e: any) {
    console.error("[portal] POST admin/vendor-catalog-items/bulk error", e);
    return res.status(500).json({ error: e?.message ?? "Gagal bulk action" });
  }
});

// ── media-assets endpoints (canonical media_assets JSONB — preferred over product_media) ─────────

// POST /api/portal/admin/vendor-catalog-items/:id/media-assets/upload
// Upload file → Replit Object Storage → return URL + metadata. Frontend saves array via PATCH below.
router.post(
  "/admin/vendor-catalog-items/:id/media-assets/upload",
  requirePortalAdmin,
  (req: any, res: any, next: any) =>
    (_portalUpload.single("file") as any)(req, res, (err: any) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE")
        return res.status(413).json({ message: "Ukuran file terlalu besar (maks 20 MB)" });
      next(err);
    }),
  async (req: any, res: any) => {
    const itemId = parseInt(String(req.params.id), 10);
    if (isNaN(itemId)) return res.status(400).json({ message: "ID tidak valid" });
    if (!req.file) return res.status(400).json({ message: "File wajib disertakan" });

    const ALLOWED = [
      "image/jpeg","image/jpg","image/png","image/webp",
      "video/mp4","video/webm","video/quicktime",
      "application/pdf",
    ];
    if (!ALLOWED.includes(req.file.mimetype as string))
      return res.status(415).json({ message: "Tipe file tidak didukung" });

    try {
      const folder = (req.file.mimetype as string).startsWith("video/") ? "catalog-videos" : "catalog-media";
      const { publicUrl, storagePath } = await uploadToSupabase(req.file.buffer as Buffer, req.file.mimetype as string, folder);
      return res.status(201).json({
        url:        publicUrl,
        objectPath: storagePath,
        mimeType:   req.file.mimetype,
        sizeBytes:  req.file.size,
      });
    } catch (e: any) {
      console.error("[portal] media-assets upload error", e);
      return res.status(500).json({ message: e?.message ?? "Upload gagal" });
    }
  },
);

// PATCH /api/portal/admin/vendor-catalog-items/:id/media-assets
// Replace entire media_assets JSONB array.
// Validates documentKey (must match documents[].key for this item), visibility enum,
// PDF-only doc types, and enforces one active file per documentKey (replace, not duplicate).
router.patch("/admin/vendor-catalog-items/:id/media-assets", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const { mediaAssets } = req.body ?? {};
  if (!Array.isArray(mediaAssets)) return res.status(400).json({ message: "mediaAssets harus berupa array" });

  const [ownerRow] = await db
    .select({ documents: vendorCatalogItemsTable.documents })
    .from(vendorCatalogItemsTable)
    .where(eq(vendorCatalogItemsTable.id, id));
  if (!ownerRow) return res.status(404).json({ message: "Item tidak ditemukan" });

  const validation = validateMediaAssetsPayload(mediaAssets, ownerRow.documents);
  if (!validation.ok) return res.status(400).json({ message: validation.message });

  try {
    await db.execute(sql`
      UPDATE vendor_catalog_items
      SET media_assets = ${JSON.stringify(validation.clean)}::jsonb, updated_at = NOW()
      WHERE id = ${id}
    `);
    return res.json({ ok: true, count: validation.clean.length });
  } catch (e: any) {
    console.error("[portal] PATCH media-assets error", e);
    return res.status(500).json({ message: e?.message ?? "Gagal menyimpan media assets" });
  }
});

// GET /api/portal/admin/vendor-catalog-items/:id/media-assets — get media_assets for a single item
router.get("/admin/vendor-catalog-items/:id/media-assets", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    const rows = await db.execute(sql`
      SELECT media_assets FROM vendor_catalog_items WHERE id = ${id}
    `);
    const row = rows.rows?.[0] as any;
    if (!row) return res.status(404).json({ message: "Item tidak ditemukan" });
    return res.json({ mediaAssets: row.media_assets ?? [] });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message ?? "Gagal memuat media assets" });
  }
});

// ── product_media legacy endpoints (kept for backward compat) ─────────────────

// POST /api/portal/admin/vendor-catalog-items/:id/media — upload image for any vendor item (admin)
router.post(
  "/admin/vendor-catalog-items/:id/media",
  requirePortalAdmin,
  (req: any, res: any, next: any) =>
    (_vendorImgUpload.single("file") as any)(req, res, (err: any) => {
      if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Ukuran foto maks 5 MB" });
      next(err);
    }),
  async (req: any, res: any) => {
    const itemId = parseInt(String(req.params.id), 10);
    if (isNaN(itemId)) return res.status(400).json({ error: "ID tidak valid" });
    if (!req.file) return res.status(400).json({ error: "Tidak ada file yang diunggah" });
    try {
      const itemRows = await db.execute(sql`SELECT vendor_id FROM vendor_catalog_items WHERE id = ${itemId}`);
      const supplierId = (itemRows.rows?.[0] as any)?.vendor_id;
      if (!supplierId) return res.status(404).json({ error: "Item tidak ditemukan" });
      const inserted = await uploadVendorCatalogMedia({
        itemId,
        supplierId: Number(supplierId),
        uploaderEmail: "admin",
        buffer: req.file.buffer as Buffer,
        mimetype: req.file.mimetype as string,
      });
      return res.status(201).json({ media: inserted });
    } catch (e: any) {
      const code = (e as any)?.statusCode;
      if (code === 415) return res.status(415).json({ error: e.message });
      if (code === 404) return res.status(404).json({ error: e.message });
      return res.status(500).json({ error: e?.message });
    }
  }
);

// DELETE /api/portal/admin/vendor-catalog-items/media/:mediaId — delete any vendor media (admin)
router.delete("/admin/vendor-catalog-items/media/:mediaId", requirePortalAdmin, async (req, res) => {
  const mediaId = parseInt(String(req.params.mediaId), 10);
  if (isNaN(mediaId)) return res.status(400).json({ error: "ID media tidak valid" });
  try {
    const mediaRows = await db.execute(sql`
      SELECT pm.id, pm.storage_path FROM product_media pm WHERE pm.id = ${mediaId}
    `);
    const row = mediaRows.rows?.[0] as any;
    if (!row) return res.status(404).json({ error: "Media tidak ditemukan" });
    if (row.storage_path) {
      await deleteFromSupabase(String(row.storage_path)).catch(() => {});
    }
    await db.execute(sql`DELETE FROM product_media WHERE id = ${mediaId}`);
    return res.json({ success: true });
  } catch (e: any) {
    console.error("[portal] DELETE admin media error", e);
    return res.status(500).json({ error: e?.message });
  }
});

// PATCH /api/portal/admin/vendor-catalog-items/:id — toggle publish/active status
router.patch("/admin/vendor-catalog-items/:id", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const { is_published, is_active } = req.body ?? {};
  try {
    if (typeof is_published === "boolean") {
      await db.execute(sql`
        UPDATE vendor_catalog_items
        SET is_published = ${is_published}, status = ${is_published ? "published" : "draft"}
        WHERE id = ${id}
      `);
    }
    if (typeof is_active === "boolean") {
      await db.execute(sql`UPDATE vendor_catalog_items SET is_active = ${is_active} WHERE id = ${id}`);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error("[portal] PATCH vendor-catalog-items error", e);
    return res.status(500).json({ error: "Gagal memperbarui item katalog" });
  }
});

// PUT /api/portal/admin/vendor-catalog-items/:id — update product detail (name, description, price, markup, kategori)
// SECURITY: price_sell is always computed server-side; client-supplied price_sell is silently ignored.
// VALIDATION: price_base ≥ 0, markup_pct ∈ [0, 100], both must be finite numeric or omitted.
// AUDIT: every price change is logged to erp_audit_logs with before/after values.
router.put("/admin/vendor-catalog-items/:id", requirePortalAdmin, async (req: PortalAuthReq, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  // Destructure — price_sell from client is intentionally NOT read (always computed server-side).
  // is_published IS supported in PUT as a full update; use PATCH for quick toggle-only calls.
  const { name, description, price_base, markup_pct, kategori, is_published } = req.body ?? {};

  if (!name?.trim()) return res.status(400).json({ message: "Nama produk harus diisi" });

  // ── Validate price_base ────────────────────────────────────────────────────
  let base: number | null = null;
  if (price_base != null && price_base !== "") {
    const parsed = typeof price_base === "string" ? parseFloat(price_base) : Number(price_base);
    if (!isFinite(parsed) || isNaN(parsed)) {
      return res.status(400).json({ message: "Harga dasar tidak valid (harus angka)" });
    }
    if (parsed < 0) {
      return res.status(400).json({ message: "Harga dasar tidak boleh negatif" });
    }
    if (parsed > 999_999_999_999) { // max Rp 999 miliar — batas bisnis marketplace
      return res.status(400).json({ message: "Harga dasar melebihi batas maksimum (Rp 999.999.999.999)" });
    }
    base = parsed;
  }

  // ── Validate markup_pct ────────────────────────────────────────────────────
  let markup = 0;
  if (markup_pct != null && markup_pct !== "") {
    const parsed = typeof markup_pct === "string" ? parseFloat(markup_pct) : Number(markup_pct);
    if (!isFinite(parsed) || isNaN(parsed)) {
      return res.status(400).json({ message: "Markup tidak valid (harus angka)" });
    }
    if (parsed < 0) {
      return res.status(400).json({ message: "Markup tidak boleh negatif" });
    }
    if (parsed > 100) {
      return res.status(400).json({ message: "Markup tidak boleh melebihi 100%" });
    }
    markup = parsed;
  }

  // ── Check if vendor is internal (no platform markup for internal vendors) ────
  const vendorFlagRows = await db.execute(sql`
    SELECT COALESCE(s.is_internal_vendor, FALSE) AS is_internal_vendor
    FROM vendor_catalog_items vci
    JOIN suppliers s ON s.id = vci.vendor_id
    WHERE vci.id = ${id}
  `);
  const isInternalVendor = (vendorFlagRows.rows?.[0] as any)?.is_internal_vendor === true;

  // ── Apply internal vendor override (zero markup for internal vendors) ────────
  const requestedMarkup = markup;
  const effectiveMarkup = isInternalVendor ? 0 : markup;
  const markupOverrideReason = isInternalVendor ? "Internal Company Vendor" : null;

  try {
    // ── Fetch before-values early (needed for normalization safety + audit log) ──
    const beforeRows = await db.execute(sql`
      SELECT price_base, markup_pct, price_sell FROM vendor_catalog_items WHERE id = ${id}
    `);
    const before = beforeRows.rows?.[0] as Record<string, unknown> | undefined;

    // ── Compute price_sell server-side (never from client) ─────────────────────
    // SAFE normalization rules (non-destructive):
    //
    //   External vendor:
    //     base > 0 → sell = ceil(base * (1 + markup/100))
    //     base = 0 → sell = null
    //
    //   Internal vendor (is_internal_vendor=true, markup forced to 0):
    //     base > 0 → sell = base
    //     base = 0 AND existing sell IS NULL → sell = null (no change)
    //     base = 0 AND existing sell > 0 →
    //       LEGACY_PRICE_CONFLICT: preserve existing sell, do NOT overwrite with null.
    //       Admin must explicitly set price_base to update price_sell.
    const existingSell = before?.price_sell != null ? Number(before.price_sell) : null;
    let legacyPriceConflict = false;
    let sell: number | null;

    if (isInternalVendor && (base == null || base === 0) && existingSell != null && existingSell > 0) {
      // Safety guard: refuse to silently destroy a non-zero price_sell for internal vendor
      // when no valid base price was provided. Classify as legacy_price_conflict.
      sell = existingSell;
      legacyPriceConflict = true;
    } else {
      sell = base != null && base > 0 ? Math.ceil(base * (1 + effectiveMarkup / 100)) : null;
    }

    // ── Apply update ─────────────────────────────────────────────────────────
    // is_published: only mutated when caller explicitly sends a boolean.
    // Truthy/falsy coercion avoided — typeof check guards boolean false.
    const publishFields: Partial<{
      isPublished: boolean;
      status: string;
    }> = typeof is_published === "boolean"
      ? { isPublished: is_published, status: is_published ? "published" : "draft" }
      : {};

    const [updated] = await db
      .update(vendorCatalogItemsTable)
      .set({
        name:        String(name).slice(0, 200),
        description: description?.trim() || null,
        priceBase:   base != null ? String(base) : "0",
        markupPct:   String(effectiveMarkup),
        priceSell:   sell != null ? String(sell) : null,
        kategori:    kategori?.trim() || null,
        updatedAt:   new Date(),
        ...publishFields,
      })
      .where(eq(vendorCatalogItemsTable.id, id))
      .returning({ id: vendorCatalogItemsTable.id });

    if (!updated) return res.status(404).json({ message: "Item tidak ditemukan" });

    // ── Audit log (non-blocking, never fails the request) ─────────────────────
    const actor = _adminIdOf(req as PortalAuthReq);
    const actorEmail = (req as any).user?.email ?? (req as any).portalUser?.email ?? null;
    void db.execute(sql`
      INSERT INTO erp_audit_logs
        (user_id, user_email, action, module, reference_id, old_data, new_data, ip_address, created_at)
      VALUES (
        ${actor ?? "unknown"},
        ${actorEmail},
        'UPDATE_CATALOG_PRICE',
        'marketplace_catalog',
        ${String(id)},
        ${JSON.stringify({ price_base: before?.price_base ?? null, markup_pct: before?.markup_pct ?? null, price_sell: before?.price_sell ?? null })}::jsonb,
        ${JSON.stringify({ price_base: base, markup_pct: effectiveMarkup, price_sell: sell, requested_markup: requestedMarkup, effective_markup: effectiveMarkup, reason: markupOverrideReason, legacy_price_conflict: legacyPriceConflict || undefined })}::jsonb,
        ${req.ip ?? null},
        NOW()
      )
    `).catch(e => console.error("[catalog-price-audit] log error", e));

    return res.json({
      ok: true,
      price_sell: sell,
      is_internal_vendor: isInternalVendor,
      effective_markup: effectiveMarkup,
      ...(typeof is_published === "boolean" ? { is_published } : {}),
      ...(legacyPriceConflict ? {
        legacy_price_conflict: true,
        warning: "Internal vendor dengan price_base=0 memiliki price_sell yang dipertahankan. Set price_base untuk mengupdate price_sell.",
      } : {}),
    });
  } catch (e) {
    console.error("[portal] PUT vendor-catalog-items error", e);
    return res.status(500).json({ error: "Gagal memperbarui detail produk" });
  }
});

// DELETE /api/portal/admin/vendor-catalog-items/:id — soft-archive item (no hard delete)
router.delete("/admin/vendor-catalog-items/:id", requirePortalAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  try {
    await db.execute(sql`
      UPDATE vendor_catalog_items
      SET is_active = false, is_published = false, status = 'archived', updated_at = NOW()
      WHERE id = ${id}
    `);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[portal] DELETE vendor-catalog-items error", e);
    return res.status(500).json({ error: "Gagal mengarsip item katalog" });
  }
});

// ── C1 FIX: Cookie-based session endpoints ────────────────────────────────────

/**
 * POST /api/portal/auth/set-cookie
 * Menerima Bearer token (dari localStorage), menyimpannya sebagai HttpOnly cookie.
 * Migration path: frontend memanggil ini setelah login berhasil.
 * Setelah migrasi selesai, token tidak perlu lagi disimpan di localStorage.
 */
router.post("/auth/set-cookie", requirePortalAuth, (req, res) => {
  // Token sudah divalidasi oleh requirePortalAuth (bisa dari cookie atau Bearer)
  // Ambil token dari header Bearer untuk di-set ke cookie
  const bearerHeader = req.headers.authorization;
  const cookieToken = (req.cookies as Record<string, string>)?.[PORTAL_SESSION_COOKIE];
  const token = (bearerHeader?.startsWith("Bearer ") ? bearerHeader.slice(7) : null) ?? cookieToken;

  if (!token) {
    return res.status(400).json({ error: "No token to persist" });
  }

  setPortalSessionCookie(res, token);
  return res.json({ ok: true, message: "Session persisted as HttpOnly cookie" });
});

// NOTE: /auth/logout is also registered earlier (line ~591) using clearPortalSessionCookie.
// The duplicate below has been removed to avoid Express registering two handlers for the same route.
/**
 * POST /api/portal/auth/logout
 * Menghapus HttpOnly session cookie dan invalidasi sesi.
 * Frontend harus tetap menghapus localStorage entries sendiri.
 */
router.post("/auth/logout", (req, res) => {
  clearPortalSessionCookie(res);
  return res.json({ ok: true, message: "Logged out" });
});

// ─────────────────────────────────────────────────────────────────────────────

export default router;
