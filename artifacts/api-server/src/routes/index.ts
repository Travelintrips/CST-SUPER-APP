import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { allocationRouter } from "./allocation.js";
import { bankAllocationMatchingRouter } from "./bankAllocationMatching.js";
import healthRouter from "./health";
import usersRouter from "./users";
import dashboardRouter from "./dashboard";
import ecommerceRouter from "./ecommerce";
import tradingRouter from "./trading";
// logistics.ts (LAMA) dinonaktifkan — pakai freight.ts (BARU) yang memakai tabel freight_shipments.
// Jika diaktifkan kembali, akan terjadi route shadowing di /api/logistics/shipments → tabel lama.
// import logisticsRouter from "./logistics";
import freightRouter from "./freight";
import salesRouter from "./sales";
import purchaseRouter, { purchasePublicRouter } from "./purchase";
import reportsRouter from "./reports";
import paymentsRouter, { paymentsWebhookRouter, paylabsPortalRouter } from "./payments";
import accountingRouter from "./accounting";
import accountingHubRouter from "./accountingHub.js";
import coaGovernanceRouter from "./coaGovernance.js";
import coaProposalsRouter from "./coaProposals.js";
import storageRouter from "./storage";
import correspondencesRouter from "./correspondences";
import emailCorrespondencesRouter from "./emailCorrespondences";
import scanDocumentRouter from "./scanDocument";
import { invoiceOcrRouter } from "./invoiceOcr";
import expensesRouter from "./expenses";
import portalRouter from "./portal";
import { masterPriceRouter } from "./masterPrice.js";
import { logisticOrdersRouter, logisticOrderTrackPublicRouter } from "./logisticOrders";
import { logisticRfqRouter } from "./logisticRfq";
import { productFirstFlowRouter } from "./productFirstFlow";
import { logisticRfqV2Router } from "./logisticRfqV2";
import settingsRouter from "./settings";
import { driverRouter, driversAdminRouter } from "./driver";
import webhooksRouter from "./webhooks";
import { aiAgentRouter } from "./aiAgent";
import { portalProductOrdersRouter } from "./portalProductOrders";
import geocodeRouter from "./geocode";
import { whatsappRouter } from "./whatsapp";
import { vendorResponseRouter } from "./vendorResponse";
import mediaRouter from "./media";
import taxRouter from "./tax.js";
import taxSptControlRouter from "./taxSptControl.js";
import { customerServiceRequestsRouter } from "./customerServiceRequests.js";
import { servicePackagesRouter } from "./servicePackages.js";
import { portalCustomerProfileRouter } from "./portalCustomerProfile.js";
import { customerVerificationRouter, customerVerificationAdminRouter } from "./customerVerification.js";
import { adminServiceRequestsRouter } from "./adminServiceRequests.js";
import { dbSyncRouter } from "./dbSync.js";
import { tokenSecurityStatsRouter } from "./tokenSecurityStats.js";
import { orderLinksAdminRouter } from "./orderLinksAdmin.js";
import sapHardeningRouter from "./sapHardening.js";
import financeCoreRouter from "./financeCore.js";
import financeGovernanceRouter from "./financeGovernance.js";
import vendorStatusRouter from "./vendorStatus.js";
import { vendorCompanyProfileRouter } from "./vendorCompanyProfile.js";
import devTestRouter from "./devTestRoutes.js";
import { aiTransactionReviewRouter } from "./aiTransactionReview.js";
import { aiLearningCenterRouter } from "./aiLearningCenter.js";

import warehouseRouter from "./warehouse";
import inventoryReceiveRouter from "./inventoryReceive";
import inventoryStockRouter from "./inventoryStock";
import inventoryMainRouter from "./inventoryMain";
import customRolesRouter from "./customRoles";
import thaiTeaSuppliesRouter from "./thaiTeaSupplies";
import purchaseWorkflowRouter from "./purchaseWorkflow";
import uomRouter from "./uom";
import orgRouter from "./org";
import approvalWorkflowRouter from "./approvalWorkflow";
import approvalRulesRouter from "./approvalRules";
import approvalMatrixRouter from "./approvalMatrix.js";
import productBomRouter from "./productBom";
import auditLogRouter from "./auditLog";
import auditReportsRouter from "./auditReports";

import navPreferencesRouter from "./navPreferences";
import companiesRouter from "./companies";
import notificationsRouter from "./notifications";

