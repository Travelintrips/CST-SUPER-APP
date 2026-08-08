export * from "./appConfig";
export * from "./aiReview";
export * from "./companies";
export * from "./users";
export * from "./auth";
export * from "./products";
export * from "./orders";
export * from "./suppliers";
export * from "./stocks";
export * from "./shipments";
export * from "./transactions";
export * from "./customers";
export * from "./salesDocuments";
export * from "./purchaseDocuments";
export * from "./payments";
export * from "./accounting";
export type { Company, InsertCompany } from "./companies";

export * from "./correspondences";
export * from "./freightShipments";
export * from "./freightAttachments";
export * from "./shipmentStages";
export * from "./apiResponseTimes";
export * from "./expenses";
export * from "./emailCorrespondences";
export * from "./freightCustomsDocs";
export * from "./portalCustomers";
export * from "./logisticOrders";
export * from "./vendorRates";
export * from "./drivers";
export * from "./driverJobs";
export * from "./aiChat";
export * from "./waAiIntakeLog";
export * from "./portalProductOrders";
export * from "./quotationReplyLogs";
export * from "./holding";
export * from "./waIncomingMessages";
export * from "./quoteRequests";
export * from "./mediaAssets";

export * from "./warehouse";
export * from "./inventory";
export * from "./thaiTea";
export * from "./purchaseWorkflow";
export * from "./freightAuditLog";
export * from "./customRoles";
export * from "./orgStructure";
export * from "./approvalRules";
export * from "./productBom";


export * from "./notificationLogs";

export * from "./shortLinks";

export * from "./onboarding";
export * from "./waOtpCodes";
export * from "./rfqVendorLinks";
export * from "./vendorMiniForm";
export * from "./customerQuoteFlow";
export * from "./vendorPerformance";
export * from "./driverLocations";
export * from "./podOcrResults";
export * from "./internalTasks";

export * from "./marginRules";
export * from "./activityLogs";
export * from "./adminActionLinks";
export * from "./vendorFulfillmentLinks";
export * from "./orderFulfillment";
export * from "./trustedDevices";
export { costCentersTable } from "./accounting";
export type { CostCenter, InsertCostCenter } from "./accounting";
export * from "./auditReports";
export * from "./waTemplateConfigs";
export * from "./storageAuditLog";
export * from "./intelligenceAlerts";
export * from "./intelligenceAlertSettings";
export * from "./orderStageLogs";
export * from "./aiGovernance";
export * from "./productTemplates";
export * from "./serviceTemplates";
export * from "./purchaseMiniForm";
export * from "./rbac";

export * from "./orderStatusHistory";
export * from "./orderAuditLogs";
export * from "./vendorQuoteHistory";
export * from "./customerApprovalHistory";

export * from "./exceptions";
export * from "./cashAdvances";
export * from "./vendorInstallments";
export * from "./bankLoans";
export * from "./fixedAssets";
export * from "./expenseApprovals";
export * from "./productMedia";
export * from "./vendorCatalogEngine";
export * from "./logisticVendorFulfillments";
export * from "./airFreight";
export * from "./oceanFreight";
export * from "./freightMasterData";
export * from "./ppjkOrders";
export * from "./ppjkPhase2";
export * from "./customerServiceRequests";
export * from "./servicePackages";
export * from "./portalCustomerProfiles";
export * from "./customerVerificationDocuments";
export * from "./logisticsRateCards";
export * from "./logisticsServiceRates";
export * from "./logisticsSurcharges";
export * from "./sportExpenses";
export * from "./bankMutationImports";
export * from "./fleetIntelligence";
export * from "./systemErrorLogs";
export * from "./btkiTariff";
export * from "./approvalMatrix";
export * from "./portalQuickQuotes";

// ── Buyer Organization Layer — Phase 2B.1 ─────────────────────────────────────
// Bridge: portal_customers ←→ companies (ERP). Migrated via 0016.
export * from "./portalCompanyMembers";

// ── Enterprise Marketplace (Blueprint v1.1.1) — Phase 1A DRAFT SCHEMA ────────
// NOT YET MIGRATED. No DB push executed. See docs/enterprise-marketplace-blueprint-v1.1.1.md
export * from "./mktRfqs";
export * from "./mktRfqLines";
// Phase 2F — Buyer Approval Flow (MIGRATED via 0020_phase2f_approval_requote.sql)
export * from "./mktRfqApprovals";
// Phase 2A.2 — Dual Write Reliability Log (MIGRATED via 0014_mkt_dual_write_log.sql)
export * from "./mktDualWriteLog";
export * from "./mktVendorQuotes";
export * from "./mktVendorQuoteLines";
export * from "./mktPurchaseOrders";
export * from "./mktRfqGuestClaims";
export * from "./mktCompanySettings";
// Phase 2E.1 — Marketplace Notification Reliability Queue (migration 0021)
export * from "./mktNotificationQueue";

// Featured Product / Produk Unggulan Marketplace — additive (featuredProductMigration.ts)
export * from "./mktFeaturedProduct";

// Phase 2G — Vendor PO Confirmation + PO Fulfillment (migration 0022)
export * from "./mktPurchaseOrderLines";
export * from "./mktPoShipments";
export * from "./mktPoShipmentItems";
export * from "./mktPoShipmentEvents";
export * from "./mktPoGoodsReceipts";
export * from "./mktPoGoodsReceiptItems";
export * from "./mktApPreparations";

// ── Notification tables (Drizzle-tracked) ─────────────────────────────────────
export * from "./adminNotifications";
export * from "./vendorNotifications";

// ── Tax Audit Center (Fase 1) — type-safe Drizzle wrappers ────────────────────
export * from "./taxAudit";

// ── Token Security Audit Log (Security Patch P1) ──────────────────────────────
export * from "./tokenAccessLog";

// ── Enterprise DB Phase 3C — Order Links cross-reference table ───────────────
export * from "./orderLinks";

// ── Cash Advance & Payroll Accounting Automation ──────────────────────────────
export * from "./payroll";

// ── COA Proposal Engine (Task #7) ─────────────────────────────────────────────
export * from "./coaProposals";