import { vendorMiniFormRouter } from "./vendorMiniForm";
import {
  customerQuoteAdminRouter,
  customerQuotePublicRouter,
  orderTaskPublicRouter,
  customerOrderPublicRouter,
} from "./customerQuoteFlow";

import storageAuditLogRouter from "./storageAuditLog.js";
import { vendorPerformanceRouter } from "./vendorPerformance";
import { internalTasksRouter } from "./internalTasks";
import { podOcrRouter } from "./podOcr";
import { marginRulesRouter } from "./marginRules";
import { adminActionPublicRouter, adminActionAdminRouter } from "./adminAction";
import { vendorFulfillmentPublicRouter } from "./vendorFulfillment";
import { logisticVendorFulfillmentAdminRouter } from "./logisticVendorFulfillmentAdmin.js";
import { driverProgressPublicRouter } from "./driverProgress.js";
import { fulfillmentAdminRouter, fulfillmentPublicRouter } from "./orderFulfillment.js";
import { vendorJobAdminRouter, vendorJobPublicRouter, orderTrackingPublicRouter } from "./vendorJobOrder.js";
import { resolveShortLink } from "../lib/shortLink.js";
import { bankReconciliationRouter } from "./bankReconciliation.js";
import bankReconRulesRouter from "./bankReconRules.js";
import bankReconEcfRouter from "./bankReconExpectedCashFlows.js";
import bankReconGovernanceRouter from "./bankReconGovernance.js";
import bankMutationImportRouter, { runBankMutationImportMigration } from "./bankMutationImport.js";
import { fleetIntelligenceRouter, runFleetIntelligenceMigration } from "./fleetIntelligence.js";
import { bankMutationMastersRouter, runBankMutationMastersMigration } from "./bankMutationMasters.js";
import { commodityTemplatesRouter } from "./commodityTemplates.js";
import pushRouter from "./push.js";
import { intelligenceAlertsRouter } from "./intelligenceAlerts.js";
import { aiApprovalsRouter } from "./aiApprovals.js";
import { operationalContextRouter } from "./operationalContext.js";
import { aiDecisionMemoryRouter } from "./aiDecisionMemory.js";
import { productTemplatesRouter } from "./productTemplates.js";
import logisticsUnitsRouter from "./logisticsUnits.js";
import truckingRatesRouter from "./truckingRates.js";
import truckingBookingsRouter from "./truckingBookings.js";
import { enterpriseWorkflowRouter } from "./enterpriseWorkflow.js";
import { customerFeedbackPublicRouter, customerFeedbackAdminRouter } from "./customerFeedback.js";
import { purchaseMiniPublicRouter, purchaseMiniAdminRouter } from "./purchaseMiniFormRoute.js";
import { paymentProofPublicRouter, paymentProofAdminRouter } from "./paymentProof.js";

import { orderAuditTrailRouter } from "./orderAuditTrail.js";
import { serviceTemplatesRouter } from "./serviceTemplates.js";
import { vendorTrackingAdminRouter, vendorTrackingPublicRouter } from "./vendorTracking.js";
import { customerDataFormPublicRouter, customerDataFormAdminRouter } from "./customerDataForm.js";
import { paymentProofRouter } from "./paymentProof.js";
import { publicTokenRateLimiter, aiRateLimiter, tokenGetRateLimiter, tokenPostRateLimiter } from "../middlewares/securityRateLimiter.js";

import { settlementPatternsRouter } from "./settlementPatterns.js";
import { systemObservabilityRouter } from "./systemObservability.js";
import { exceptionsRouter } from "./exceptions.js";
import { orderExceptionsRouter } from "./orderExceptions.js";
import { waNotificationLogsRouter } from "./waNotificationLogs.js";
import analyticsProfitRouter from "./analyticsProfit.js";
import { vendorRecommendationRouter } from "./vendorRecommendation.js";
import { vendorCommodityIntelligenceRouter } from "./vendorCommodityIntelligence.js";
import productFirstAnalyticsRouter from "./productFirstAnalytics.js";
import productFirstAuditDashboardRouter from "./productFirstAuditDashboard.js";
import { productFirstOverrideRouter } from "./productFirstOverride.js";
import { portalQuickQuotesPublicRouter, portalQuickQuotesAdminRouter } from "./portalQuickQuotes.js";
import mktAdminRouter from "./mktAdmin.js";
import mktPortalRouter from "./mktPortal.js";
import { vendorQuotePublicRouter } from "./vendorQuotePublic.js";
import mktVendorPoRouter from "./mktVendorPo.js";
import { systemRouter } from "./system.js";
import rbacRouter from "./rbac.js";
import importAdvisorRouter from "./importAdvisor.js";
import { freightDocVerifyRouter } from "./freightDocVerify.js";
import btkiRouter from "./btki.js";
import importCalculatorRouter from "./importCalculator.js";
import { handleAlertSse } from "../lib/alertsBroadcast.js";
import { requireAdmin } from "../lib/requireAdmin.js";
import { makeRbacGuard } from "../lib/rbacMiddleware.js";
import { financeAuditMiddleware } from "../lib/financeAuditMiddleware.js";
import { writeMethodGovernanceGuard } from "../lib/financeGovernanceGuard.js";
import sportCenterRouter from "../modules/sport-center/routes.js";
import tenantRouter from "../modules/tenant/routes.js";
import airFreightNewRouter from "./airFreight.js";
import airFreightRatesRouter from "./airFreightRates.js";
import airFreightPublicRouter from "./airFreightPublic.js";
import oceanFreightRouter from "./oceanFreight.js";
import oceanFreightRatesRouter from "./oceanFreightRates.js";
import { oceanFreightPublicRouter } from "./oceanFreightPublic.js";
import { oceanFreightVendorFormRouter } from "./oceanFreightVendorForm.js";
import executiveRouter from "./executive.js";
import cashAdvancesRouter from "./cashAdvances.js";
import auditDanaTalanganRouter from "./auditDanaTalangan.js";
import auditDisbursementExpenseRouter from "./auditDisbursementExpense.js";
import advancesRouter from "./advances.js";
import payrollRouter from "./payroll.js";
import vendorPaymentsRouter from "./vendorPayments.js";
import vendorInstallmentsRouter from "./vendorInstallments.js";
import bankLoansRouter from "./bankLoans.js";
import bankDisbursementsRouter from "./bankDisbursements.js";
import bankReceiptsRouter from "./bankReceipts.js";
import kasBankRouter from "./kasBank.js";
import { cashBankRouter } from "./cashBank.js";
import cashFlowForecastRouter from "./cashFlowForecast.js";
import fixedAssetsRouter from "./fixedAssets.js";
import expenseApprovalsRouter from "./expenseApprovals.js";
import expenseDashboardRouter from "./expenseDashboard.js";
import expenseTemplatesRouter from "./expenseTemplates.js";
import expenseBudgetsRouter from "./expenseBudgets.js";
// ⛔ DEAD IMPORT — airFreightRouter (named export) diimport tapi TIDAK pernah di-mount.
// Hanya default export (airFreightNewRouter) yang dipakai via router.use("/air-freight", airFreightNewRouter).
// Jangan hapus file airFreight.js, hanya import ini yang di-freeze.
// import { airFreightRouter } from "./airFreight.js"; // FROZEN 2026-06-11
import { airFreightVendorFormRouter } from "./airFreightVendorForm.js";

import logisticsRatesRouter from "./logisticsRates.js";
import { marketplaceRouter } from "./marketplace.js";
import { escrowAdminRouter, escrowPublicRouter } from "./escrow.js";
import { vendorCatalogEnginePublicRouter, vendorCatalogEngineAdminRouter } from "./vendorCatalogEngine.js";
import orderCostsRouter from "./orderCosts.js";
import vendorTruckingPricingRouter from "./vendorTruckingPricing.js";
import productMediaRouter from "./productMedia.js";
import oceanFreightMasterRouter from "./oceanFreightMaster.js";
import ppjkRouter from "./ppjk.js";
import qrMenuRouter from "./qrMenu.js";
import financialPeriodsRouter from "./financialPeriods.js";
import financialClosingRouter from "./financialClosing.js";
import ledgerRouter from "./ledger.js";
import reconciliationRouter from "./reconciliation.js";
import waReportSettingsRouter from "./waReportSettings.js";
import { bankDescriptionNormalizerRouter } from "./bankDescriptionNormalizer.js";
import { expenseRulesRouter } from "./expenseRules.js";
import { expenseClassificationRouter } from "./expenseClassification.js";
import { reconClassificationRouter } from "./reconClassificationConfig.js";

const router: IRouter = Router();

router.get("/", (_req, res) => { res.json({ status: "ok" }); });

router.use(healthRouter);
router.use("/users", usersRouter);
router.use("/companies", companiesRouter);
router.use("/dashboard", dashboardRouter);
router.use("/ecommerce", ecommerceRouter);
router.use("/trading", tradingRouter);
// logistics.ts (LAMA) dinonaktifkan — lihat komentar import di atas.
// router.use("/logistics", logisticsRouter);
router.use("/logistics", freightRouter);
// pos.ts (LAMA) dinonaktifkan — lihat komentar import di atas.
// router.use("/pos", posRouter);
router.use("/sales", salesRouter);
router.use("/purchase", purchasePublicRouter);
router.use("/purchase", makeRbacGuard("purchase"), purchaseRouter);
router.use("/reports", reportsRouter);
// Paylabs webhook is RSA-signature authenticated, not session-scoped.
// Must be mounted BEFORE the RBAC guard so Paylabs can POST without a session.
router.use("/payments", paymentsWebhookRouter);
// Paylabs portal-admin routes use portal JWT (requirePortalAdmin), not a
// BizPortal session. Mount at /payments/paylabs BEFORE the RBAC-guarded
// paymentsRouter so makeRbacGuard("invoice") does not block the portal JWT.
// Security is maintained — every route inside paylabsPortalRouter requires
// requirePortalAdmin; no route is public or weakened.
router.use("/payments/paylabs", paylabsPortalRouter);
router.use("/payments", makeRbacGuard("invoice"), paymentsRouter);
router.use("/accounting", accountingHubRouter);

// Governance must be mounted BEFORE the accounting router to avoid makeRbacGuard("invoice")
// blocking governance role access. Express matches in order; governance routes are fully
// handled by financeGovernanceRouter before accountingRouter sees the request.
router.use("/accounting/governance", financeGovernanceRouter);
// COA Governance (Task #5): change-request maker-checker workflow.
// Mounted before accountingRouter so /accounting/coa/* is fully handled here.
router.use("/accounting/coa", financeAuditMiddleware, makeRbacGuard("invoice"), coaGovernanceRouter);
// COA Proposals (Task #7): AI-driven proposal engine with maker-checker governance.
// Mounted before accountingRouter to avoid generic RBAC interception.
router.use("/accounting/coa-proposals", financeAuditMiddleware, makeRbacGuard("invoice"), coaProposalsRouter);
router.use("/accounting", financeAuditMiddleware, writeMethodGovernanceGuard, makeRbacGuard("invoice"), accountingRouter);
router.use("/correspondences", correspondencesRouter);
router.use("/email-correspondences", emailCorrespondencesRouter);
router.use("/scan-document", scanDocumentRouter);
router.use("/invoice-ocr", invoiceOcrRouter);
router.use("/expenses", expensesRouter);
router.use("/portal", portalRouter);
router.use("/portal/admin/master-price", masterPriceRouter);
router.use("/vendor-status", makeRbacGuard("purchase"), vendorStatusRouter);
// Vendor company profile & completion — document-types and catalog routes must come BEFORE /:id
router.use("/trading/suppliers", vendorCompanyProfileRouter);
router.use("/marketplace", marketplaceRouter);
router.use("/vendor-catalog-engine", vendorCatalogEnginePublicRouter);
router.use("/trading/catalog-engine", vendorCatalogEngineAdminRouter);
// PERHATIAN: logisticRfqRouter dan logisticOrdersRouter keduanya di-mount di /logistic/orders.
// Express akan mencoba logisticRfqRouter dulu; jika tidak ada handler yang cocok, baru logisticOrdersRouter.
// Risiko: jika keduanya mendefinisikan path yang sama (misal GET /), hanya yang pertama yang merespons.
// TODO Step 2: pisahkan sub-path agar tidak ada ambiguitas (misal /logistic/rfq vs /logistic/orders).
// Public tracking (anonymous customer-portal visitors) — must be mounted before
// the RBAC-guarded routers below, or the guard would 401 every request.
router.use("/logistic/orders", logisticOrderTrackPublicRouter);
router.use("/logistic/orders", makeRbacGuard("rfq"), logisticRfqRouter);
// Phase 2A: Product-First Flow endpoints (product-rfq, select-product-vendor, dll.)
router.use("/logistic/orders", makeRbacGuard("rfq"), productFirstFlowRouter);
router.use("/logistic/orders", makeRbacGuard("rfq"), logisticOrdersRouter);
router.use("/logistic", makeRbacGuard("rfq"), logisticRfqV2Router);
router.use("/settings", makeRbacGuard("settings"), settingsRouter);
// Mobile driver app uses its own HMAC-JWT auth (requireDriverAuth inside driverRouter).
// Do NOT wrap with makeRbacGuard — the guard requires a BizPortal session and would
// block every driver login, /me, and /jobs request from Expo Go.
router.use("/driver", driverRouter);
router.use("/drivers", makeRbacGuard("pod"), driversAdminRouter);
router.use(storageRouter);
router.use(webhooksRouter);
// Part C — AI rate limiting (60 req/min/user in prod)
router.use(["/ai-agent", "/ai-approvals", "/ai"], aiRateLimiter);

router.use("/ai-agent", aiAgentRouter);
router.use("/portal-product", portalProductOrdersRouter);
router.use(geocodeRouter);
router.use("/whatsapp", whatsappRouter);
router.use("/vendor-response", vendorResponseRouter);
router.use("/media", mediaRouter);
router.use("/product-media", productMediaRouter);

router.use("/warehouse", warehouseRouter);
router.use("/inventory", inventoryMainRouter);
router.use("/inventory/receive", inventoryReceiveRouter);
// CATATAN: inventoryStockRouter di-mount dua kali di path berbeda (by design).
// /inventory/stock      → akses data stok per produk
// /inventory/warehouses → DEPRECATED alias — tidak ada frontend caller aktif (audit Phase 5)
// Jadwal hapus: release berikutnya setelah monitoring 1 sprint
router.use("/inventory/stock", inventoryStockRouter);
router.use(
  "/inventory/warehouses",
  (_req: any, res: any, next: any) => {
    res.setHeader("Deprecation", "true");
    res.setHeader("X-Deprecated-Route", "/inventory/warehouses is deprecated - use /inventory/stock instead");
    next();
  },
  inventoryStockRouter,
);
router.use("/custom-roles", customRolesRouter);
router.use("/thai-tea", thaiTeaSuppliesRouter);
router.use("/purchase-workflow", makeRbacGuard("purchase"), purchaseWorkflowRouter);
router.use("/uom", uomRouter);
router.use("/org", orgRouter);
router.use("/approvals", approvalWorkflowRouter);
router.use("/approval-rules", approvalRulesRouter);
router.use("/approval-matrix", approvalMatrixRouter);
router.use("/bom", productBomRouter);
router.use("/audit-logs", auditLogRouter);
router.use("/erp-audits", auditReportsRouter);
router.use("/storage-audit", storageAuditLogRouter);

router.use("/notifications", notificationsRouter);
router.use("/nav-preferences", navPreferencesRouter);

// P0.3 — Stricter per-IP+path rate limits BEFORE public token route mounts.
// GET: 5 req/min (token enumeration prevention). POST: 10 req/hr (brute-force prevention).
// Keyed by IP+path (path already contains token slug for public endpoints).
router.use(
  ["/admin-action", "/vendor-fulfillment", "/fulfillment", "/customer-quote",
   "/order-task", "/customer-order", "/vendor-form", "/customer-form", "/purchase-mini",
   "/customer-invoice", "/customer-feedback", "/customer-data", "/driver-progress",
   "/vendor-catalog-engine"],
  (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET") return tokenGetRateLimiter(req, res, next);
    if (req.method === "POST") return tokenPostRateLimiter(req, res, next);
    return next();
  }
);

router.use("/vendor-form", vendorMiniFormRouter);
router.use("/customer-form", vendorMiniFormRouter);
router.use("/admin-form", vendorMiniFormRouter);
router.use("/logistic", makeRbacGuard("customer_approval"), customerQuoteAdminRouter);
router.use("/customer-quote", customerQuotePublicRouter);
router.use("/order-task", orderTaskPublicRouter);
router.use("/customer-order", customerOrderPublicRouter);
router.use("/vendor-performance", vendorPerformanceRouter);
router.use("/internal-tasks", internalTasksRouter);
router.use("/pod-ocr", makeRbacGuard("pod"), podOcrRouter);
router.use("/margin-rules", marginRulesRouter);
router.use("/admin-action", adminActionAdminRouter);
router.use("/admin-action", adminActionPublicRouter);
router.use("/vendor-fulfillment", vendorFulfillmentPublicRouter);
router.use("/logistic/vendor-fulfillments", logisticVendorFulfillmentAdminRouter);
router.use("/driver-progress", driverProgressPublicRouter);
router.use("/commodity-templates", makeRbacGuard("templates"), commodityTemplatesRouter);
router.use("/logistic", fulfillmentAdminRouter);
router.use("/fulfillment", fulfillmentPublicRouter);
router.use("/logistic", vendorJobAdminRouter);
// Part B — Public token rate limiting (30 req/min/IP in prod)
router.use(["/vendor-job", "/order-track"], publicTokenRateLimiter);

router.use("/vendor-job", vendorJobPublicRouter);
router.use("/order-track", orderTrackingPublicRouter);
router.use("/push", pushRouter);
router.use("/intelligence-alerts", intelligenceAlertsRouter);
router.use("/ai-approvals", aiApprovalsRouter);
router.use("/operational-context", operationalContextRouter);
router.use("/ai/decision-memory", aiDecisionMemoryRouter);
router.use("/product-templates", makeRbacGuard("templates"), productTemplatesRouter);
router.use("/logistics-units", logisticsUnitsRouter);
router.use("/trucking-rates", truckingRatesRouter);
router.use("/logistics-rates", logisticsRatesRouter);
router.use("/trucking/bookings", truckingBookingsRouter);
router.use("/enterprise-workflow", enterpriseWorkflowRouter);
router.use("/customer-feedback", customerFeedbackAdminRouter);
router.use("/customer-feedback", customerFeedbackPublicRouter);
router.use("/purchase-mini", makeRbacGuard("purchase"), purchaseMiniAdminRouter);
router.use("/purchase-mini", purchaseMiniPublicRouter);

router.use("/customer-invoice", paymentProofPublicRouter);
router.use("/customer-invoice", paymentProofAdminRouter);

router.use("/service-templates", makeRbacGuard("templates"), serviceTemplatesRouter);
router.use("/payment-proof", paymentProofRouter);

router.use("/logistic", orderAuditTrailRouter);
router.use("/logistic", orderExceptionsRouter);
router.use("/logistic", vendorTrackingAdminRouter);
router.use("/vendor-tracking", vendorTrackingPublicRouter);
router.use("/customer-data", customerDataFormPublicRouter);
router.use("/logistic", customerDataFormAdminRouter);
router.use("/logistic/orders", productFirstOverrideRouter);
router.use("/logistic/product-first/analytics", productFirstAnalyticsRouter);
router.use("/logistic/product-first/audit", productFirstAuditDashboardRouter);

router.use("/logs", systemObservabilityRouter);
router.use("/exceptions", exceptionsRouter);
router.use("/wa-notification-logs", waNotificationLogsRouter);
router.use("/analytics/profitability", analyticsProfitRouter);
router.use("/vendor-recommendation", vendorRecommendationRouter);
router.use("/vendor-intelligence", vendorCommodityIntelligenceRouter);
router.use("/order-costs", orderCostsRouter);
router.use("/system", systemRouter);
router.use("/rbac", rbacRouter);
router.use("/import-advisor", importAdvisorRouter);
router.use("/freight", freightDocVerifyRouter);
router.use("/btki", btkiRouter);
router.use("/import-calculator", importCalculatorRouter);
router.use("/sport-center", sportCenterRouter);
router.use("/tenant", tenantRouter);
router.use("/qr-menu", qrMenuRouter);
router.use("/air-freight", airFreightNewRouter);
router.use("/air-freight", airFreightRatesRouter);
router.use("/air-freight", airFreightPublicRouter);
// Public/rates mounts FIRST — oceanFreightRouter has GET /:id catch-all
// that would intercept /options, /rates, /calculate, /inquiry, etc. if mounted first.
router.use("/ocean-freight", oceanFreightPublicRouter);
router.use("/ocean-freight", oceanFreightRatesRouter);
router.use("/ocean-freight", oceanFreightRouter);
router.use("/ocean-freight/vendor-form", oceanFreightVendorFormRouter);
router.use("/executive", executiveRouter);
router.use("/cash-advances", cashAdvancesRouter);
router.use("/audit/dana-talangan", auditDanaTalanganRouter);
router.use("/audit/disbursement-expense", auditDisbursementExpenseRouter);
router.use("/advances", advancesRouter);
router.use("/payroll", payrollRouter);
// Allocation Engine: writeMethodGovernanceGuard dihapus karena:
// 1. allocationRouter punya requireAdmin guard sendiri (lebih ketat dari requireFinanceWriteRole)
// 2. Period lock check sudah ada di _postEntryCore (accounting.ts) saat POST /:id/post
// 3. Action endpoints (submit/approve/reject/reverse) tidak membuat journal entry
// 4. Guard PERIOD_DATE_REQUIRED tidak relevan — allocation pakai allocation_date, bukan date
router.use("/allocation", financeAuditMiddleware, makeRbacGuard("invoice"), allocationRouter);
// Bank Allocation & Auto-Matching (Sprint 4 Phase 2): scoring/recommendation only.
// bankAllocationMatchingRouter has its own requireAdmin guard; it never posts a
// journal itself — confirmed matches only create DRAFT allocation_headers/lines,
// which then flow through the (unchanged) allocationRouter submit/approve/post chain.
router.use("/bank-allocation", financeAuditMiddleware, makeRbacGuard("invoice"), bankAllocationMatchingRouter);
router.use("/vendor-payments", vendorPaymentsRouter);
router.use("/vendor-installments", vendorInstallmentsRouter);
router.use("/bank-loans", bankLoansRouter);
// OCR endpoints (/ocr-extract, /ocr-preview) are read-only AI analysis — no DB writes.
// They should be accessible to any authenticated BizPortal user regardless of how they
// authenticated (session cookie OR Supabase bearer).  If isInternalSession is false but
// the user IS authenticated (e.g. via Supabase bearer after supabase-exchange), elevate
// the flag so makeRbacGuard does not block them.
function bdOcrAuthElevation(req: Request, _res: Response, next: NextFunction): void {
  const isOcrPath =
    req.path === "/ocr-extract" || req.path.endsWith("/ocr-extract") ||
    req.path === "/ocr-preview"  || req.path.endsWith("/ocr-preview");
  if (isOcrPath && req.isAuthenticated?.() && !(req as any).isInternalSession) {
    (req as any).isInternalSession = true;
  }
  next();
}

router.use("/accounting/bank-disbursements", financeAuditMiddleware, writeMethodGovernanceGuard, bdOcrAuthElevation, makeRbacGuard("invoice"), bankDisbursementsRouter);
router.use("/accounting/bank-receipts", financeAuditMiddleware, writeMethodGovernanceGuard, makeRbacGuard("invoice"), bankReceiptsRouter);
router.use("/accounting/kas-bank", financeAuditMiddleware, makeRbacGuard("invoice"), kasBankRouter);
router.use("/cash-bank", financeAuditMiddleware, makeRbacGuard("invoice"), cashBankRouter);
router.use("/accounting/cash-flow-forecast", financeAuditMiddleware, cashFlowForecastRouter);
router.use("/bank-reconciliation", bankReconciliationRouter);
// Phase Enterprise — Recon Rule Engine CRUD
router.use("/bank-reconciliation/rules", bankReconRulesRouter);
// Phase Enterprise — Expected Cash Flow Engine
router.use("/bank-reconciliation/expected-cash-flows", bankReconEcfRouter);
router.use("/bank-reconciliation", bankReconGovernanceRouter);
router.use("/bank-mutation-import", bankMutationImportRouter);
router.use("/bank-mutation-masters", bankMutationMastersRouter);
router.use("/accounting/periods", financeAuditMiddleware, writeMethodGovernanceGuard, makeRbacGuard("invoice"), financialPeriodsRouter);
router.use("/accounting/closing", financeAuditMiddleware, writeMethodGovernanceGuard, makeRbacGuard("invoice"), financialClosingRouter);
router.use("/accounting/ledger", financeAuditMiddleware, writeMethodGovernanceGuard, makeRbacGuard("invoice"), ledgerRouter);
router.use("/accounting/reconciliation", financeAuditMiddleware, writeMethodGovernanceGuard, makeRbacGuard("invoice"), reconciliationRouter);
// Phase 2 — Bank Description Normalizer simulation API (read-only, requireAdmin)
router.use("/bank-recon", bankDescriptionNormalizerRouter);
// Phase 3 — Expense Rule Engine CRUD + simulate (requireAdmin)
router.use("/expense-rules", expenseRulesRouter);
// Phase 6D — Expense Classification (normalizer → rule engine → AI pipeline)
router.use("/bank-recon", expenseClassificationRouter);
router.use("/recon-classification", reconClassificationRouter);
// Settlement Pattern Engine — configurable provider recognition (advisory only)
router.use("/settlement-patterns", settlementPatternsRouter);
router.use("/accounting/wa-report", waReportSettingsRouter);
router.use("/fixed-assets", fixedAssetsRouter);
router.use("/expense-approvals", expenseApprovalsRouter);
router.use("/expense-dashboard", expenseDashboardRouter);
router.use("/expense-templates", expenseTemplatesRouter);
router.use("/expense-config", expenseBudgetsRouter);
router.use("/air-freight-form", airFreightVendorFormRouter);
router.use("/ocean-freight-master", oceanFreightMasterRouter);
router.use("/ppjk", ppjkRouter);

router.use("/sales/escrow", escrowPublicRouter);
router.use("/sales/escrow", escrowAdminRouter);
router.use("/vendor-trucking-pricing", vendorTruckingPricingRouter);
router.use("/tax", taxRouter);
router.use("/tax/spt-control", taxSptControlRouter);
router.use("/customer-service-requests", customerServiceRequestsRouter);
router.use("/service-packages", servicePackagesRouter);
router.use("/portal/customer-profile", portalCustomerProfileRouter);
router.use("/customer-verification", customerVerificationRouter);
router.use("/customer-verification/admin", customerVerificationAdminRouter);
router.use("/admin/service-requests", adminServiceRequestsRouter);
router.use("/admin/db-sync", dbSyncRouter);
// P2.3 — Token security observability (admin only)
router.use("/admin/token-security/stats", async (req: Request, res: Response, next: NextFunction) => {
  const ok = await requireAdmin(req, res);
  if (ok) next();
}, tokenSecurityStatsRouter);
// Phase 3C — Order Links cross-reference diagnostics (admin only, dry-run only)
router.use("/admin/order-links", async (req: Request, res: Response, next: NextFunction) => {
  const ok = await requireAdmin(req, res);
  if (ok) next();
}, orderLinksAdminRouter);
router.use("/sap-hardening", sapHardeningRouter);
router.use("/finance-core", makeRbacGuard("invoice"), financeCoreRouter);
router.use("/portal/quick-quote", portalQuickQuotesPublicRouter);
router.use("/portal/admin/quick-quotes", portalQuickQuotesAdminRouter);
// Phase 2A.1 — Marketplace Dual Write Reliability admin
router.use("/mkt/admin", mktAdminRouter);
// Phase 2F — Marketplace Portal (buyer / approver, portal auth)
router.use("/mkt/portal", mktPortalRouter);
// Phase 2D — Vendor Quote Submission (public, token-based)
router.use("/vendor-quote", vendorQuotePublicRouter);
// Phase 2G — Vendor PO confirmation (public, token-based)
router.use("/mkt/vendor-po", publicTokenRateLimiter, mktVendorPoRouter);
router.get("/alerts/stream", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  handleAlertSse(req, res);
});

async function handleShortLink(req: Request, res: Response) {
  const code = String(req.params.code ?? "").trim();
  if (!code || !/^[A-Z0-9]{4,32}$/i.test(code)) {
    return res.status(400).json({ error: "Invalid short link" });
  }
  const target = await resolveShortLink(code);
  if (!target) {
    return res.status(404).json({ error: "Link tidak ditemukan atau sudah kedaluwarsa." });
  }
  let targetUrl = target;
  try {
    const parsed = new URL(target);
    targetUrl = parsed.pathname + parsed.search + parsed.hash;
  } catch { /* sudah relative */ }
  return res.json({ targetUrl });
}

router.get("/q/:code", handleShortLink);
router.get("/s/:code", handleShortLink);

router.use("/logistics/fleet", fleetIntelligenceRouter);

// ── AI Transaction Intelligence — Phase 10 ───────────────────────────────────
router.use("/ai-transaction", aiTransactionReviewRouter);
router.use("/ai-review", aiLearningCenterRouter);

// ── Dev-test endpoints (disabled in production via NODE_ENV guard) ────────────
router.use("/dev-test", devTestRouter);

// ── FROZEN: module-load auto-migrations ──────────────────────────────────────
// These were previously run on every module load (which caused race conditions
// in dev restart cycles). Moved to the sequential migration chain in index.ts.
// DO NOT add new auto-running migrations here — add to index.ts chain instead.
// runBankMutationImportMigration().catch(() => {});
// runFleetIntelligenceMigration() — removed from module load; lazy trigger in fleetIntelligence.ts handles this

export default router;
